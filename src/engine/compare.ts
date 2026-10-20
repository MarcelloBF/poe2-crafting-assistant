import type { CraftContext } from './context';
import { type CostResult, type PriceBook, costOfUsage, costPercentiles, expectedTotalCost } from './cost';
import type { ItemState } from './item';
import { type GeometricStats, geometric } from './probability';
import { mulberry32 } from './rng';
import { BASE_MATERIAL, type RunStats, simulateStrategy } from './simulate';
import type { Strategy } from './strategies';
import type { TargetSpec } from './target';

export interface StrategyEvaluation {
  strategy: Strategy;
  stats: RunStats;
  costPerRun: CostResult;
  attempts: GeometricStats | null;
  expectedTotal: number | null;
  /** Total esperado de materiais (contagem) até o sucesso — usado se faltarem preços. */
  expectedUnits: number | null;
  percentiles: { p50: number; p90: number } | null;
  /** Custos calculados sem o preço da base (não informado). */
  baseExcluded?: boolean;
}

export interface ProfilePick {
  strategyId: string | null;
  criterionKey: string;
  noteKey?: string;
}

export interface Comparison {
  evaluations: StrategyEvaluation[];
  economical: ProfilePick;
  balanced: ProfilePick;
  consistent: ProfilePick;
  limitationKeys: string[];
}

export function evaluateStrategy(
  ctx: CraftContext,
  s: Strategy,
  t: TargetSpec,
  runs: number,
  book: PriceBook | null,
  baseCost: number | null,
  start?: ItemState,
  seed = 2024,
  buyPrices: Record<string, number> = {},
): StrategyEvaluation {
  const stats = simulateStrategy(ctx, s, t, { runs, seed, start });
  // Sem preço de base, os custos são calculados sem a base (sinalizado em baseExcluded).
  // Sem preço do item comprado o custo fica indisponível: comprar nunca é tratado como grátis.
  const baseExcluded = baseCost == null && (stats.usagePerRun[BASE_MATERIAL] ?? 0) > 0;
  const effectiveBase = baseExcluded ? 0 : baseCost;
  const buyCost = s.params.buy != null ? buyPrices[s.params.buy] ?? null : null;
  const costPerRun = costOfUsage(stats.usagePerRun, book, effectiveBase, Date.now(), buyCost);
  const attempts = geometric(stats.pSuccess);
  const expectedTotal = costPerRun.total != null ? expectedTotalCost(costPerRun.total, stats.pSuccess) : null;
  const unitsPerRun = Object.values(stats.usagePerRun).reduce((a, b) => a + b, 0);
  const expectedUnits = stats.pSuccess > 0 ? unitsPerRun / stats.pSuccess : null;
  let percentiles = null;
  if (costPerRun.total != null && stats.perRunUsage.length) {
    const perRunCost = stats.perRunUsage.map((u) => costOfUsage(u, book, effectiveBase, Date.now(), buyCost).partial);
    percentiles = costPercentiles(perRunCost, stats.perRunSuccess, mulberry32(seed + 1));
  }
  return { strategy: s, stats, costPerRun, attempts, expectedTotal, expectedUnits, percentiles, baseExcluded };
}

function argmin<T>(xs: T[], f: (x: T) => number | null): T | null {
  let best: T | null = null;
  let bv = Infinity;
  for (const x of xs) {
    const v = f(x);
    if (v != null && Number.isFinite(v) && v < bv) {
      bv = v;
      best = x;
    }
  }
  return best;
}

/**
 * Escolhe a estratégia de cada perfil, com o critério explícito:
 * - Econômico: menor custo total esperado (ou menor nº esperado de materiais, se faltarem preços).
 * - Maior consistência: maior chance de sucesso por base; desempate pelo menor nº esperado de ações.
 * - Equilibrado: menor soma ponderada de posições (custo 40%, 1 - chance 30%, ações 30%).
 */
export function pickProfiles(evals: StrategyEvaluation[]): Omit<Comparison, 'evaluations'> {
  const viable = evals.filter((e) => e.stats.successes > 0 && !e.stats.error);
  const limitationKeys: string[] = [];
  if (evals.some((e) => e.stats.error === 'weights')) limitationKeys.push('cmp.limit.weights');
  if (!viable.length) {
    limitationKeys.push('cmp.limit.noViable');
    const none: ProfilePick = { strategyId: null, criterionKey: 'cmp.crit.none' };
    return { economical: none, balanced: none, consistent: none, limitationKeys };
  }
  if (viable.length < 2) limitationKeys.push('cmp.limit.single');
  // Compara por valor quando ao menos uma estratégia viável tem todos os preços; as demais ficam fora do perfil econômico.
  const priced = viable.filter((e) => e.expectedTotal != null);
  const allPriced = priced.length > 0;
  if (!allPriced) limitationKeys.push('cmp.limit.prices');
  else if (priced.length < viable.length) limitationKeys.push('cmp.limit.somePrices');
  const costOf = (e: StrategyEvaluation) => (allPriced ? e.expectedTotal : e.expectedUnits);
  const eco = argmin(viable, costOf);
  const cons = [...viable].sort((a, b) => b.stats.pSuccess - a.stats.pSuccess || a.stats.meanActions - b.stats.meanActions)[0];
  const rank = (f: (e: StrategyEvaluation) => number) => {
    const sorted = [...viable].sort((a, b) => f(a) - f(b));
    return new Map(sorted.map((e, i) => [e.strategy.id, viable.length > 1 ? i / (viable.length - 1) : 0]));
  };
  const rc = rank((e) => costOf(e) ?? Infinity);
  const rp = rank((e) => 1 - e.stats.pSuccess);
  const ra = rank((e) => e.stats.meanActions / Math.max(e.stats.pSuccess, 1e-9));
  const bal = argmin(viable, (e) => 0.4 * rc.get(e.strategy.id)! + 0.3 * rp.get(e.strategy.id)! + 0.3 * ra.get(e.strategy.id)!);
  return {
    economical: { strategyId: eco?.strategy.id ?? null, criterionKey: allPriced ? 'cmp.crit.ecoCost' : 'cmp.crit.ecoUnits', noteKey: allPriced ? undefined : 'cmp.note.unitsNotValue' },
    consistent: { strategyId: cons.strategy.id, criterionKey: 'cmp.crit.consistent' },
    balanced: { strategyId: bal?.strategy.id ?? null, criterionKey: 'cmp.crit.balanced' },
    limitationKeys,
  };
}

export function compareStrategies(
  ctx: CraftContext,
  strategies: Strategy[],
  t: TargetSpec,
  runs: number,
  book: PriceBook | null,
  baseCost: number | null,
  start?: ItemState,
  buyPrices: Record<string, number> = {},
): Comparison {
  // Partindo de um item já em andamento, estratégias de compra não fazem sentido.
  const list = start ? strategies.filter((s) => !s.params.buy) : strategies;
  const evaluations = list.map((s, i) => evaluateStrategy(ctx, s, t, runs, book, baseCost, start, 1000 + i, buyPrices));
  return { evaluations, ...pickProfiles(evaluations) };
}
