import type { Gen } from '../data/types';
import { boneSlotOf } from '../data/rules';
import { type CraftContext, type PoolEntry, familyGen, familyKey, familyKind, getBasePool } from './context';
import { type ItemState, type Rarity, hasDesecrated, limitsFor, takenGroups } from './item';

export interface Requirement {
  id: string;
  /** Família = "<prefix|suffix>:<tipo do mod>". */
  family: string;
  /** Pior tier aceito (1 = melhor). */
  minTier: number;
  /** Obrigatório para o item ser considerado pronto. Opcionais só entram na pontuação. */
  required: boolean;
  /** 1 (alta) a 3 (baixa). */
  priority: number;
  /** Valor mínimo do primeiro stat do mod (opcional). */
  minValue?: number | null;
}

export interface TargetSpec {
  baseId: string;
  ilvl: number;
  rarity: Exclude<Rarity, 'normal'>;
  requirements: Requirement[];
}

export interface TargetIssue {
  severity: 'error' | 'warning';
  key: string;
  params?: Record<string, string | number>;
  /** Parâmetros que são famílias de mod (para a interface exibir o rótulo no idioma do jogador). */
  families?: Record<string, string>;
}

/** Modificadores que satisfazem o requisito nesta base e neste nível de item. */
export function acceptedEntries(ctx: CraftContext, target: TargetSpec, req: Requirement): PoolEntry[] {
  const fam = getBasePool(ctx, target.baseId).byFamily.get(req.family) ?? [];
  return fam.filter((e) => e.tier <= req.minTier && e.mod.level <= target.ilvl);
}

const labelCache = new WeakMap<CraftContext, Map<string, string>>();

/** Rótulo genérico da família (texto do mod com números trocados por "#"). */
export function familyLabel(ctx: CraftContext, family: string): string {
  let cache = labelCache.get(ctx);
  if (!cache) {
    cache = new Map();
    for (const m of ctx.data.mods) {
      const k = familyKey(m);
      if (!cache.has(k)) cache.set(k, genericText(m.text));
    }
    labelCache.set(ctx, cache);
  }
  return cache.get(family) ?? family;
}

export function genericText(text: string): string {
  return text.replace(/\((-?\d+(?:\.\d+)?)--?\d+(?:\.\d+)?\)/g, '#').replace(/-?\d+(?:\.\d+)?/g, '#');
}

/** Validação completa: impede configurar itens impossíveis segundo os dados e regras implementadas. */
export function validateTarget(ctx: CraftContext, t: TargetSpec): TargetIssue[] {
  const issues: TargetIssue[] = [];
  const base = ctx.basesById.get(t.baseId);
  if (!base) return [{ severity: 'error', key: 'tgt.noBase' }];
  if (!Number.isInteger(t.ilvl) || t.ilvl < 1 || t.ilvl > 100) issues.push({ severity: 'error', key: 'tgt.badIlvl' });
  if (t.ilvl < base.dropLevel) issues.push({ severity: 'warning', key: 'tgt.ilvlBelowDrop', params: { drop: base.dropLevel } });
  const pool = getBasePool(ctx, t.baseId);
  const seen = new Set<string>();
  const sideCount: Record<Gen, number> = { prefix: 0, suffix: 0 };
  const reqGroups: { req: Requirement; groups: Set<string> }[] = [];
  for (const r of t.requirements) {
    const label = familyLabel(ctx, r.family);
    if (seen.has(r.family)) issues.push({ severity: 'error', key: 'tgt.duplicateFamily', params: { mod: label }, families: { mod: r.family } });
    seen.add(r.family);
    const fam = pool.byFamily.get(r.family);
    if (!fam) {
      issues.push({ severity: 'error', key: 'tgt.familyNotOnBase', params: { mod: label, base: base.name }, families: { mod: r.family } });
      continue;
    }
    if (r.minTier < 1 || r.minTier > fam.length) issues.push({ severity: 'error', key: 'tgt.badTier', params: { mod: label, max: fam.length }, families: { mod: r.family } });
    const acc = acceptedEntries(ctx, t, r);
    if (!acc.length) {
      const needed = Math.min(...fam.filter((e) => e.tier <= r.minTier).map((e) => e.mod.level));
      issues.push({ severity: 'error', key: 'tgt.ilvlTooLow', params: { mod: label, tier: r.minTier, level: needed }, families: { mod: r.family } });
      continue;
    }
    if (r.minValue != null) {
      const best = Math.max(...acc.map((e) => e.mod.stats[0]?.max ?? -Infinity));
      if (r.minValue > best) issues.push({ severity: 'error', key: 'tgt.valueTooHigh', params: { mod: label, max: best }, families: { mod: r.family } });
    }
    if (r.required) sideCount[familyGen(r.family)]++;
    const groups = new Set<string>();
    acc.forEach((e) => e.mod.groups.forEach((g) => groups.add(g)));
    reqGroups.push({ req: r, groups });
  }
  // Exclusividade de grupo: dois requisitos cujos modificadores aceitos compartilham grupo nunca coexistem.
  for (let i = 0; i < reqGroups.length; i++)
    for (let j = i + 1; j < reqGroups.length; j++) {
      const a = reqGroups[i];
      const b = reqGroups[j];
      if ([...a.groups].some((g) => b.groups.has(g)))
        issues.push({
          severity: a.req.required && b.req.required ? 'error' : 'warning',
          key: 'tgt.groupConflict',
          params: { a: familyLabel(ctx, a.req.family), b: familyLabel(ctx, b.req.family) },
          families: { a: a.req.family, b: b.req.family },
        });
    }
  const lim = limitsFor(ctx, t.rarity, t.baseId);
  if (sideCount.prefix > lim.prefix) issues.push({ severity: 'error', key: 'tgt.tooManyPrefixes', params: { n: sideCount.prefix, max: lim.prefix } });
  if (sideCount.suffix > lim.suffix) issues.push({ severity: 'error', key: 'tgt.tooManySuffixes', params: { n: sideCount.suffix, max: lim.suffix } });
  if (!t.requirements.some((r) => r.required)) issues.push({ severity: 'warning', key: 'tgt.noRequired' });
  // "Items with Desecrated Modifiers cannot be Desecrated again": no máximo um mod exclusivo da Abyss.
  const abyss = t.requirements.filter((r) => r.required && familyKind(r.family) === 'desecrated');
  if (abyss.length > 1) issues.push({ severity: 'error', key: 'tgt.multipleAbyss', params: { n: abyss.length } });
  if (abyss.length && t.rarity !== 'rare') issues.push({ severity: 'error', key: 'tgt.abyssNeedsRare' });
  if (abyss.length) {
    const slot = boneSlotOf(ctx.rules, base.itemClass);
    if (!slot) issues.push({ severity: 'error', key: 'tgt.abyssNoBone' });
  }
  return issues;
}

