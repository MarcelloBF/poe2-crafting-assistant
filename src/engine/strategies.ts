import type { Gen } from '../data/types';
import { type Grade, boneFor, boneSlotOf, currencyFor } from '../data/rules';
import { type ActionSpec, checkAction, essenceById, essenceEffectFor } from './actions';
import { buyOptions } from './buy';
import { type CraftContext, familyGen, familyKind } from './context';
import { type ItemState, hasDesecrated, isDesecratedMod, openSides } from './item';
import { type TargetSpec, acceptedEntries, completableByAdding, evaluate, junkMods, missingRequired } from './target';

export type StrategyKind = 'magicExalt' | 'alchemyExalt' | 'alchemyChaos' | 'essenceExalt';

export interface StrategyParams {
  /** Grau das moedas que adicionam mods na fase rara (Exalted/Chaos). */
  grade: Grade;
  sideOmens: boolean;
  recovery: 'restart' | 'annul';
  essenceId?: string;
  /** Limite de ações por base antes de desistir (evita laços infinitos). */
  maxActions: number;
  /**
   * Profanação (Abyss): "last" usa um osso no último mod que falta (escolha entre as opções reveladas).
   * Requisitos de mods exclusivos da Abyss sempre usam profanação.
   */
  desecrate?: 'none' | 'last';
  /** Grau do osso: normal = Gnawed, greater = Preserved, perfect = Ancient. Sem valor: o mais barato possível. */
  bone?: Grade;
  /** Usar Omen of Abyssal Echoes (rerrolar as opções uma vez). */
  echoes?: boolean;
  /** Começar comprando um item mágico (chave da opção de compra) em vez de transmutar bases. */
  buy?: string;
}

export interface Strategy {
  id: string;
  kind: StrategyKind;
  params: StrategyParams;
}

export type Decision =
  | { kind: 'action'; spec: ActionSpec; reasonKey: string; params?: Record<string, string | number> }
  | { kind: 'restart'; reasonKey: string }
  | { kind: 'buy'; optionKey: string; reasonKey: string }
  | { kind: 'success'; reasonKey: string }
  | { kind: 'fail'; reasonKey: string };

function cid(ctx: CraftContext, kind: Parameters<typeof currencyFor>[1], grade: Grade = 'normal'): string {
  return currencyFor(ctx.rules, kind, grade)?.id ?? kind;
}

const sideOmen = (kind: 'exaltation' | 'annulment' | 'coronation' | 'necromancy', side: Gen) => `${side === 'prefix' ? 'sinistral' : 'dextral'}-${kind}`;
const LORD_OMEN = { ulaman: 'sovereign', amanamu: 'liege', kurgal: 'blackblooded' } as const;

function missingSides(ctx: CraftContext, t: TargetSpec, it: ItemState): Set<Gen> {
  return new Set(missingRequired(ctx, t, it).map((r) => familyGen(r.family)));
}

/** Profanar agora? Retorna a ação (osso + presságios + mods preferidos) ou null. */
function desecration(ctx: CraftContext, s: Strategy, t: TargetSpec, it: ItemState): Decision | null {
  if (it.rarity !== 'rare' || hasDesecrated(ctx, it)) return null;
  const missing = missingRequired(ctx, t, it);
  if (!missing.length) return null;
  const abyss = missing.filter((r) => familyKind(r.family) === 'desecrated');
  const useNow = abyss.length > 0 ? missing.length === abyss.length : s.params.desecrate === 'last' && missing.length === 1;
  if (!useNow || !completableByAdding(ctx, t, it)) return null;
  const base = ctx.basesById.get(it.baseId)!;
  const prefer = missing
    .flatMap((r) => acceptedEntries(ctx, t, r))
    .sort((a, b) => a.tier - b.tier)
    .map((e) => e.mod.id);
  const grades: Grade[] = s.params.bone ? [s.params.bone] : ['normal', 'greater'];
  for (const g of grades) {
    const bone = boneFor(ctx.rules, base.itemClass, g);
    if (!bone) continue;
    const spec: ActionSpec = { currency: bone.id, prefer, omens: [] };
    const lords = [...new Set(prefer.map((id) => ctx.modsById.get(id)!.lord).filter(Boolean))];
    const slot = boneSlotOf(ctx.rules, base.itemClass);
    if (abyss.length && lords.length === 1 && slot && ctx.rules.desecration.lordOmenSlots.includes(slot)) spec.omens!.push(LORD_OMEN[lords[0]!]);
    const sides = missingSides(ctx, t, it);
    if (s.params.sideOmens && sides.size === 1 && openSides(ctx, it).length === 2) spec.omens!.push(sideOmen('necromancy', [...sides][0]));
    if (s.params.echoes) spec.omens!.push('abyssal-echoes');
    if (checkAction(ctx, it, spec).ok) return { kind: 'action', spec, reasonKey: abyss.length ? 'dec.desecrateAbyss' : 'dec.desecrateLast' };
  }
  return abyss.length ? { kind: 'fail', reasonKey: 'dec.cannotDesecrate' } : null;
}

