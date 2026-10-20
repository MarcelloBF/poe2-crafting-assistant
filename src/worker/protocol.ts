import type { EssenceDef, GameRules } from '../data/rules';
import type { ActionSpec } from '../engine/actions';
import type { Comparison } from '../engine/compare';
import type { WeightSettings } from '../engine/context';
import type { PriceBook } from '../engine/cost';
import type { ItemState } from '../engine/item';
import type { SequenceResult } from '../engine/probability';
import type { RunStats } from '../engine/simulate';
import type { Applicability, Strategy } from '../engine/strategies';
import type { TargetSpec } from '../engine/target';

export type Job =
  | { kind: 'compare'; target: TargetSpec; runs: number; book: PriceBook | null; baseCost: number | null; start?: ItemState; buyPrices?: Record<string, number> }
  | { kind: 'simStrategy'; strategy: Strategy; target: TargetSpec; runs: number; seed: number; start?: ItemState }
  | { kind: 'simSequence'; start: ItemState; specs: ActionSpec[]; target: TargetSpec; runs: number; seed: number }
  | { kind: 'sequence'; start: ItemState; specs: ActionSpec[]; target: TargetSpec };

export interface JobRequest {
  id: number;
  rules: GameRules;
  weights: WeightSettings;
  essences: EssenceDef[];
  job: Job;
}

export interface CompareResult {
  comparison: Comparison;
  excluded: { strategy: Strategy; reason: Applicability }[];
}

export type JobResult<J extends Job['kind']> = J extends 'compare'
  ? CompareResult
  : J extends 'sequence'
    ? SequenceResult | null
    : RunStats;
