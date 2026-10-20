import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/data/rules';
import { buyOptions, matchesBuyOption } from '../src/engine/buy';
import { createContext } from '../src/engine/context';
import { compareStrategies, evaluateStrategy } from '../src/engine/compare';
import { costOfUsage } from '../src/engine/cost';
import { createProject, materialsUsed, recordManualState, tutorialState } from '../src/engine/project';
import { BUY_MATERIAL, simulateStrategy } from '../src/engine/simulate';
import { candidateStrategies, decide, type Strategy } from '../src/engine/strategies';
import type { TargetSpec } from '../src/engine/target';
import { DATA, WEIGHTS } from './fixtures';

const ctx = () => createContext(DATA, structuredClone(DEFAULT_RULES), { table: { source: 't', confidence: 'confirmed', importedAt: '', weights: WEIGHTS }, hypothesis: { kind: 'none' } });

const target: TargetSpec = {
  baseId: 'Ring',
  ilvl: 80,
  rarity: 'rare',
  requirements: [
    { id: 'life', family: 'prefix:Life', minTier: 2, required: true, priority: 1 },
    { id: 'mana', family: 'prefix:Mana', minTier: 2, required: true, priority: 1 },
    { id: 'fire', family: 'suffix:Fire', minTier: 3, required: true, priority: 1 },
  ],
};

describe('opções de compra', () => {
  it('escolhe o prefixo e o sufixo mais difíceis e o tier aceito mais barato', () => {
    const c = ctx();
    const opts = buyOptions(c, target);
    expect(opts).toHaveLength(3);
    // Life T2+ (Life2+Life3 = 20) é mais raro que Mana T2+ (Mana1+Mana2 = 35).
    expect(opts[0].modIds).toEqual(['Life2']);
    expect(opts[1].modIds).toEqual(['Fire1']);
    expect(opts[2].modIds).toEqual(['Life2', 'Fire1']);
    expect(opts[2].item.rarity).toBe('magic');
    expect(opts[0].minValues).toEqual([20]);
  });
  it('reconhece se o item comprado atende a opção', () => {
    const c = ctx();
    const [, , both] = buyOptions(c, target);
    expect(matchesBuyOption(c, target, both, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life3' }, { modId: 'Fire2' }] })).toBe(true);
    expect(matchesBuyOption(c, target, both, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life1' }, { modId: 'Fire2' }] })).toBe(false);
  });
});

describe('estratégias de compra', () => {
  const buyStrategy = (key: string): Strategy => ({ id: 'b', kind: 'magicExalt', params: { grade: 'normal', sideOmens: true, recovery: 'annul', maxActions: 40, buy: key } });
  it('candidatas incluem as opções de compra', () => {
    const c = ctx();
    expect(candidateStrategies(c, target).strategies.filter((s) => s.params.buy)).not.toHaveLength(0);
  });
  it('base nova = comprar; simulação começa no item comprado', () => {
    const c = ctx();
    const [, , both] = buyOptions(c, target);
    const s = buyStrategy(both.key);
    expect(decide(c, s, target, { baseId: 'Ring', ilvl: 80, rarity: 'normal', mods: [] }, 0).kind).toBe('buy');
    const st = simulateStrategy(c, s, target, { runs: 500, seed: 2 });
    expect(st.usagePerRun[BUY_MATERIAL]).toBeCloseTo(1, 10);
    expect(st.usagePerRun['__base__']).toBeUndefined();
    expect(st.usagePerRun['Orb of Transmutation']).toBeUndefined();
    // Começar com Life e Fire torna o objetivo muito mais fácil do que do zero.
    const fromScratch = simulateStrategy(c, { ...s, params: { ...s.params, buy: undefined } }, target, { runs: 500, seed: 2 });
    expect(st.pSuccess).toBeGreaterThan(fromScratch.pSuccess);
  });
  it('custo usa o preço da compra; sem preço, o custo fica indisponível (nunca grátis)', () => {
    const c = ctx();
    const [, , both] = buyOptions(c, target);
    expect(costOfUsage({ [BUY_MATERIAL]: 2 }, null, null, Date.now(), 7).total).toBe(14);
    expect(costOfUsage({ [BUY_MATERIAL]: 1 }, null, null).total).toBeNull();
    const e = evaluateStrategy(c, buyStrategy(both.key), target, 200, null, null, undefined, 1, { [both.key]: 50 });
    expect(e.costPerRun.missing).not.toContain(BUY_MATERIAL);
  });
  it('partindo de um item em andamento, estratégias de compra são ignoradas', () => {
    const c = ctx();
    const { strategies } = candidateStrategies(c, target);
    const cmp = compareStrategies(c, strategies.slice(0, 12), target, 50, null, null, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }] });
    expect(cmp.evaluations.some((e) => e.strategy.params.buy)).toBe(false);
  });
  it('tutorial: pede a compra, registra o item comprado e conta o custo', () => {
    const c = ctx();
    const [, , both] = buyOptions(c, target);
    const p = createProject('Anel', target, buyStrategy(both.key));
    expect(tutorialState(c, p).decision?.kind).toBe('buy');
    const r = recordManualState(c, p, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }, { modId: 'Fire1' }] }, undefined, [BUY_MATERIAL]);
    expect(r.project!.attempts[0].outcome).toBe('bought');
    expect(materialsUsed(r.project!)).toEqual({ [BUY_MATERIAL]: 1 });
    const next = tutorialState(c, r.project!).decision;
    expect(next?.kind === 'action' && next.spec.currency).toBe('regal');
  });
});
