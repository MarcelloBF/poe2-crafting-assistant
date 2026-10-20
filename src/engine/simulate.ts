import type { Provenance } from '../data/types';
import { combineProvenance } from '../data/types';
import { type ActionSpec, WeightsUnavailableError, actionMaterials, applyAction, checkAction } from './actions';
import type { CraftContext } from './context';
import { type ItemState, itemKey, newItem } from './item';
import { wilson } from './probability';
import { type Strategy, decide } from './strategies';
import { buyOptionByKey } from './buy';
import { type TargetSpec, evaluate } from './target';
import { mulberry32 } from './rng';

/** Nome usado no registro de materiais para "uma base nova". */
export const BASE_MATERIAL = '__base__';
/** Nome usado no registro de materiais para "um item mágico comprado". */
export const BUY_MATERIAL = '__buy__';

export interface FinalState {
  key: string;
  item: ItemState;
  count: number;
  success: boolean;
  reasonKey: string;
}

export interface RunStats {
  runs: number;
  successes: number;
  pSuccess: number;
  ci: [number, number];
  meanActions: number;
  /** Média de materiais consumidos por execução (nome em inglês -> quantidade). */
  usagePerRun: Record<string, number>;
  /** Média de materiais por execução bem-sucedida. */
  usagePerSuccessRun: Record<string, number>;
  endReasons: Record<string, number>;
  finals: FinalState[];
  provenance: Provenance;
  error?: 'weights';
  /** Custo em materiais de cada execução (para distribuição de custos). */
  perRunUsage: Record<string, number>[];
  perRunSuccess: boolean[];
}

export interface SimOptions {
  runs: number;
  seed?: number;
  start?: ItemState;
  /** Ações máximas absolutas por execução (proteção). */
  hardCap?: number;
  keepPerRun?: boolean;
}

function emptyStats(): RunStats {
  return {
    runs: 0,
    successes: 0,
    pSuccess: 0,
    ci: [0, 1],
    meanActions: 0,
    usagePerRun: {},
    usagePerSuccessRun: {},
    endReasons: {},
    finals: [],
    provenance: { confidence: 'confirmed', assumptions: [] },
    perRunUsage: [],
    perRunSuccess: [],
  };
}

function finish(st: RunStats, totalActions: number, usageSum: Record<string, number>, usageSucc: Record<string, number>, finals: Map<string, FinalState>) {
  st.pSuccess = st.runs ? st.successes / st.runs : 0;
  st.ci = wilson(st.successes, st.runs);
  st.meanActions = st.runs ? totalActions / st.runs : 0;
  for (const [k, v] of Object.entries(usageSum)) st.usagePerRun[k] = v / Math.max(1, st.runs);
  for (const [k, v] of Object.entries(usageSucc)) st.usagePerSuccessRun[k] = v / Math.max(1, st.successes);
  st.finals = [...finals.values()].sort((a, b) => b.count - a.count).slice(0, 12);
}

/**
 * Simulação de Monte Carlo de uma estratégia. Cada execução começa de uma base nova (ou do item informado)
 * e termina em sucesso, recomeço (base descartada) ou falha. Usa exatamente as mesmas regras do cálculo exato.
 */