function magicPhase(ctx: CraftContext, s: Strategy, t: TargetSpec, it: ItemState): Decision {
  const junk = junkMods(ctx, t, it).length > 0;
  // Com recuperação por Anulação (alvo raro), mods inúteis no mágico são mantidos e removidos depois.
  const keepJunk = s.params.recovery === 'annul' && t.rarity === 'rare' && it.mods.length - junkMods(ctx, t, it).length > 0;
  if (junk && !keepJunk) return { kind: 'restart', reasonKey: 'dec.magicJunk' };
  // Mods exclusivos da Abyss não saem de Aumento/Régio: só lados com requisitos normais contam.
  const missing = new Set(missingRequired(ctx, t, it).filter((r) => familyKind(r.family) === 'normal').map((r) => familyGen(r.family)));
  const open = openSides(ctx, it);
  if (open.some((x) => missing.has(x))) return { kind: 'action', spec: { currency: cid(ctx, 'augment') }, reasonKey: 'dec.augment' };
  if (t.rarity === 'magic') return { kind: 'restart', reasonKey: 'dec.magicNoRoom' };
  const spec: ActionSpec = { currency: cid(ctx, 'regal') };
  if (s.params.sideOmens && missing.size === 1) {
    const side = [...missing][0];
    if (openSides(ctx, it, 'rare').includes(side)) spec.omens = [sideOmen('coronation', side)];
  }
  return { kind: 'action', spec, reasonKey: 'dec.regal' };
}

function rarePhase(ctx: CraftContext, s: Strategy, t: TargetSpec, it: ItemState): Decision {
  const des = desecration(ctx, s, t, it);
  if (des) return des;
  if (completableByAdding(ctx, t, it)) {
    const open = openSides(ctx, it);
    // Exaltados não geram mods da Abyss: considerar só os requisitos normais ao escolher o lado.
    const normalMissing = missingRequired(ctx, t, it).filter((r) => familyKind(r.family) !== 'desecrated');
    const abyssSides = new Set(missingRequired(ctx, t, it).filter((r) => familyKind(r.family) === 'desecrated').map((r) => familyGen(r.family)));
    const missing = new Set(normalMissing.map((r) => familyGen(r.family)));
    const spec: ActionSpec = { currency: cid(ctx, 'exalt', s.params.grade) };
    // Se falta um mod da Abyss num lado, o Exaltado deve ir para o outro lado (preserva o espaço).
    const forced = abyssSides.size === 1 && missing.size === 1 && !missing.has([...abyssSides][0]) ? [...missing][0] : null;
    if ((s.params.sideOmens || forced) && missing.size === 1 && open.length === 2) spec.omens = [sideOmen('exaltation', [...missing][0])];
    if (!checkAction(ctx, it, spec).ok) spec.currency = cid(ctx, 'exalt');
    return { kind: 'action', spec, reasonKey: spec.omens ? 'dec.exaltOmen' : 'dec.exalt' };
  }
  const junk = junkMods(ctx, t, it).filter((m) => !m.fractured);
  // Mod profanado errado bloqueia o requisito da Abyss: Anulação + Omen of Light remove só o profanado.
  const badDesecrated = junk.find((m) => isDesecratedMod(ctx, m));
  if (badDesecrated && missingRequired(ctx, t, it).some((r) => familyKind(r.family) === 'desecrated') && s.params.recovery === 'annul')
    return { kind: 'action', spec: { currency: cid(ctx, 'annul'), omens: ['light'] }, reasonKey: 'dec.annulDesecrated' };
  if (s.params.recovery === 'restart') return { kind: 'restart', reasonKey: 'dec.bricked' };
  if (!junk.length) return { kind: 'fail', reasonKey: 'dec.noJunkToRemove' };
  const spec: ActionSpec = { currency: cid(ctx, 'annul') };
  if (s.params.sideOmens) {
    // Usa omen de lado se todo o lixo estiver em um lado que não tem mods bons e o outro lado tem.
    const junkSides = new Set(junk.map((m) => ctx.modsById.get(m.modId)!.gen));
    if (junkSides.size === 1) {
      const side = [...junkSides][0];
      const goodOtherSide = it.mods.some((m) => !junk.includes(m) && ctx.modsById.get(m.modId)!.gen !== side);
      const goodSameSide = it.mods.some((m) => !junk.includes(m) && ctx.modsById.get(m.modId)!.gen === side);
      if (goodOtherSide && !goodSameSide) spec.omens = [sideOmen('annulment', side)];
    }
  }
  return { kind: 'action', spec, reasonKey: 'dec.annul' };
}

