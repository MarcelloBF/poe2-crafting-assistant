import type { Dataset } from '../data/types';
import type { CraftContext } from '../engine/context';
import type { Job, JobResult } from './protocol';

let worker: Worker | null = null;
let initedWith: Dataset | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(data: Dataset): Worker {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
  }
  if (initedWith !== data) {
    worker.postMessage({ type: 'init', data });
    initedWith = data;
  }
  return worker;
}

/** Executa um trabalho pesado do motor no Web Worker, com o mesmo contexto (regras, pesos, essências). */
export function runJob<J extends Job>(ctx: CraftContext, job: J): Promise<JobResult<J['kind']>> {
  const w = getWorker(ctx.data);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, rules: ctx.rules, weights: ctx.weights, essences: ctx.essences, job });
  });
}
