import type { EssenceEffect, Gen, Provenance } from '../data/types';
import { combineProvenance } from '../data/types';
import { type CurrencyRule, type EssenceDef, type OmenRule, boneSlotOf } from '../data/rules';
import type { CraftContext } from './context';
import {
  type ItemState,
  type PoolOptions,
  type Rarity,
  type WeightedPool,
  cloneItem,
  eligiblePool,
  hasDesecrated,
  isDesecratedMod,
  itemKey,
  limitsFor,
  openSides,
  rollValues,
  sideCounts,
  takenGroups,
} from './item';

export interface ActionSpec {
  /** Id da regra de moeda (ex.: "exalt", "greater-exalt", "ancient-collarbone") ou "essence". */
  currency: string;
  omens?: string[];
  essenceId?: string;
  /**
   * Profanação: mods que o jogador escolheria entre as opções reveladas, em ordem de preferência.
   * Se nenhum aparecer, o jogador escolhe qualquer opção (hipótese).
   */
  prefer?: string[];
}

export type CheckResult = { ok: true } | { ok: false; key: string; params?: Record<string, string | number> };

export class WeightsUnavailableError extends Error {
  constructor() {
    super('weights-unavailable');
  }
}

export interface Outcome {
  item: ItemState;
  p: number;
}

export interface Distribution {
  outcomes: Outcome[];
  provenance: Provenance;
}

type Step =
  | { op: 'rarity'; rarity: Rarity }
  | { op: 'add'; opts: PoolOptions }
  | { op: 'addOneOf'; modIds: string[] }
  | { op: 'remove'; side?: Gen; lowest?: boolean; desecratedOnly?: boolean }
  | { op: 'removeForSide'; side: Gen }
  | { op: 'removeIfFull' }
  | { op: 'desecrate'; opts: PoolOptions; options: number; rerolls: number; prefer: string[] }
  | { op: 'fracture' }
  | { op: 'reroll' };

function rule(ctx: CraftContext, spec: ActionSpec): CurrencyRule | undefined {
  return ctx.rules.currencies[spec.currency];
}

function omens(ctx: CraftContext, spec: ActionSpec): OmenRule[] {
  return (spec.omens ?? []).map((id) => ctx.rules.omens[id]).filter(Boolean);
}

export function essenceById(ctx: CraftContext, id?: string): EssenceDef | undefined {
  return ctx.essences.find((e) => e.id === id);
}

/** Efeito da essência para a classe do item (o jogo garante um mod diferente por categoria). */
export function essenceEffectFor(ctx: CraftContext, e: EssenceDef, baseId: string): EssenceEffect | undefined {
  const base = ctx.basesById.get(baseId);
  return base ? e.effects.find((ef) => ef.modIds.length > 0 && ef.itemClasses.includes(base.itemClass)) : undefined;
}

function removable(ctx: CraftContext, it: ItemState, side?: Gen, desecratedOnly = false) {
  return it.mods.filter((m) => !m.fractured && (!side || ctx.modsById.get(m.modId)!.gen === side) && (!desecratedOnly || isDesecratedMod(ctx, m)));
}

function canAddMod(ctx: CraftContext, it: ItemState, modId: string, rarity: Rarity): boolean {
  const def = ctx.modsById.get(modId);
  if (!def) return false;
  return openSides(ctx, it, rarity).includes(def.gen) && !def.groups.some((g) => takenGroups(ctx, it).has(g));
}