/** Decide a próxima ação da estratégia para o item atual. Função pura e determinística. */
export function decide(ctx: CraftContext, s: Strategy, t: TargetSpec, it: ItemState, actionsSoFar: number): Decision {
  const ev = evaluate(ctx, t, it);
  if (ev.allRequired) return { kind: 'success', reasonKey: 'dec.success' };
  if (actionsSoFar >= s.params.maxActions) return { kind: 'restart', reasonKey: 'dec.tooManyActions' };
  if (ev.allRequiredIgnoringValues && it.rarity === t.rarity) return { kind: 'action', spec: { currency: cid(ctx, 'divine') }, reasonKey: 'dec.divine' };
  // Estratégia de compra: a base nova é o item mágico comprado.
  if (s.params.buy && it.rarity === 'normal') return { kind: 'buy', optionKey: s.params.buy, reasonKey: 'dec.buy' };

  switch (s.kind) {
    case 'magicExalt':
      if (it.rarity === 'normal') return { kind: 'action', spec: { currency: cid(ctx, 'transmute') }, reasonKey: 'dec.transmute' };
      if (it.rarity === 'magic') return magicPhase(ctx, s, t, it);
      return rarePhase(ctx, s, t, it);
    case 'alchemyExalt':
      if (it.rarity === 'normal') return { kind: 'action', spec: { currency: cid(ctx, 'alchemy') }, reasonKey: 'dec.alchemy' };
      if (it.rarity === 'magic') return { kind: 'fail', reasonKey: 'dec.unexpectedRarity' };
      return rarePhase(ctx, s, t, it);
    case 'alchemyChaos':
      if (it.rarity === 'normal') return { kind: 'action', spec: { currency: cid(ctx, 'alchemy') }, reasonKey: 'dec.alchemy' };
      if (it.rarity === 'magic') return { kind: 'fail', reasonKey: 'dec.unexpectedRarity' };
      return { kind: 'action', spec: { currency: cid(ctx, 'chaos', s.params.grade) }, reasonKey: 'dec.chaos' };
    case 'essenceExalt': {
      const e = essenceById(ctx, s.params.essenceId);
      if (!e) return { kind: 'fail', reasonKey: 'dec.unknownEssence' };
      const ef = essenceEffectFor(ctx, e, it.baseId);
      if (!ef) return { kind: 'fail', reasonKey: 'dec.unknownEssence' };
      const ess: ActionSpec = { currency: 'essence', essenceId: e.id };
      const hasEss = it.mods.some((m) => ef.modIds.includes(m.modId));
      if (e.mode === 'normalToMagic') {
        if (it.rarity === 'normal') return { kind: 'action', spec: ess, reasonKey: 'dec.essence' };
        if (it.rarity === 'magic') return magicPhase(ctx, s, t, it);
        return rarePhase(ctx, s, t, it);
      }
      if (e.mode === 'magicToRare') {
        if (it.rarity === 'normal') return { kind: 'action', spec: { currency: cid(ctx, 'transmute') }, reasonKey: 'dec.transmuteForEssence' };
        if (it.rarity === 'magic') {
          if (s.params.recovery === 'restart' && junkMods(ctx, t, it).length) return { kind: 'restart', reasonKey: 'dec.magicJunk' };
          if (!checkAction(ctx, it, ess).ok) return { kind: 'restart', reasonKey: 'dec.essenceBlocked' };
          return { kind: 'action', spec: ess, reasonKey: 'dec.essence' };
        }
        return rarePhase(ctx, s, t, it);
      }
      // rareReplace (Perfect): monta o raro e aplica a essência por cima.
      if (it.rarity === 'normal') return { kind: 'action', spec: { currency: cid(ctx, 'alchemy') }, reasonKey: 'dec.alchemy' };
      if (it.rarity === 'rare' && !hasEss) {
        if (!checkAction(ctx, it, ess).ok) return { kind: 'restart', reasonKey: 'dec.essenceBlocked' };
        return { kind: 'action', spec: ess, reasonKey: 'dec.essence' };
      }
      return rarePhase(ctx, s, t, it);
    }
  }
}

