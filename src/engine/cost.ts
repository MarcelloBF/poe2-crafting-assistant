import { BASE_MATERIAL, BUY_MATERIAL } from './simulate';

/** Preço de um material, sempre em Exalted Orbs (unidade de referência do PoE2). */
export interface PriceEntry {
  value: number;
  source: 'poe.ninja' | 'manual' | 'file';
  updatedAt: string;
}

export interface PriceBook {
  league: string;
  unit: 'exalted';
  entries: Record<string, PriceEntry>;
  /** Divine em exalted no momento da coleta (para exibir em divines). */
  divineInExalted?: number;
  fetchedAt?: string;
  source?: string;
}

export interface CostResult {
  /** null se algum material relevante não tiver preço. */
  total: number | null;
  /** Soma apenas do que tem preço. */
  partial: number;
  missing: string[];
  stale: string[];
}

export const STALE_HOURS = 24;

export function isStale(entry: PriceEntry, now = Date.now()): boolean {
  if (entry.source === 'manual') return false;
  return now - Date.parse(entry.updatedAt) > STALE_HOURS * 3600_000;
}

/** Custo de um conjunto de materiais. A base usa baseCost e o item comprado usa buyCost (null = não informado). */
export function costOfUsage(usage: Record<string, number>, book: PriceBook | null, baseCost: number | null, now = Date.now(), buyCost: number | null = null): CostResult {
  let partial = 0;
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [name, qty] of Object.entries(usage)) {
    if (qty <= 0) continue;
    if (name === BASE_MATERIAL || name === BUY_MATERIAL) {
      const price = name === BASE_MATERIAL ? baseCost : buyCost;
      if (price == null) missing.push(name);
      else partial += price * qty;
      continue;
    }
    const e = book?.entries[name];
    if (!e) {
      missing.push(name);
      continue;
    }
    if (isStale(e, now)) stale.push(name);
    partial += e.value * qty;
  }
  return { total: missing.length ? null : partial, partial, missing, stale };
}

/**
 * Custo esperado total até o primeiro sucesso (teorema da renovação):
 * E[custo total] = E[custo por execução] / P(sucesso por execução).
 */
export function expectedTotalCost(meanCostPerRun: number, pSuccess: number): number | null {
  if (!(pSuccess > 0)) return null;
  return meanCostPerRun / pSuccess;
}

/** Percentis do custo total até o sucesso, por reamostragem das execuções simuladas. */
export function costPercentiles(
  perRunCost: number[],
  perRunSuccess: boolean[],
  seedRng: () => number,
  samples = 2000,
  maxRunsPerSample = 100_000,
): { p50: number; p90: number } | null {
  const n = perRunCost.length;
  if (!n || !perRunSuccess.some(Boolean)) return null;
  const totals: number[] = [];
  for (let s = 0; s < samples; s++) {
    let total = 0;
    for (let i = 0; i < maxRunsPerSample; i++) {
      const k = Math.floor(seedRng() * n);
      total += perRunCost[k];
      if (perRunSuccess[k]) break;
    }
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  return { p50: totals[Math.floor(samples * 0.5)], p90: totals[Math.floor(samples * 0.9)] };
}

/** Converte a resposta do endpoint público do poe.ninja (PoE2 exchange overview) em entradas de preço. */
export function parseNinjaExchange(json: any, fetchedAt: string): { entries: Record<string, PriceEntry>; divineInExalted?: number } {
  const entries: Record<string, PriceEntry> = {};
  const names = new Map<string, string>();
  for (const it of json?.items ?? []) names.set(it.id, it.name);
  const exPerPrimary: number | undefined = json?.core?.rates?.exalted;
  const primary: string | undefined = json?.core?.primary;
  if (!exPerPrimary) return { entries };
  for (const line of json?.lines ?? []) {
    const name = names.get(line.id);
    if (!name || typeof line.primaryValue !== 'number') continue;
    entries[name] = { value: line.primaryValue * exPerPrimary, source: 'poe.ninja', updatedAt: fetchedAt };
  }
  if (primary === 'divine') {
    const divName = (json.core.items ?? []).find((i: any) => i.id === 'divine')?.name ?? 'Divine Orb';
    entries[divName] = { value: exPerPrimary, source: 'poe.ninja', updatedAt: fetchedAt };
  }
  return { entries, divineInExalted: primary === 'divine' ? exPerPrimary : undefined };
}
