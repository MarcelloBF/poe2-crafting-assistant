import type { Provenance } from '../data/types';
import { combineProvenance } from '../data/types';
import { type ActionSpec, type Outcome, MAX_EXACT_STATES, actionDistribution, checkAction, mergeOutcomes } from './actions';
import { type CraftContext, getBasePool } from './context';
import type { ItemState } from './item';
import { type TargetSpec, acceptedEntries, completableByAdding, evaluate, missingRequired } from './target';

export type Method = 'exact' | 'enumeration' | 'montecarlo' | 'none';

export interface ProbResult {
  /** null quando indisponível. */
  value: number | null;
  provenance: Provenance;
  method: Method;
  /** Intervalo de confiança 95% (simulações). */
  ci?: [number, number];
  noteKey?: string;
}

/** Resultados 0 ou 1 não dependem de pesos: são estruturalmente confirmados. */
function finalize(value: number, prov: Provenance, method: Method): ProbResult {
  if (prov.confidence === 'unavailable') return { value: null, provenance: prov, method: 'none', noteKey: 'prob.needWeights' };
  const v = Math.min(1, Math.max(0, value));
  if (v < 1e-12 || v > 1 - 1e-12) return { value: Math.round(v), provenance: { confidence: 'confirmed', assumptions: [] }, method };
  return { value: v, provenance: prov, method };
}

/** Intervalo de Wilson (95%) para k sucessos em n tentativas. */
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

export interface GeometricStats {
  expected: number;
  /** Tentativas para 50% / 90% / 99% de chance acumulada. */
  p50: number;
  p90: number;
  p99: number;
}

export function geometric(p: number): GeometricStats | null {
  if (!(p > 0)) return null;
  if (p >= 1) return { expected: 1, p50: 1, p90: 1, p99: 1 };
  const q = (x: number) => Math.max(1, Math.ceil(Math.log(1 - x) / Math.log(1 - p)));
  return { expected: 1 / p, p50: q(0.5), p90: q(0.9), p99: q(0.99) };
}

/** Chance acumulada de pelo menos um sucesso em n tentativas independentes. */
export function cumulative(p: number, n: number): number {
  return 1 - Math.pow(1 - p, n);
}

export interface NextActionAnalysis {
  check: ReturnType<typeof checkAction>;
  /** Chance de o item ficar pronto (todos os obrigatórios) após a ação. */
  success: ProbResult;
  /** Chance de cada requisito estar satisfeito após a ação. */
  perRequirement: ProbResult[];
  /** Chance de o item continuar completável só adicionando mods. */
  stillCompletable: ProbResult;
  outcomes: Outcome[];
  provenance: Provenance;
  tooLarge: boolean;
}

/** Profanação sem preferência informada: o jogador escolhe mods que atendem requisitos faltantes (melhor tier primeiro). */
export function withDesecrationPreference(ctx: CraftContext, item: ItemState, spec: ActionSpec, t: TargetSpec): ActionSpec {
  if (ctx.rules.currencies[spec.currency]?.kind !== 'desecrate' || spec.prefer?.length) return spec;
  const prefer = missingRequired(ctx, t, item)
    .flatMap((r) => acceptedEntries(ctx, t, r))
    .sort((a, b) => a.tier - b.tier)
    .map((e) => e.mod.id);
  return { ...spec, prefer };
}

export function analyzeNextAction(ctx: CraftContext, item: ItemState, rawSpec: ActionSpec, t: TargetSpec): NextActionAnalysis {
  const spec = withDesecrationPreference(ctx, item, rawSpec, t);
  const check = checkAction(ctx, item, spec);
  const none: ProbResult = { value: null, provenance: { confidence: 'unavailable', assumptions: [] }, method: 'none' };
  if (!check.ok) return { check, success: none, perRequirement: t.requirements.map(() => none), stillCompletable: none, outcomes: [], provenance: none.provenance, tooLarge: false };
  const d = actionDistribution(ctx, item, spec);
  if (!d) return { check, success: { ...none, noteKey: 'prob.tooLarge' }, perRequirement: t.requirements.map(() => none), stillCompletable: none, outcomes: [], provenance: none.provenance, tooLarge: true };
  let succ = 0;
  let comp = 0;
  const per = t.requirements.map(() => 0);
  for (const o of d.outcomes) {
    const ev = evaluate(ctx, t, o.item);
    // Metas de valor: a ação não rola valores na distribuição exata; avaliamos família/tier.
    if (ev.allRequiredIgnoringValues) succ += o.p;
    ev.met.forEach((m, i) => (m || ev.valueShort[i]) && (per[i] += o.p));
    if (ev.allRequiredIgnoringValues || completableByAdding(ctx, t, o.item, 'rare')) comp += o.p;
  }
  return {
    check,
    success: finalize(succ, d.provenance, 'exact'),
    perRequirement: per.map((p) => finalize(p, d.provenance, 'exact')),
    stillCompletable: finalize(comp, d.provenance, 'exact'),
    outcomes: d.outcomes.sort((a, b) => b.p - a.p),
    provenance: d.provenance,
    tooLarge: false,
  };
}