export interface Applicability {
  ok: boolean;
  reasonKey?: string;
  params?: Record<string, string | number>;
}

export function strategyApplicable(ctx: CraftContext, s: Strategy, t: TargetSpec): Applicability {
  if (t.rarity === 'magic' && s.kind !== 'magicExalt' && !(s.kind === 'essenceExalt' && essenceById(ctx, s.params.essenceId)?.mode === 'normalToMagic'))
    return { ok: false, reasonKey: 'app.notForMagic' };
  if (s.params.grade !== 'normal') {
    const kind = s.kind === 'alchemyChaos' ? 'chaos' : 'exalt';
    const r = currencyFor(ctx.rules, kind, s.params.grade);
    if (!r || r.minModLevel === null) return { ok: false, reasonKey: 'app.unknownMinLevel', params: { currency: r?.nameEn ?? kind } };
  }
  const base = ctx.basesById.get(t.baseId)!;
  const needsAbyss = t.requirements.some((r) => r.required && familyKind(r.family) === 'desecrated');
  if (needsAbyss && s.kind === 'alchemyChaos') return { ok: false, reasonKey: 'app.chaosNoAbyss' };
  if ((needsAbyss || s.params.desecrate === 'last') && !boneSlotOf(ctx.rules, base.itemClass)) return { ok: false, reasonKey: 'app.noBone' };
  if (s.params.bone === 'normal') {
    const b = boneFor(ctx.rules, base.itemClass, 'normal');
    if (b?.bone?.maxItemLevel != null && t.ilvl > b.bone.maxItemLevel) return { ok: false, reasonKey: 'app.boneItemLevel', params: { max: b.bone.maxItemLevel } };
  }
  if (s.kind === 'essenceExalt') {
    const e = essenceById(ctx, s.params.essenceId);
    if (!e) return { ok: false, reasonKey: 'app.unknownEssence' };
    const ef = essenceEffectFor(ctx, e, t.baseId);
    if (!ef) return { ok: false, reasonKey: 'app.essenceClass' };
    if (e.mode === 'unknown') return { ok: false, reasonKey: 'app.essenceSpecial' };
    const useful = t.requirements.some((r) => acceptedEntries(ctx, t, r).some((x) => ef.modIds.includes(x.mod.id)));
    if (!useful) return { ok: false, reasonKey: 'app.essenceNotUseful' };
    if (ef.modIds.every((id) => (ctx.modsById.get(id)?.level ?? 0) > t.ilvl)) return { ok: false, reasonKey: 'app.essenceLevel' };
  }
  return { ok: true };
}