/** Verifica se a ação pode ser usada no item, segundo as regras implementadas. */
export function checkAction(ctx: CraftContext, it: ItemState, spec: ActionSpec): CheckResult {
  if (spec.currency === 'essence') {
    const e = essenceById(ctx, spec.essenceId);
    if (!e) return { ok: false, key: 'chk.unknownEssence' };
    const ef = essenceEffectFor(ctx, e, it.baseId);
    if (!ef) return { ok: false, key: 'chk.essenceClass' };
    if (e.mode === 'unknown') return { ok: false, key: 'chk.essenceNoEffect' };
    const need: Rarity = e.mode === 'normalToMagic' ? 'normal' : e.mode === 'magicToRare' ? 'magic' : 'rare';
    if (it.rarity !== need) return { ok: false, key: 'chk.needRarity', params: { rarity: need } };
    if (e.mode === 'rareReplace') {
      if (removable(ctx, it).length === 0) return { ok: false, key: 'chk.nothingToRemove' };
      const groups = takenGroups(ctx, it);
      if (!ef.modIds.some((id) => !ctx.modsById.get(id)?.groups.some((g) => groups.has(g)))) return { ok: false, key: 'chk.groupTaken' };
      return { ok: true };
    }
    const after: Rarity = e.mode === 'normalToMagic' ? 'magic' : 'rare';
    if (!ef.modIds.some((id) => canAddMod(ctx, it, id, after))) {
      const anySide = ef.modIds.some((id) => openSides(ctx, it, after).includes(ctx.modsById.get(id)!.gen));
      return { ok: false, key: anySide ? 'chk.groupTaken' : 'chk.noSideSpace' };
    }
    return { ok: true };
  }
  const r = rule(ctx, spec);
  if (!r) return { ok: false, key: 'chk.unknownCurrency' };
  if (r.minModLevel === null) return { ok: false, key: 'chk.unknownMinLevel', params: { currency: r.nameEn } };
  for (const o of omens(ctx, spec)) if (o.appliesTo !== r.kind) return { ok: false, key: 'chk.omenMismatch', params: { omen: o.nameEn } };
  const sideOmen = omens(ctx, spec).find((o) => 'side' in o.effect);
  const side = sideOmen && 'side' in sideOmen.effect ? sideOmen.effect.side : undefined;
  switch (r.kind) {
    case 'transmute':
    case 'alchemy':
      return it.rarity === 'normal' ? { ok: true } : { ok: false, key: 'chk.needRarity', params: { rarity: 'normal' } };
    case 'augment':
      if (it.rarity !== 'magic') return { ok: false, key: 'chk.needRarity', params: { rarity: 'magic' } };
      return openSides(ctx, it).length ? { ok: true } : { ok: false, key: 'chk.noSideSpace' };
    case 'regal':
      if (it.rarity !== 'magic') return { ok: false, key: 'chk.needRarity', params: { rarity: 'magic' } };
      if (side && !openSides(ctx, it, 'rare').includes(side)) return { ok: false, key: 'chk.noSideSpace' };
      return { ok: true };
    case 'exalt': {
      if (it.rarity !== 'rare') return { ok: false, key: 'chk.needRarity', params: { rarity: 'rare' } };
      const open = openSides(ctx, it);
      if (!open.length || (side && !open.includes(side))) return { ok: false, key: 'chk.noSideSpace' };
      return { ok: true };
    }
    case 'chaos':
      if (it.rarity !== 'rare') return { ok: false, key: 'chk.needRarity', params: { rarity: 'rare' } };
      return removable(ctx, it, side).length ? { ok: true } : { ok: false, key: 'chk.nothingToRemove' };
    case 'annul': {
      if (it.rarity === 'normal') return { ok: false, key: 'chk.needRarity', params: { rarity: 'magic/rare' } };
      const light = omens(ctx, spec).some((o) => o.effect.kind === 'annulDesecrated');
      return removable(ctx, it, side, light).length ? { ok: true } : { ok: false, key: light ? 'chk.noDesecrated' : 'chk.nothingToRemove' };
    }
    case 'divine':
      return it.mods.length ? { ok: true } : { ok: false, key: 'chk.nothingToReroll' };
    case 'fracture':
      if (it.rarity !== 'rare') return { ok: false, key: 'chk.needRarity', params: { rarity: 'rare' } };
      if (it.mods.length < 4) return { ok: false, key: 'chk.fractureNeeds4' };
      if (it.mods.some((m) => m.fractured)) return { ok: false, key: 'chk.alreadyFractured' };
      return { ok: true };
    case 'desecrate': {
      // Textos do jogo: "Desecrates a Rare Weapon or Quiver / Armour / Amulet, Ring or Belt";
      // "Items with Desecrated Modifiers cannot be Desecrated again".
      if (it.rarity !== 'rare') return { ok: false, key: 'chk.needRarity', params: { rarity: 'rare' } };
      if (hasDesecrated(ctx, it)) return { ok: false, key: 'chk.alreadyDesecrated' };
      const base = ctx.basesById.get(it.baseId)!;
      const slot = boneSlotOf(ctx.rules, base.itemClass);
      if (!slot || slot !== r.bone?.slot) return { ok: false, key: 'chk.boneClass' };
      if (r.bone.maxItemLevel != null && it.ilvl > r.bone.maxItemLevel) return { ok: false, key: 'chk.boneItemLevel', params: { max: r.bone.maxItemLevel } };
      if (omens(ctx, spec).some((o) => o.effect.kind === 'desecrateLord') && !ctx.rules.desecration.lordOmenSlots.includes(slot)) return { ok: false, key: 'chk.lordOmenSlot' };
      if (side && !openSides(ctx, it).includes(side)) return { ok: false, key: 'chk.noSideSpace' };
      if (!openSides(ctx, it).length && !removable(ctx, it).length) return { ok: false, key: 'chk.noSideSpace' };
      return { ok: true };
    }
  }
}