export function simulateStrategy(ctx: CraftContext, s: Strategy, t: TargetSpec, opts: SimOptions): RunStats {
  const rng = mulberry32(opts.seed ?? 12345);
  const st = emptyStats();
  const usageSum: Record<string, number> = {};
  const usageSucc: Record<string, number> = {};
  const finals = new Map<string, FinalState>();
  let totalActions = 0;
  const hardCap = opts.hardCap ?? 500;
  // Estratégia de compra: cada execução começa no item mágico comprado (e custa uma compra).
  const bought = !opts.start && s.params.buy ? buyOptionByKey(ctx, t, s.params.buy)?.item : undefined;
  try {
    for (let r = 0; r < opts.runs; r++) {
      let it = opts.start ?? bought ?? newItem(t.baseId, t.ilvl);
      const usage: Record<string, number> = {};
      if (!opts.start) usage[bought ? BUY_MATERIAL : BASE_MATERIAL] = 1;
      let actions = 0;
      let success = false;
      let reasonKey = 'dec.tooManyActions';
      for (;;) {
        const d = actions >= hardCap ? ({ kind: 'restart', reasonKey: 'dec.tooManyActions' } as const) : decide(ctx, s, t, it, actions);
        if (d.kind === 'success') {
          success = true;
          reasonKey = d.reasonKey;
          break;
        }
        if (d.kind !== 'action') {
          reasonKey = d.reasonKey;
          break;
        }
        if (!checkAction(ctx, it, d.spec).ok) {
          reasonKey = 'dec.invalidAction';
          break;
        }
        const res = applyAction(ctx, it, d.spec, rng);
        st.provenance = combineProvenance(st.provenance, res.provenance);
        it = res.item;
        actions++;
        for (const m of actionMaterials(ctx, d.spec)) usage[m] = (usage[m] ?? 0) + 1;
      }
      st.runs++;
      totalActions += actions;
      if (success) st.successes++;
      st.endReasons[reasonKey] = (st.endReasons[reasonKey] ?? 0) + 1;
      for (const [k, v] of Object.entries(usage)) {
        usageSum[k] = (usageSum[k] ?? 0) + v;
        if (success) usageSucc[k] = (usageSucc[k] ?? 0) + v;
      }
      if (opts.keepPerRun !== false) {
        st.perRunUsage.push(usage);
        st.perRunSuccess.push(success);
      }
      const key = itemKey(it);
      const f = finals.get(key);
      if (f) f.count++;
      else finals.set(key, { key, item: it, count: 1, success, reasonKey });
    }
  } catch (e) {
    if (e instanceof WeightsUnavailableError) {
      const out = emptyStats();
      out.error = 'weights';
      out.provenance = { confidence: 'unavailable', assumptions: ['assume.noWeights'] };
      return out;
    }
    throw e;
  }
  finish(st, totalActions, usageSum, usageSucc, finals);
  if (st.provenance.confidence === 'confirmed' && st.successes > 0 && st.successes < st.runs) {
    // Resultado amostral: confiança "estimada" mesmo com regras/pesos confirmados (erro de amostragem).
    st.provenance = combineProvenance(st.provenance, { confidence: 'estimated', assumptions: ['assume.sampling'] });
  }
  return st;
}

/** Simula uma sequência fixa de ações (modo do simulador usado para comparar com a enumeração exata). */
export function simulateSequence(ctx: CraftContext, start: ItemState, specs: ActionSpec[], t: TargetSpec, runs: number, seed = 777): RunStats {
  const rng = mulberry32(seed);
  const st = emptyStats();
  const usageSum: Record<string, number> = {};
  const usageSucc: Record<string, number> = {};
  const finals = new Map<string, FinalState>();
  let totalActions = 0;
  try {
    for (let r = 0; r < runs; r++) {
      let it = start;
      const usage: Record<string, number> = {};
      let actions = 0;
      let blocked = false;
      for (const spec of specs) {
        if (!checkAction(ctx, it, spec).ok) {
          blocked = true;
          continue;
        }
        const res = applyAction(ctx, it, spec, rng);
        st.provenance = combineProvenance(st.provenance, res.provenance);
        it = res.item;
        actions++;
        for (const m of actionMaterials(ctx, spec)) usage[m] = (usage[m] ?? 0) + 1;
      }
      const success = evaluate(ctx, t, it).allRequiredIgnoringValues;
      st.runs++;
      totalActions += actions;
      if (success) st.successes++;
      const reasonKey = success ? 'dec.success' : blocked ? 'dec.invalidAction' : 'sim.notReached';
      st.endReasons[reasonKey] = (st.endReasons[reasonKey] ?? 0) + 1;
      for (const [k, v] of Object.entries(usage)) {
        usageSum[k] = (usageSum[k] ?? 0) + v;
        if (success) usageSucc[k] = (usageSucc[k] ?? 0) + v;
      }
      st.perRunUsage.push(usage);
      st.perRunSuccess.push(success);
      const key = itemKey(it);
      const f = finals.get(key);
      if (f) f.count++;
      else finals.set(key, { key, item: it, count: 1, success, reasonKey });
    }
  } catch (e) {
    if (e instanceof WeightsUnavailableError) {
      const out = emptyStats();
      out.error = 'weights';
      out.provenance = { confidence: 'unavailable', assumptions: ['assume.noWeights'] };
      return out;
    }
    throw e;
  }
  finish(st, totalActions, usageSum, usageSucc, finals);
  return st;
}

/**
 * Teste de divergência entre a probabilidade exata e a frequência simulada (aproximação normal).
 * Retorna o escore z; |z| > 4 indica divergência que merece investigação.
 */
export function divergenceZ(pExact: number, successes: number, runs: number): number {
  if (runs === 0) return 0;
  const pObs = successes / runs;
  const se = Math.sqrt(Math.max(pExact * (1 - pExact), 1e-12) / runs);
  return (pObs - pExact) / se;
}
