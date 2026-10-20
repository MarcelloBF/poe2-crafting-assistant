import type { BaseDef, Dataset, Gen, ModDef, Provenance } from '../data/types';
import type { EssenceDef, GameRules } from '../data/rules';

/** Hipótese de pesos usada quando não há tabela de pesos. Sempre marcada como estimativa. */
export type WeightHypothesis = { kind: 'none' } | { kind: 'uniform' } | { kind: 'tierDecay'; factor: number };

/** Tabela de pesos relativos importada pelo jogador (ex.: exportada de uma ferramenta da comunidade). */
export interface WeightTable {
  source: string;
  /** "confirmed" só deve ser usado se a fonte for oficial/verificável. */
  confidence: 'confirmed' | 'estimated';
  importedAt: string;
  weights: Record<string, number>;
}

export interface WeightSettings {
  table: WeightTable | null;
  hypothesis: WeightHypothesis;
}

export interface TierInfo {
  /** 1 = melhor tier (maior nível) desta família nesta base. */
  tier: number;
  tierCount: number;
}

/** normal: sorteável por moedas • desecrated: só por profanação (Abyss) • essence: só por essência. */
export type EntryKind = 'normal' | 'desecrated' | 'essence';

export interface PoolEntry {
  mod: ModDef;
  kind: EntryKind;
  family: string;
  tier: number;
  tierCount: number;
  /** Posição a partir do tier mais baixo (0 = tier mais fraco). */
  rankFromBottom: number;
}

export interface BasePool {
  base: BaseDef;
  /** Modificadores que o cliente permite gerar nesta base (flag > 0), qualquer nível. */
  entries: PoolEntry[];
  byMod: Map<string, PoolEntry>;
  byFamily: Map<string, PoolEntry[]>;
}

export interface CraftContext {
  data: Dataset;
  rules: GameRules;
  weights: WeightSettings;
  essences: EssenceDef[];
  modsById: Map<string, ModDef>;
  basesById: Map<string, BaseDef>;
  poolCache: Map<string, BasePool>;
}

/** Família de tiers. Mods profanados e exclusivos de essência formam famílias próprias (não misturam tiers). */
export function familyKey(mod: Pick<ModDef, 'gen' | 'type' | 'desecrated' | 'essenceOnly'>): string {
  return `${mod.gen}:${mod.type}${mod.desecrated ? '@abyss' : mod.essenceOnly ? '@essence' : ''}`;
}

export function familyGen(family: string): Gen {
  return family.startsWith('prefix:') ? 'prefix' : 'suffix';
}

export function familyKind(family: string): EntryKind {
  return family.endsWith('@abyss') ? 'desecrated' : family.endsWith('@essence') ? 'essence' : 'normal';
}

/** Essências usadas pelo motor: as do dataset + as cadastradas pelo jogador (mesmo id = cadastro do jogador). */
export function createContext(data: Dataset, rules: GameRules, weights: WeightSettings, essences: EssenceDef[] = []): CraftContext {
  const ids = new Set(essences.map((e) => e.id));
  const all = [...(data.essences ?? []).filter((e) => !ids.has(e.id)), ...essences];
  return {
    data,
    rules,
    weights,
    essences: all,
    modsById: new Map(data.mods.map((m) => [m.id, m])),
    basesById: new Map(data.bases.map((b) => [b.id, b])),
    poolCache: new Map(),
  };
}

/** Flag de geração do modificador na base: a primeira tag da lista do mod presente na base decide. */
export function spawnFlag(mod: ModDef, base: BaseDef): number {
  const tags = new Set(base.tags);
  for (const [tag, w] of mod.spawn) if (tags.has(tag)) return w;
  return 0;
}

export function getBasePool(ctx: CraftContext, baseId: string): BasePool {
  const cached = ctx.poolCache.get(baseId);
  if (cached) return cached;
  const base = ctx.basesById.get(baseId);
  if (!base) throw new Error(`Base desconhecida: ${baseId}`);
  // Mods exclusivos de essência que alguma essência garante nesta classe de item.
  const essenceMods = new Set<string>();
  for (const e of ctx.essences) for (const ef of e.effects) if (ef.itemClasses.includes(base.itemClass)) ef.modIds.forEach((id) => essenceMods.add(id));
  const fam = new Map<string, ModDef[]>();
  for (const m of ctx.data.mods) {
    const ok = m.essenceOnly ? essenceMods.has(m.id) : spawnFlag(m, base) > 0;
    if (!ok) continue;
    const k = familyKey(m);
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k)!.push(m);
  }
  const entries: PoolEntry[] = [];
  const byFamily = new Map<string, PoolEntry[]>();
  for (const [k, list] of fam) {
    // Tier 1 = maior nível exigido; empate: maior valor máximo do primeiro stat.
    list.sort((a, b) => b.level - a.level || (b.stats[0]?.max ?? 0) - (a.stats[0]?.max ?? 0));
    const kind = familyKind(k);
    const fe = list.map((mod, i) => ({ mod, kind, family: k, tier: i + 1, tierCount: list.length, rankFromBottom: list.length - 1 - i }));
    byFamily.set(k, fe);
    entries.push(...fe);
  }
  const pool: BasePool = { base, entries, byMod: new Map(entries.map((e) => [e.mod.id, e])), byFamily };
  ctx.poolCache.set(baseId, pool);
  return pool;
}

export interface ResolvedWeight {
  weight: number;
  provenance: Provenance;
}

/** Resolve o peso relativo de um modificador elegível. Nunca inventa: sem tabela nem hipótese => indisponível. */
export function resolveWeight(ctx: CraftContext, entry: PoolEntry): ResolvedWeight {
  const table = ctx.weights.table;
  if (table && table.weights[entry.mod.id] !== undefined) {
    return {
      weight: table.weights[entry.mod.id],
      provenance: { confidence: table.confidence, assumptions: table.confidence === 'confirmed' ? [] : ['assume.externalWeights'] },
    };
  }
  const h = ctx.weights.hypothesis;
  if (h.kind === 'uniform') return { weight: 1, provenance: { confidence: 'estimated', assumptions: ['assume.uniformWeights'] } };
  if (h.kind === 'tierDecay') {
    return { weight: Math.pow(h.factor, entry.rankFromBottom), provenance: { confidence: 'estimated', assumptions: ['assume.tierDecay'] } };
  }
  return { weight: NaN, provenance: { confidence: 'unavailable', assumptions: ['assume.noWeights'] } };
}