export interface SequenceResult {
  success: ProbResult;
  perRequirement: ProbResult[];
  /** Probabilidade de alguma ação da sequência não poder ser aplicada (estado inválido para ela). */
  blocked: number;
  states: number;
  outcomes: Outcome[];
}

/**
 * Enumeração exata de uma sequência fixa de ações a partir de um item.
 * Se uma ação não puder ser aplicada num estado, o estado segue inalterado e é contado em "blocked".
 * Devolve null se o número de estados exceder o limite (use simulação).
 */
export function sequenceProbability(ctx: CraftContext, item: ItemState, specs: ActionSpec[], t: TargetSpec, maxStates = MAX_EXACT_STATES): SequenceResult | null {
  let cur: Outcome[] = [{ item, p: 1 }];
  let prov: Provenance = { confidence: 'confirmed', assumptions: [] };
  let blocked = 0;
  for (const spec of specs) {
    const next: Outcome[] = [];
    for (const o of cur) {
      if (!checkAction(ctx, o.item, spec).ok) {
        blocked += o.p;
        next.push(o);
        continue;
      }
      const d = actionDistribution(ctx, o.item, withDesecrationPreference(ctx, o.item, spec, t), maxStates);
      if (!d) return null;
      prov = combineProvenance(prov, d.provenance);
      if (d.provenance.confidence === 'unavailable') {
        const na: ProbResult = { value: null, provenance: prov, method: 'none', noteKey: 'prob.needWeights' };
        return { success: na, perRequirement: t.requirements.map(() => na), blocked: 0, states: 0, outcomes: [] };
      }
      for (const x of d.outcomes) next.push({ item: x.item, p: o.p * x.p });
      if (next.length > maxStates * 4) return null;
    }
    cur = mergeOutcomes(next);
    if (cur.length > maxStates) return null;
  }
  let succ = 0;
  const per = t.requirements.map(() => 0);
  for (const o of cur) {
    const ev = evaluate(ctx, t, o.item);
    if (ev.allRequiredIgnoringValues) succ += o.p;
    ev.met.forEach((m, i) => (m || ev.valueShort[i]) && (per[i] += o.p));
  }
  return {
    success: finalize(succ, prov, 'enumeration'),
    perRequirement: per.map((p) => finalize(p, prov, 'enumeration')),
    blocked,
    states: cur.length,
    outcomes: cur.sort((a, b) => b.p - a.p),
  };
}

/**
 * Chance de a próxima ação adicionar um mod da família com tier <= maxTier,
 * e a chance condicional de atingir o tier dado que a família foi sorteada.
 */
export function familyTierChance(ctx: CraftContext, item: ItemState, spec: ActionSpec, family: string, maxTier: number): { family: ProbResult; tier: ProbResult; tierGivenFamily: ProbResult } {
  const d = checkAction(ctx, item, spec).ok ? actionDistribution(ctx, item, spec) : null;
  const none: ProbResult = { value: null, provenance: { confidence: 'unavailable', assumptions: [] }, method: 'none' };
  if (!d) return { family: none, tier: none, tierGivenFamily: none };
  const fam = getBasePool(ctx, item.baseId).byFamily.get(family) ?? [];
  const famIds = new Set(fam.map((e) => e.mod.id));
  const tierIds = new Set(fam.filter((e) => e.tier <= maxTier).map((e) => e.mod.id));
  const before = new Set(item.mods.map((m) => m.modId));
  let pf = 0;
  let pt = 0;
  for (const o of d.outcomes) {
    const added = o.item.mods.filter((m) => !before.has(m.modId)).map((m) => m.modId);
    if (added.some((x) => famIds.has(x))) pf += o.p;
    if (added.some((x) => tierIds.has(x))) pt += o.p;
  }
  return {
    family: finalize(pf, d.provenance, 'exact'),
    tier: finalize(pt, d.provenance, 'exact'),
    tierGivenFamily: pf > 0 ? finalize(pt / pf, d.provenance, 'exact') : { ...none, noteKey: 'prob.familyImpossible' },
  };
}

/** Chance (hipótese de valores uniformes) de todos os requisitos de valor ficarem ok após um Divine. */
export function divineSuccessChance(ctx: CraftContext, t: TargetSpec, item: ItemState): ProbResult {
  let p = 1;
  let any = false;
  for (const r of t.requirements) {
    if (r.minValue == null || !r.required) continue;
    const acc = new Set(acceptedEntries(ctx, t, r).map((e) => e.mod.id));
    const m = item.mods.find((x) => acc.has(x.modId));
    if (!m) return { value: null, provenance: { confidence: 'unavailable', assumptions: [] }, method: 'none', noteKey: 'prob.modMissing' };
    if (m.fractured) {
      if ((m.values?.[0] ?? -Infinity) < r.minValue) return finalize(0, { confidence: 'confirmed', assumptions: [] }, 'exact');
      continue;
    }
    const s = ctx.modsById.get(m.modId)!.stats[0];
    any = true;
    p *= r.minValue <= s.min ? 1 : r.minValue > s.max ? 0 : (s.max - r.minValue + 1) / (s.max - s.min + 1);
  }
  if (!any) return finalize(1, { confidence: 'confirmed', assumptions: [] }, 'exact');
  return finalize(p, { confidence: 'estimated', assumptions: ['assume.uniformValues'] }, 'exact');
}