export function strategyId(kind: StrategyKind, p: StrategyParams): string {
  return [kind, p.grade, p.sideOmens ? 'omens' : 'plain', p.recovery, p.essenceId ?? '', p.desecrate ?? 'none', p.bone ?? '', p.echoes ? 'echoes' : '', p.buy ?? ''].join('|');
}

function mk(kind: StrategyKind, p: Omit<StrategyParams, 'maxActions'> & { maxActions?: number }): Strategy {
  const params: StrategyParams = { maxActions: kind === 'alchemyChaos' ? 60 : 40, ...p };
  return { id: strategyId(kind, params), kind, params };
}

/** Gera as estratégias candidatas suportadas pelos dados e regras disponíveis. */
export function candidateStrategies(ctx: CraftContext, t: TargetSpec): { strategies: Strategy[]; excluded: { strategy: Strategy; reason: Applicability }[] } {
  const all: Strategy[] = [];
  const base = ctx.basesById.get(t.baseId);
  const needsAbyss = t.requirements.some((r) => r.required && familyKind(r.family) === 'desecrated');
  const canBone = !!base && !!boneSlotOf(ctx.rules, base.itemClass);
  if (t.rarity === 'magic') {
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: false, recovery: 'restart' }));
  } else {
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: false, recovery: 'restart' }));
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: false, recovery: 'annul' }));
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'restart' }));
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul' }));
    for (const grade of ['greater', 'perfect'] as Grade[]) all.push(mk('magicExalt', { grade, sideOmens: true, recovery: 'restart' }));
    all.push(mk('alchemyExalt', { grade: 'normal', sideOmens: false, recovery: 'restart' }));
    all.push(mk('alchemyExalt', { grade: 'normal', sideOmens: true, recovery: 'annul' }));
    if (!needsAbyss) {
      all.push(mk('alchemyChaos', { grade: 'normal', sideOmens: false, recovery: 'restart' }));
      all.push(mk('alchemyChaos', { grade: 'greater', sideOmens: false, recovery: 'restart' }));
    }
    if (canBone) {
      if (needsAbyss) {
        // Mod da Abyss obrigatório: variantes de osso e de Ecos Abissais.
        all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', echoes: true }));
        all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', bone: 'perfect' }));
        all.push(mk('alchemyExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', echoes: true }));
      } else {
        // Último mod por profanação: escolher 1 entre as opções reveladas (pode incluir mods normais).
        all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', desecrate: 'last' }));
        all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', desecrate: 'last', echoes: true }));
        all.push(mk('alchemyExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', desecrate: 'last' }));
      }
    }
  }
  // Comprar um item mágico com o(s) mod(s) mais difícil(eis) e continuar dele.
  for (const o of buyOptions(ctx, t)) {
    all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: t.rarity === 'rare' ? 'annul' : 'restart', buy: o.key }));
    if (t.rarity === 'rare' && canBone && !needsAbyss) all.push(mk('magicExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', buy: o.key, desecrate: 'last' }));
  }
  // Só essências com efeito para esta categoria de item.
  for (const e of ctx.essences) {
    if (!base || !essenceEffectFor(ctx, e, base.id)) continue;
    all.push(mk('essenceExalt', { grade: 'normal', sideOmens: true, recovery: 'restart', essenceId: e.id }));
    if (t.rarity === 'rare' && canBone && !needsAbyss) all.push(mk('essenceExalt', { grade: 'normal', sideOmens: true, recovery: 'annul', essenceId: e.id, desecrate: 'last' }));
  }
  const strategies: Strategy[] = [];
  const excluded: { strategy: Strategy; reason: Applicability }[] = [];
  for (const s of all) {
    const a = strategyApplicable(ctx, s, t);
    if (a.ok) strategies.push(s);
    else excluded.push({ strategy: s, reason: a });
  }
  // Essências que não ajudam o objetivo poluem a lista de excluídas: mostrar só um resumo.
  const essenceNotUseful = excluded.filter((x) => x.reason.reasonKey === 'app.essenceNotUseful');
  return { strategies, excluded: essenceNotUseful.length > 3 ? excluded.filter((x) => !essenceNotUseful.includes(x)) : excluded };
}