/** Decompõe a ação em passos primitivos (mesma decomposição usada no cálculo exato e na simulação). */
function steps(ctx: CraftContext, it: ItemState, spec: ActionSpec): Step[] {
  if (spec.currency === 'essence') {
    const e = essenceById(ctx, spec.essenceId)!;
    const ef = essenceEffectFor(ctx, e, it.baseId)!;
    if (e.mode === 'normalToMagic') return [{ op: 'rarity', rarity: 'magic' }, { op: 'addOneOf', modIds: ef.modIds }];
    if (e.mode === 'magicToRare') return [{ op: 'rarity', rarity: 'rare' }, { op: 'addOneOf', modIds: ef.modIds }];
    const side = ctx.modsById.get(ef.modIds[0])!.gen;
    return [{ op: 'removeForSide', side }, { op: 'addOneOf', modIds: ef.modIds }];
  }
  const r = rule(ctx, spec)!;
  const os = omens(ctx, spec);
  const minModLevel = r.minModLevel ?? 0;
  const sideOf = (k: string) => {
    const o = os.find((x) => x.effect.kind === k);
    return o && 'side' in o.effect ? o.effect.side : undefined;
  };
  switch (r.kind) {
    case 'transmute':
      return [{ op: 'rarity', rarity: 'magic' }, { op: 'add', opts: { rarity: 'magic', minModLevel } }];
    case 'augment':
      return [{ op: 'add', opts: { rarity: 'magic', minModLevel } }];
    case 'regal': {
      const s = sideOf('regalSide');
      return [{ op: 'rarity', rarity: 'rare' }, { op: 'add', opts: { rarity: 'rare', minModLevel, sides: s ? [s] : undefined } }];
    }
    case 'exalt': {
      const s = sideOf('exaltSide');
      const add: Step = { op: 'add', opts: { rarity: 'rare', minModLevel, sides: s ? [s] : undefined } };
      return os.some((o) => o.effect.kind === 'exaltDouble') ? [add, add] : [add];
    }
    case 'chaos': {
      const s = sideOf('chaosRemoveSide');
      const lowest = os.some((o) => o.effect.kind === 'chaosRemoveLowest');
      return [{ op: 'remove', side: s, lowest }, { op: 'add', opts: { rarity: 'rare', minModLevel } }];
    }
    case 'alchemy': {
      // "Maximum number of prefix/suffix modifiers": o lado do presságio é preenchido até o limite.
      const s = sideOf('alchemySide');
      const n = ctx.rules.alchemyModCount;
      if (s) {
        const lim = limitsFor(ctx, 'rare', it.baseId)[s];
        const k = Math.min(lim, n);
        return [
          { op: 'rarity', rarity: 'rare' },
          ...Array.from({ length: k }, () => ({ op: 'add' as const, opts: { rarity: 'rare' as Rarity, sides: [s] } })),
          ...Array.from({ length: n - k }, () => ({ op: 'add' as const, opts: { rarity: 'rare' as Rarity, sides: [s === 'prefix' ? 'suffix' : 'prefix'] as Gen[] } })),
        ];
      }
      return [{ op: 'rarity', rarity: 'rare' }, ...Array.from({ length: n }, () => ({ op: 'add' as const, opts: { rarity: 'rare' as Rarity } }))];
    }
    case 'annul': {
      const light = os.some((o) => o.effect.kind === 'annulDesecrated');
      const rm: Step = { op: 'remove', side: sideOf('annulSide'), desecratedOnly: light };
      return os.some((o) => o.effect.kind === 'annulDouble') ? [rm, rm] : [rm];
    }
    case 'divine':
      return [{ op: 'reroll' }];
    case 'fracture':
      return [{ op: 'fracture' }];
    case 'desecrate': {
      const lordOmen = os.find((o) => o.effect.kind === 'desecrateLord');
      const lord = lordOmen && lordOmen.effect.kind === 'desecrateLord' ? lordOmen.effect.lord : undefined;
      const s = sideOf('desecrateSide');
      return [
        { op: 'removeIfFull' },
        {
          op: 'desecrate',
          // "Reveal desecrated modifiers may include base modifiers. Unless you use Omen to guarantee named modifiers."
          opts: { rarity: 'rare', minModLevel, sides: s ? [s] : undefined, kinds: lord ? ['desecrated'] : ['normal', 'desecrated'], lord },
          options: ctx.rules.desecration.revealOptions,
          rerolls: os.some((o) => o.effect.kind === 'desecrateReroll') ? 1 : 0,
          prefer: spec.prefer ?? [],
        },
      ];
    }
  }
}