export interface Evaluation {
  /** Por requisito: satisfeito (família + tier). */
  met: boolean[];
  /** Família e tier satisfeitos, mas valor abaixo do mínimo. */
  valueShort: boolean[];
  allRequired: boolean;
  /** Família/tier ok para todos os obrigatórios (valores podem faltar). */
  allRequiredIgnoringValues: boolean;
  optionalMet: number;
}

export function evaluate(ctx: CraftContext, t: TargetSpec, it: ItemState): Evaluation {
  const met: boolean[] = [];
  const valueShort: boolean[] = [];
  for (const r of t.requirements) {
    const acc = new Set(acceptedEntries(ctx, t, r).map((e) => e.mod.id));
    const m = it.mods.find((x) => acc.has(x.modId));
    let ok = !!m;
    let short = false;
    if (m && r.minValue != null) {
      const v = m.values?.[0];
      if (v === undefined || v < r.minValue) {
        ok = false;
        short = true;
      }
    }
    met.push(ok);
    valueShort.push(short);
  }
  const rarityOk = it.rarity === t.rarity;
  const allRequired = rarityOk && t.requirements.every((r, i) => !r.required || met[i]);
  const allRequiredIgnoringValues = rarityOk && t.requirements.every((r, i) => !r.required || met[i] || valueShort[i]);
  const optionalMet = t.requirements.filter((r, i) => !r.required && met[i]).length;
  return { met, valueShort, allRequired, allRequiredIgnoringValues, optionalMet };
}

/** Mods do item que não ajudam nenhum requisito (obrigatório ou opcional). */
export function junkMods(ctx: CraftContext, t: TargetSpec, it: ItemState) {
  const useful = new Set<string>();
  for (const r of t.requirements) acceptedEntries(ctx, t, r).forEach((e) => useful.add(e.mod.id));
  return it.mods.filter((m) => !useful.has(m.modId));
}

/** Requisitos obrigatórios ainda não presentes (família/tier), por lado. */
export function missingRequired(ctx: CraftContext, t: TargetSpec, it: ItemState): Requirement[] {
  const ev = evaluate(ctx, t, it);
  return t.requirements.filter((r, i) => r.required && !ev.met[i] && !ev.valueShort[i]);
}

/**
 * O item ainda pode chegar ao objetivo apenas adicionando mods (sem remover nada)?
 * Falso se faltar espaço no lado ou se um mod existente bloquear o grupo de um requisito faltante.
 */
export function completableByAdding(ctx: CraftContext, t: TargetSpec, it: ItemState, rarity: Rarity = t.rarity): boolean {
  const missing = missingRequired(ctx, t, it);
  const lim = limitsFor(ctx, rarity, it.baseId);
  const counts = { prefix: 0, suffix: 0 };
  for (const m of it.mods) counts[ctx.modsById.get(m.modId)!.gen]++;
  const need = { prefix: 0, suffix: 0 };
  const groups = takenGroups(ctx, it);
  for (const r of missing) {
    need[familyGen(r.family)]++;
    const acc = acceptedEntries(ctx, t, r);
    if (!acc.some((e) => !e.mod.groups.some((g) => groups.has(g)))) return false;
    // Mod da Abyss só vem por profanação, e um item profanado não pode ser profanado de novo.
    if (familyKind(r.family) === 'desecrated' && hasDesecrated(ctx, it)) return false;
  }
  return counts.prefix + need.prefix <= lim.prefix && counts.suffix + need.suffix <= lim.suffix;
}

/** Probabilidade (hipótese: valores uniformes) de um mod rolar valor >= mínimo no primeiro stat. */
export function valueProbability(ctx: CraftContext, modId: string, minValue: number): number {
  const s = ctx.modsById.get(modId)?.stats[0];
  if (!s) return 0;
  if (minValue <= s.min) return 1;
  if (minValue > s.max) return 0;
  return (s.max - minValue + 1) / (s.max - s.min + 1);
}
