import type { Gen, Provenance } from '../data/types';
import { combineProvenance } from '../data/types';
import { type CraftContext, type EntryKind, type PoolEntry, getBasePool, resolveWeight } from './context';

export type Rarity = 'normal' | 'magic' | 'rare';

export interface ItemMod {
  modId: string;
  fractured?: boolean;
  /** Revelado por profanação (Abyss). Mods exclusivos da Abyss são sempre profanados. */
  desecrated?: boolean;
  /** Valores rolados por stat (opcional; necessário só para metas de valor). */
  values?: number[];
}

export interface ItemState {
  baseId: string;
  ilvl: number;
  rarity: Rarity;
  mods: ItemMod[];
}

export function newItem(baseId: string, ilvl: number): ItemState {
  return { baseId, ilvl, rarity: 'normal', mods: [] };
}

export function cloneItem(it: ItemState): ItemState {
  return { ...it, mods: it.mods.map((m) => ({ ...m, values: m.values ? [...m.values] : undefined })) };
}

/** Chave canônica (ignora valores) para agrupar estados equivalentes na enumeração exata. */
export function itemKey(it: ItemState): string {
  return `${it.rarity}|${it.mods.map((m) => (m.fractured ? '!' : '') + (m.desecrated ? '*' : '') + m.modId).sort().join(',')}`;
}

export function sideOf(ctx: CraftContext, m: ItemMod): Gen {
  const def = ctx.modsById.get(m.modId);
  if (!def) throw new Error(`Modificador desconhecido: ${m.modId}`);
  return def.gen;
}

export function sideCounts(ctx: CraftContext, it: ItemState): { prefix: number; suffix: number } {
  const c = { prefix: 0, suffix: 0 };
  for (const m of it.mods) c[sideOf(ctx, m)]++;
  return c;
}

/**
 * Limite de prefixos/sufixos para a raridade na base. Implícitos como
 * "+1 Prefix Modifier allowed / -1 Suffix Modifier allowed" (stats local_maximum_*_allowed_+)
 * alteram o limite de itens raros. Para mágicos, o limite 1/1 é mantido (hipótese documentada).
 */
export function limitsFor(ctx: CraftContext, rarity: Rarity, baseId?: string): { prefix: number; suffix: number } {
  if (rarity === 'normal') return { prefix: 0, suffix: 0 };
  const lim = { ...ctx.rules.affixLimits[rarity] };
  if (rarity === 'rare' && baseId) {
    const base = ctx.basesById.get(baseId);
    for (const impId of base?.implicits ?? []) {
      for (const s of ctx.data.implicits[impId]?.stats ?? []) {
        if (s.id === 'local_maximum_prefixes_allowed_+') lim.prefix += s.max;
        if (s.id === 'local_maximum_suffixes_allowed_+') lim.suffix += s.max;
      }
    }
    lim.prefix = Math.max(0, lim.prefix);
    lim.suffix = Math.max(0, lim.suffix);
  }
  return lim;
}

export function openSides(ctx: CraftContext, it: ItemState, rarity: Rarity = it.rarity): Gen[] {
  const lim = limitsFor(ctx, rarity, it.baseId);
  const c = sideCounts(ctx, it);
  const out: Gen[] = [];
  if (c.prefix < lim.prefix) out.push('prefix');
  if (c.suffix < lim.suffix) out.push('suffix');
  return out;
}

/** O item já tem um mod profanado ("Items with Desecrated Modifiers cannot be Desecrated again"). */
export function isDesecratedMod(ctx: CraftContext, m: ItemMod): boolean {
  return !!m.desecrated || !!ctx.modsById.get(m.modId)?.desecrated;
}

export function hasDesecrated(ctx: CraftContext, it: ItemState): boolean {
  return it.mods.some((m) => isDesecratedMod(ctx, m));
}

export function takenGroups(ctx: CraftContext, it: ItemState): Set<string> {
  const s = new Set<string>();
  for (const m of it.mods) ctx.modsById.get(m.modId)?.groups.forEach((g) => s.add(g));
  return s;
}

export interface WeightedPool {
  entries: { entry: PoolEntry; weight: number }[];
  total: number;
  provenance: Provenance;
}

export interface PoolOptions {
  /** Raridade que o item terá após a ação (define os limites de afixos). */
  rarity: Rarity;
  sides?: Gen[];
  minModLevel?: number;
  /** Tipos de mod sorteáveis (padrão: só normais). Profanação usa normais + profanados. */
  kinds?: EntryKind[];
  /** Profanação com presságio de lorde: somente mods daquele lorde. */
  lord?: 'ulaman' | 'amanamu' | 'kurgal';
}