const CONFIRMED: Provenance = { confidence: 'confirmed', assumptions: [] };

/**
 * Probabilidade de NENHUM mod preferido aparecer entre k opções sorteadas sem reposição (pesos).
 * Exata para k ≤ 3 (soma sobre as sequências de mods não preferidos).
 */
export function noPreferredProbability(nonPreferred: number[], preferredWeight: number, k: number): number {
  const total = nonPreferred.reduce((a, b) => a + b, 0) + preferredWeight;
  if (preferredWeight <= 0) return 1;
  if (k <= 0) return 1;
  if (nonPreferred.length + 1 <= k) return 0; // todas as opções aparecem
  if (k === 1) return (total - preferredWeight) / total;
  let p = 0;
  for (let i = 0; i < nonPreferred.length; i++) {
    const wi = nonPreferred[i];
    const r1 = total - wi;
    if (k === 2) {
      p += (wi / total) * ((r1 - preferredWeight) / r1);
      continue;
    }
    let inner = 0;
    for (let j = 0; j < nonPreferred.length; j++) {
      if (j === i) continue;
      const wj = nonPreferred[j];
      const r2 = r1 - wj;
      inner += (wj / r1) * ((r2 - preferredWeight) / r2);
    }
    p += (wi / total) * inner;
  }
  return p;
}

function desecrateDist(ctx: CraftContext, it: ItemState, s: Extract<Step, { op: 'desecrate' }>): Distribution {
  const pool = eligiblePool(ctx, it, s.opts);
  if (pool.entries.length === 0) return { outcomes: [{ item: it, p: 1 }], provenance: CONFIRMED };
  if (pool.provenance.confidence === 'unavailable') return { outcomes: [], provenance: pool.provenance };
  const pref = new Set(s.prefer);
  const D = pool.entries.filter((e) => pref.has(e.entry.mod.id));
  const N = pool.entries.filter((e) => !pref.has(e.entry.mod.id));
  const wD = D.reduce((a, e) => a + e.weight, 0);
  const wN = N.reduce((a, e) => a + e.weight, 0);
  let pNone = noPreferredProbability(N.map((e) => e.weight), wD, s.options);
  pNone = Math.pow(pNone, s.rerolls + 1);
  const add = (modId: string, p: number): Outcome => {
    const n = cloneItem(it);
    n.mods.push({ modId, desecrated: true });
    return { item: n, p };
  };
  const outcomes: Outcome[] = [];
  // Hipótese: entre opções preferidas (ou, sem elas, entre quaisquer opções) a escolha segue o peso.
  for (const e of D) outcomes.push(add(e.entry.mod.id, (1 - pNone) * (e.weight / wD)));
  for (const e of N) outcomes.push(add(e.entry.mod.id, pNone * (e.weight / (wN || 1))));
  const assumptions = ['assume.desecrationChoice'];
  if (ctx.rules.desecration.revealOptionsConfidence !== 'confirmed') assumptions.push('assume.revealOptions');
  // Com 0 ou 1 preferido possível o número central (chance de ver um preferido) é exato dados os pesos.
  return { outcomes: outcomes.filter((o) => o.p > 0), provenance: combineProvenance(pool.provenance, { confidence: 'estimated', assumptions }) };
}

