/// <reference lib="webworker" />
// Executa simulações e enumerações pesadas fora da thread da interface.
import type { Dataset } from '../data/types';
import type { EssenceDef, GameRules } from '../data/rules';
import { type CraftContext, type WeightSettings, createContext } from '../engine/context';
import { compareStrategies } from '../engine/compare';
import { sequenceProbability } from '../engine/probability';
import { simulateSequence, simulateStrategy } from '../engine/simulate';
import { candidateStrategies } from '../engine/strategies';
import type { JobRequest } from './protocol';

let data: Dataset | null = null;
let ctxKey = '';
let ctx: CraftContext | null = null;

function getCtx(rules: GameRules, weights: WeightSettings, essences: EssenceDef[]): CraftContext {
  const key = JSON.stringify([rules, weights.hypothesis, weights.table?.importedAt, weights.table?.source, essences]);
  if (!ctx || key !== ctxKey) {
    ctx = createContext(data!, rules, weights, essences);
    ctxKey = key;
  }
  return ctx;
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    data = msg.data;
    ctx = null;
    return;
  }
  const req = msg as JobRequest;
  try {
    if (!data) throw new Error('dataset not initialised');
    const c = getCtx(req.rules, req.weights, req.essences);
    let result: unknown;
    switch (req.job.kind) {
      case 'compare': {
        const { target, runs, book, baseCost, start, buyPrices } = req.job;
        const { strategies, excluded } = candidateStrategies(c, target);
        result = { comparison: compareStrategies(c, strategies, target, runs, book, baseCost, start, buyPrices ?? {}), excluded };
        break;
      }
      case 'simStrategy': {
        const { strategy, target, runs, seed, start } = req.job;
        result = simulateStrategy(c, strategy, target, { runs, seed, start });
        break;
      }
      case 'simSequence': {
        const { start, specs, target, runs, seed } = req.job;
        result = simulateSequence(c, start, specs, target, runs, seed);
        break;
      }
      case 'sequence': {
        const { start, specs, target } = req.job;
        result = sequenceProbability(c, start, specs, target);
        break;
      }
    }
    (self as unknown as Worker).postMessage({ id: req.id, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, error: String((e as Error)?.message ?? e) });
  }
};