/**
 * Modificadores que podem ser adicionados ao item agora, com pesos.
 * Regras: flag de geração na base > 0, nível do mod <= ilvl, lado com espaço,
 * nenhum grupo em comum com mods existentes, e nível mínimo (Greater/Perfect).
 * Nível mínimo: se nenhum tier de uma família atingir o mínimo, a família continua elegível
 * (texto do jogo: "exceto se um tipo de modificador seria excluído completamente").
 */
export function eligiblePool(ctx: CraftContext, it: ItemState, opts: PoolOptions): WeightedPool {
  const pool = getBasePool(ctx, it.baseId);
  const open = new Set(openSides(ctx, it, opts.rarity));
  const sides = opts.sides ? opts.sides.filter((s) => open.has(s)) : [...open];
  const groups = takenGroups(ctx, it);
  const minLevel = opts.minModLevel ?? 0;
  const kinds = opts.kinds ?? ['normal'];
  const candidates = pool.entries.filter(
    (e) =>
      kinds.includes(e.kind) &&
      (!opts.lord || e.mod.lord === opts.lord) &&
      e.mod.level <= it.ilvl &&
      sides.includes(e.mod.gen) &&
      !e.mod.groups.some((g) => groups.has(g)),
  );
  let filtered = candidates;
  if (minLevel > 0) {
    const famHasHigh = new Set(candidates.filter((e) => e.mod.level >= minLevel).map((e) => e.family));
    filtered = candidates.filter((e) => !famHasHigh.has(e.family) || e.mod.level >= minLevel);
  }
  const provs: Provenance[] = [];
  const entries = filtered.map((entry) => {
    const r = resolveWeight(ctx, entry);
    provs.push(r.provenance);
    return { entry, weight: r.weight };
  });
  let provenance: Provenance = provs.length ? combineProvenance(...provs) : { confidence: 'confirmed', assumptions: [] };
  // Com 0 ou 1 candidato o resultado não depende de pesos.
  if (entries.length <= 1) {
    entries.forEach((e) => (e.weight = 1));
    provenance = { confidence: 'confirmed', assumptions: [] };
  }
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (minLevel > 0) provenance = combineProvenance(provenance, { confidence: 'confirmed', assumptions: ['assume.minLevelFamilyFallback'] });
  return { entries, total, provenance };
}

/** Rola valores uniformes (inteiros) para os stats do modificador. */
export function rollValues(ctx: CraftContext, modId: string, rng: () => number): number[] {
  const def = ctx.modsById.get(modId)!;
  return def.stats.map((s) => s.min + Math.floor(rng() * (s.max - s.min + 1)));
}

export interface ItemValidationIssue {
  key: string;
  params?: Record<string, string | number>;
}

/** Valida um item informado pelo jogador (ex.: resultado de uma tentativa). */
export function validateItem(ctx: CraftContext, it: ItemState): ItemValidationIssue[] {
  const issues: ItemValidationIssue[] = [];
  const base = ctx.basesById.get(it.baseId);
  if (!base) return [{ key: 'val.unknownBase' }];
  const pool = getBasePool(ctx, it.baseId);
  const seenGroups = new Map<string, string>();
  for (const m of it.mods) {
    const def = ctx.modsById.get(m.modId);
    if (!def) {
      issues.push({ key: 'val.unknownMod', params: { mod: m.modId } });
      continue;
    }
    if (!pool.byMod.has(m.modId)) issues.push({ key: 'val.modNotOnBase', params: { mod: def.text, base: base.name } });
    if (def.level > it.ilvl) issues.push({ key: 'val.modLevelTooHigh', params: { mod: def.text, level: def.level, ilvl: it.ilvl } });
    for (const g of def.groups) {
      if (seenGroups.has(g)) issues.push({ key: 'val.groupConflict', params: { a: seenGroups.get(g)!, b: def.text } });
      seenGroups.set(g, def.text);
    }
  }
  const lim = limitsFor(ctx, it.rarity, it.baseId);
  const c = sideCounts(ctx, it);
  if (it.rarity === 'normal' && it.mods.length > 0) issues.push({ key: 'val.normalHasMods' });
  if (c.prefix > lim.prefix) issues.push({ key: 'val.tooManyPrefixes', params: { n: c.prefix, max: lim.prefix } });
  if (c.suffix > lim.suffix) issues.push({ key: 'val.tooManySuffixes', params: { n: c.suffix, max: lim.suffix } });
  if (it.mods.filter((m) => isDesecratedMod(ctx, m)).length > 1) issues.push({ key: 'val.multipleDesecrated' });
  if (it.rarity !== 'rare' && hasDesecrated(ctx, it)) issues.push({ key: 'val.desecratedNotRare' });
  return issues;
}