/** Aplica um passo a um item, devolvendo a distribuição exata de resultados. */
function stepDist(ctx: CraftContext, it: ItemState, s: Step): Distribution {
  switch (s.op) {
    case 'rarity': {
      const n = cloneItem(it);
      n.rarity = s.rarity;
      return { outcomes: [{ item: n, p: 1 }], provenance: CONFIRMED };
    }
    case 'add': {
      const pool = eligiblePool(ctx, it, s.opts);
      if (pool.entries.length === 0) return { outcomes: [{ item: it, p: 1 }], provenance: CONFIRMED };
      if (pool.provenance.confidence === 'unavailable') return { outcomes: [], provenance: pool.provenance };
      return {
        outcomes: pool.entries.map(({ entry, weight }) => {
          const n = cloneItem(it);
          n.mods.push({ modId: entry.mod.id });
          return { item: n, p: weight / pool.total };
        }),
        provenance: pool.provenance,
      };
    }
    case 'addOneOf': {
      const ok = s.modIds.filter((id) => canAddMod(ctx, it, id, it.rarity));
      if (!ok.length) return { outcomes: [{ item: it, p: 1 }], provenance: CONFIRMED };
      return {
        outcomes: ok.map((id) => {
          const n = cloneItem(it);
          n.mods.push({ modId: id });
          return { item: n, p: 1 / ok.length };
        }),
        provenance: ok.length > 1 ? { confidence: 'estimated', assumptions: ['assume.essenceAlternatives'] } : CONFIRMED,
      };
    }
    case 'remove':
    case 'removeForSide':
    case 'removeIfFull': {
      let cands = s.op === 'remove' ? removable(ctx, it, s.side, s.desecratedOnly) : removable(ctx, it);
      let prov = CONFIRMED;
      if (s.op === 'removeIfFull') {
        if (openSides(ctx, it).length) return { outcomes: [{ item: it, p: 1 }], provenance: CONFIRMED };
      }
      if (s.op === 'removeForSide') {
        // Hipótese: se o lado do mod da essência está cheio, o mod removido é desse lado.
        const full = sideCounts(ctx, it)[s.side] >= limitsFor(ctx, it.rarity, it.baseId)[s.side];
        if (full) cands = removable(ctx, it, s.side);
        prov = { confidence: 'confirmed', assumptions: ['assume.essenceRemoval'] };
      }
      if (s.op === 'remove' && s.lowest && cands.length) {
        const minLvl = Math.min(...cands.map((m) => ctx.modsById.get(m.modId)!.level));
        cands = cands.filter((m) => ctx.modsById.get(m.modId)!.level === minLvl);
      }
      if (!cands.length) return { outcomes: [{ item: it, p: 1 }], provenance: prov };
      return {
        outcomes: cands.map((c) => {
          const n = cloneItem(it);
          n.mods = n.mods.filter((m) => m.modId !== c.modId);
          return { item: n, p: 1 / cands.length };
        }),
        provenance: prov,
      };
    }
    case 'desecrate':
      return desecrateDist(ctx, it, s);
    case 'fracture':
      return {
        outcomes: it.mods.map((c) => {
          const n = cloneItem(it);
          n.mods = n.mods.map((m) => (m.modId === c.modId ? { ...m, fractured: true } : m));
          return { item: n, p: 1 / it.mods.length };
        }),
        provenance: CONFIRMED,
      };
    case 'reroll':
      return { outcomes: [{ item: cloneItem(it), p: 1 }], provenance: CONFIRMED };
  }
}

export function mergeOutcomes(outs: Outcome[]): Outcome[] {
  const map = new Map<string, Outcome>();
  for (const o of outs) {
    const k = itemKey(o.item);
    const cur = map.get(k);
    if (cur) cur.p += o.p;
    else map.set(k, { item: o.item, p: o.p });
  }
  return [...map.values()];
}

/** Limite de estados para a enumeração exata (acima disso, use simulação). */
export const MAX_EXACT_STATES = 250_000;

/** Distribuição exata do resultado de uma ação. Devolve null se a enumeração for grande demais. */
export function actionDistribution(ctx: CraftContext, it: ItemState, spec: ActionSpec, maxStates = MAX_EXACT_STATES): Distribution | null {
  let cur: Outcome[] = [{ item: it, p: 1 }];
  let prov = CONFIRMED;
  for (const s of steps(ctx, it, spec)) {
    const next: Outcome[] = [];
    for (const o of cur) {
      const d = stepDist(ctx, o.item, s);
      prov = combineProvenance(prov, d.provenance);
      if (d.provenance.confidence === 'unavailable') return { outcomes: [], provenance: prov };
      for (const x of d.outcomes) next.push({ item: x.item, p: o.p * x.p });
      if (next.length > maxStates) return null;
    }
    cur = mergeOutcomes(next);
  }
  return { outcomes: cur, provenance: prov };
}

