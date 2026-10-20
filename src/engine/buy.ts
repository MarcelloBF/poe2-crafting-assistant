// Compra de item parcial: em vez de transmutar bases até acertar, comprar um item mágico que já tem
// o(s) modificador(es) mais difícil(eis) e continuar o crafting a partir dele.

import type { Gen } from '../data/types';
import { type CraftContext, familyGen, familyKind } from './context';
import { type ItemState, eligiblePool } from './item';
import { type Requirement, type TargetSpec, acceptedEntries } from './target';

export interface BuyOption {
  /** Chave estável (base + mods) para guardar o preço informado pelo jogador. */
  key: string;
  sides: Gen[];
  /** Requisitos atendidos pelo item comprado. */
  requirementIds: string[];
  /** Mod representativo de cada requisito (o tier aceito mais barato) — usado na simulação. */
  modIds: string[];
  /** Valor mínimo do primeiro stat aceito por requisito (para o filtro de busca). */
  minValues: (number | null)[];
  item: ItemState;
}

/** Peso relativo de uma família no sorteio de uma Transmutação (para achar o requisito mais difícil). */
function familyShare(ctx: CraftContext, t: TargetSpec, r: Requirement): number {
  const pool = eligiblePool(ctx, { baseId: t.baseId, ilvl: t.ilvl, rarity: 'normal', mods: [] }, { rarity: 'magic' });
  const acc = new Set(acceptedEntries(ctx, t, r).map((e) => e.mod.id));
  if (pool.provenance.confidence === 'unavailable' || !pool.total) return acc.size; // sem pesos: menos tiers aceitos = mais difícil
  return pool.entries.filter((e) => acc.has(e.entry.mod.id)).reduce((s, e) => s + e.weight, 0) / pool.total;
}

/**
 * Opções de compra: item mágico com o prefixo mais difícil, com o sufixo mais difícil, ou com os dois.
 * Só requisitos de mods normais (mods da Abyss/essência não existem em itens mágicos comuns).
 */
export function buyOptions(ctx: CraftContext, t: TargetSpec): BuyOption[] {
  if (!ctx.basesById.has(t.baseId)) return [];
  const reqs = t.requirements.filter((r) => r.required && familyKind(r.family) === 'normal');
  const hardest = (side: Gen) =>
    reqs
      .filter((r) => familyGen(r.family) === side && acceptedEntries(ctx, t, r).length)
      .sort((a, b) => familyShare(ctx, t, a) - familyShare(ctx, t, b))[0];
  const p = hardest('prefix');
  const s = hardest('suffix');
  const combos: Requirement[][] = [];
  if (p) combos.push([p]);
  if (s) combos.push([s]);
  if (p && s) combos.push([p, s]);
  const out: BuyOption[] = [];
  for (const combo of combos) {
    // Tier aceito mais barato (o pior tier aceito) e que não conflite com o outro mod.
    const picks = combo.map((r) => [...acceptedEntries(ctx, t, r)].sort((a, b) => b.tier - a.tier)[0]);
    const groups = picks.flatMap((e) => e.mod.groups);
    if (new Set(groups).size !== groups.length) continue;
    const modIds = picks.map((e) => e.mod.id);
    out.push({
      key: `${t.baseId}|${modIds.join('+')}`,
      sides: combo.map((r) => familyGen(r.family)),
      requirementIds: combo.map((r) => r.id),
      modIds,
      minValues: combo.map((r) => {
        if (r.minValue != null) return r.minValue;
        const mins = acceptedEntries(ctx, t, r).map((e) => e.mod.stats[0]?.min).filter((v): v is number => v != null);
        return mins.length ? Math.min(...mins.map(Math.abs)) : null;
      }),
      item: { baseId: t.baseId, ilvl: t.ilvl, rarity: 'magic', mods: modIds.map((modId) => ({ modId })) },
    });
  }
  return out;
}

/** O item informado corresponde a uma opção de compra (mods aceitos para cada requisito)? */
export function matchesBuyOption(ctx: CraftContext, t: TargetSpec, opt: BuyOption, it: ItemState): boolean {
  return opt.requirementIds.every((rid) => {
    const r = t.requirements.find((x) => x.id === rid)!;
    const acc = new Set(acceptedEntries(ctx, t, r).map((e) => e.mod.id));
    return it.mods.some((m) => acc.has(m.modId));
  });
}

export function buyOptionByKey(ctx: CraftContext, t: TargetSpec, key: string): BuyOption | undefined {
  return buyOptions(ctx, t).find((o) => o.key === key);
}