function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rng() * total;
  for (const x of items) {
    r -= weight(x);
    if (r < 0) return x;
  }
  return items[items.length - 1];
}

/** Sorteia k opções distintas (sem reposição, ponderadas). */
function drawOptions(pool: WeightedPool, k: number, rng: () => number) {
  const left = [...pool.entries];
  const out: typeof left = [];
  while (out.length < k && left.length) {
    const pick = pickWeighted(left, (e) => e.weight, rng);
    out.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return out;
}

/** Aplica a ação sorteando um resultado (mesmas regras de actionDistribution). */
export function applyAction(ctx: CraftContext, it: ItemState, spec: ActionSpec, rng: () => number): { item: ItemState; provenance: Provenance } {
  let cur = it;
  let prov = CONFIRMED;
  for (const s of steps(ctx, it, spec)) {
    if (s.op === 'add') {
      const pool = eligiblePool(ctx, cur, s.opts);
      if (pool.entries.length === 0) continue;
      if (pool.provenance.confidence === 'unavailable') throw new WeightsUnavailableError();
      prov = combineProvenance(prov, pool.provenance);
      const pick = pickWeighted(pool.entries, (e) => e.weight, rng);
      cur = cloneItem(cur);
      cur.mods.push({ modId: pick.entry.mod.id, values: rollValues(ctx, pick.entry.mod.id, rng) });
    } else if (s.op === 'desecrate') {
      const pool = eligiblePool(ctx, cur, s.opts);
      if (pool.entries.length === 0) continue;
      if (pool.provenance.confidence === 'unavailable') throw new WeightsUnavailableError();
      prov = combineProvenance(prov, pool.provenance, { confidence: 'estimated', assumptions: ['assume.desecrationChoice'] });
      let chosen = null;
      for (let round = 0; round <= s.rerolls && !chosen; round++) {
        const opts = drawOptions(pool, s.options, rng);
        // O jogador escolhe a opção de maior preferência; sem preferidas, pega a primeira (rola de novo se tiver Ecos).
        const best = s.prefer.map((id) => opts.find((o) => o.entry.mod.id === id)).find(Boolean);
        if (best) chosen = best;
        else if (round === s.rerolls) chosen = opts[0];
      }
      cur = cloneItem(cur);
      cur.mods.push({ modId: chosen!.entry.mod.id, desecrated: true, values: rollValues(ctx, chosen!.entry.mod.id, rng) });
    } else if (s.op === 'reroll') {
      cur = cloneItem(cur);
      cur.mods = cur.mods.map((m) => (m.fractured ? m : { ...m, values: rollValues(ctx, m.modId, rng) }));
      prov = combineProvenance(prov, { confidence: 'confirmed', assumptions: ['assume.uniformValues'] });
    } else {
      const d = stepDist(ctx, cur, s);
      prov = combineProvenance(prov, d.provenance);
      const o = pickWeighted(d.outcomes, (x) => x.p, rng);
      const before = new Set(cur.mods.map((m) => m.modId));
      cur = o.item;
      if (s.op === 'addOneOf') {
        const added = cur.mods.find((m) => !before.has(m.modId) && !m.values);
        if (added) added.values = rollValues(ctx, added.modId, rng);
      }
    }
  }
  return { item: cur, provenance: prov };
}

export function actionLabel(ctx: CraftContext, spec: ActionSpec, lang: 'pt-BR' | 'en'): string {
  let name: string;
  if (spec.currency === 'essence') name = essenceById(ctx, spec.essenceId)?.nameEn ?? 'Essence';
  else {
    const r = rule(ctx, spec);
    name = r ? (lang === 'pt-BR' ? `${r.namePt}${r.kind === 'desecrate' ? '' : ` (${r.nameEn})`}` : r.nameEn) : spec.currency;
  }
  const os = omens(ctx, spec).map((o) => (lang === 'pt-BR' ? o.namePt : o.nameEn));
  return os.length ? `${name} + ${os.join(' + ')}` : name;
}

/** Itens consumidos pela ação (nomes em inglês, usados para preço). */
export function actionMaterials(ctx: CraftContext, spec: ActionSpec): string[] {
  const out: string[] = [];
  if (spec.currency === 'essence') out.push(essenceById(ctx, spec.essenceId)?.nameEn ?? 'Essence');
  else out.push(rule(ctx, spec)?.nameEn ?? spec.currency);
  for (const o of omens(ctx, spec)) out.push(o.nameEn);
  return out;
}
