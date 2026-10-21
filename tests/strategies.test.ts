import { describe, expect, it } from 'vitest';
import { newItem, type ItemState } from '../src/engine/item';
import { candidateStrategies, decide, pickGrade, type Strategy } from '../src/engine/strategies';
import { stepOptions, usefulOptions } from '../src/engine/stepOptions';
import { simulateStrategy } from '../src/engine/simulate';
import { compareStrategies, pickProfiles, type StrategyEvaluation } from '../src/engine/compare';
import type { TargetSpec } from '../src/engine/target';
import { ctxWith } from './fixtures';

const magicTarget: TargetSpec = {
  baseId: 'Ring',
  ilvl: 80,
  rarity: 'magic',
  requirements: [{ id: 'a', family: 'prefix:Life', minTier: 3, required: true, priority: 1 }],
};
const rareTarget: TargetSpec = {
  baseId: 'Ring',
  ilvl: 80,
  rarity: 'rare',
  requirements: [
    { id: 'a', family: 'prefix:Life', minTier: 2, required: true, priority: 1 },
    { id: 'b', family: 'suffix:Fire', minTier: 2, required: true, priority: 1 },
  ],
};
const basic: Strategy = { id: 'm', kind: 'magicExalt', params: { grade: 'normal', sideOmens: false, recovery: 'restart', maxActions: 40 } };

describe('decisões da estratégia', () => {
  it('começa com Transmutação e declara sucesso quando pronto', () => {
    const ctx = ctxWith();
    const d = decide(ctx, basic, rareTarget, newItem('Ring', 80), 0);
    expect(d.kind === 'action' && d.spec.currency).toBe('transmute');
    const done: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life2' }, { modId: 'Fire2' }] };
    expect(decide(ctx, basic, rareTarget, done, 3).kind).toBe('success');
  });
  it('recomeça quando o mágico tem modificador inútil', () => {
    const ctx = ctxWith();
    const junk: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Str1' }] };
    expect(decide(ctx, basic, rareTarget, junk, 1).kind).toBe('restart');
  });
  it('com recuperação por Anulação, mantém mágico com mod útil + inútil e segue para Régio', () => {
    const ctx = ctxWith();
    const s: Strategy = { ...basic, params: { ...basic.params, recovery: 'annul' } };
    const mixed: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }, { modId: 'Str1' }] };
    const d = decide(ctx, s, rareTarget, mixed, 2);
    expect(d.kind === 'action' && d.spec.currency).toBe('regal');
    const onlyJunk: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Str1' }] };
    expect(decide(ctx, s, rareTarget, onlyJunk, 1).kind).toBe('restart');
  });
  it('usa Augmentation quando o lado livre tem requisito faltante', () => {
    const ctx = ctxWith();
    const it: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }] };
    const d = decide(ctx, basic, rareTarget, it, 1);
    expect(d.kind === 'action' && d.spec.currency).toBe('augment');
  });
  it('com recuperação por anulação, anula quando o item travou', () => {
    const ctx = ctxWith();
    const s: Strategy = { ...basic, params: { ...basic.params, recovery: 'annul' } };
    const stuck: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life1' }, { modId: 'Fire2' }] };
    const d = decide(ctx, s, rareTarget, stuck, 3);
    expect(d.kind === 'action' && d.spec.currency).toBe('annul');
    expect(decide(ctx, basic, rareTarget, stuck, 3).kind).toBe('restart');
  });
  it('omen de lado é usado quando só falta um lado', () => {
    const ctx = ctxWith();
    const s: Strategy = { ...basic, params: { ...basic.params, sideOmens: true } };
    const it: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life2' }, { modId: 'Cold1' }] };
    const d = decide(ctx, s, rareTarget, it, 3);
    expect(d.kind === 'action' && d.spec.omens).toEqual(['dextral-exaltation']);
  });
  it('pede Divine quando falta apenas valor', () => {
    const ctx = ctxWith();
    const t: TargetSpec = { ...rareTarget, requirements: [{ ...rareTarget.requirements[0], minValue: 28 }] };
    const it: ItemState = { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life2', values: [20] }] };
    const d = decide(ctx, basic, t, it, 3);
    expect(d.kind === 'action' && d.spec.currency).toBe('divine');
  });
});

describe('resultado conhecido de estratégia', () => {
  it('alvo mágico com um prefixo: P = peso(Life)/peso total = 40/200', () => {
    const ctx = ctxWith();
    const st = simulateStrategy(ctx, basic, magicTarget, { runs: 20000, seed: 3 });
    expect(st.ci[0]).toBeLessThan(0.2);
    expect(st.ci[1]).toBeGreaterThan(0.2);
    expect(Math.abs(st.pSuccess - 0.2)).toBeLessThan(0.015);
    // Cada execução usa exatamente 1 base e 1 transmutação.
    expect(st.usagePerRun['Orb of Transmutation']).toBeCloseTo(1, 10);
    expect(st.usagePerRun['__base__']).toBeCloseTo(1, 10);
  });
  it('estatísticas consistentes para alvo raro', () => {
    const ctx = ctxWith();
    const st = simulateStrategy(ctx, basic, rareTarget, { runs: 3000, seed: 8 });
    expect(st.runs).toBe(3000);
    expect(Object.values(st.endReasons).reduce((a, b) => a + b, 0)).toBe(3000);
    expect(st.pSuccess).toBeGreaterThan(0);
    expect(st.finals.filter((f) => f.success).every((f) => f.item.mods.some((m) => m.modId === 'Fire2' || m.modId === 'Fire3'))).toBe(true);
  });
  it('sem pesos, a simulação informa indisponibilidade em vez de inventar', () => {
    const ctx = ctxWith({ table: null, hypothesis: { kind: 'none' } });
    const st = simulateStrategy(ctx, basic, rareTarget, { runs: 100 });
    expect(st.error).toBe('weights');
    expect(st.provenance.confidence).toBe('unavailable');
  });
});

describe('candidatos e comparação', () => {
  it('exclui estratégias com regras desconhecidas e explica', () => {
    const ctx = ctxWith();
    ctx.rules.currencies['perfect-exalt'].minModLevel = null;
    const { strategies, excluded } = candidateStrategies(ctx, rareTarget);
    expect(strategies.length).toBeGreaterThan(3);
    expect(excluded.some((e) => e.reason.reasonKey === 'app.unknownMinLevel')).toBe(true);
  });
  it('alvo mágico só aceita estratégias compatíveis', () => {
    const { strategies } = candidateStrategies(ctxWith(), magicTarget);
    expect(strategies.every((s) => s.kind === 'magicExalt')).toBe(true);
  });
  it('perfis usam critérios explícitos', () => {
    const fake = (id: string, p: number, cost: number | null, actions: number): StrategyEvaluation => ({
      strategy: { ...basic, id },
      stats: { runs: 100, successes: Math.round(p * 100), pSuccess: p, ci: [0, 1], meanActions: actions, usagePerRun: { x: 1 }, usagePerSuccessRun: {}, endReasons: {}, finals: [], provenance: { confidence: 'estimated', assumptions: [] }, perRunUsage: [], perRunSuccess: [] },
      costPerRun: { total: cost, partial: cost ?? 0, missing: [], stale: [] },
      attempts: null,
      expectedTotal: cost == null ? null : cost / p,
      expectedUnits: 1 / p,
      percentiles: null,
    });
    const r = pickProfiles([fake('barata', 0.1, 1, 3), fake('consistente', 0.9, 25, 3), fake('meio', 0.5, 10, 3)]);
    expect(r.economical.strategyId).toBe('barata'); // 10 vs 27.8 vs 20
    expect(r.consistent.strategyId).toBe('consistente'); // 27.8 ≤ 3 × 10
    expect(r.consistent.noteKey).toBeUndefined();
    expect(r.economical.criterionKey).toBe('cmp.crit.ecoCost');
    // Chance maior, mas custo esperado acima de 3× o mais barato: fica fora do perfil de consistência.
    const caro = pickProfiles([fake('barata', 0.1, 1, 3), fake('caríssima', 0.95, 500, 3), fake('meio', 0.5, 10, 3)]);
    expect(caro.consistent.strategyId).toBe('meio');
    expect(caro.consistent.noteKey).toBe('cmp.note.consistentCapped');
    const mixed = pickProfiles([fake('semPreco', 0.9, null, 3), fake('cara', 0.5, 50, 3), fake('barata', 0.5, 5, 3)]);
    expect(mixed.economical.strategyId).toBe('barata');
    expect(mixed.economical.criterionKey).toBe('cmp.crit.ecoCost');
    expect(mixed.limitationKeys).toContain('cmp.limit.somePrices');
    const noPrice = pickProfiles([fake('a', 0.1, null, 3), fake('b', 0.5, null, 3)]);
    expect(noPrice.limitationKeys).toContain('cmp.limit.prices');
    expect(noPrice.economical.criterionKey).toBe('cmp.crit.ecoUnits');
    // 1 sucesso em 100 é sorte: não vence quem tem amostra suficiente, mesmo sendo "mais barato".
    const sorte = { ...fake('sorte', 0.01, 0.01, 1), stats: { ...fake('sorte', 0.01, 0.01, 1).stats, successes: 1 } };
    const amostra = pickProfiles([sorte, fake('real', 0.2, 50, 5)]);
    expect(amostra.economical.strategyId).toBe('real');
    expect(amostra.limitationKeys).not.toContain('cmp.limit.fewSamples');
    expect(pickProfiles([sorte]).limitationKeys).toContain('cmp.limit.fewSamples');
    // Comprar o item pronto sem preço conhecido não pode vencer nenhum perfil (custo desconhecido ≠ barato).
    const buy = { ...fake('comprar', 1, null, 1), strategy: { ...basic, id: 'comprar', params: { ...basic.params, buy: 'both' } } };
    const withBuy = pickProfiles([buy, fake('a', 0.2, null, 5), fake('b', 0.4, null, 6)]);
    expect([withBuy.economical.strategyId, withBuy.balanced.strategyId, withBuy.consistent.strategyId]).not.toContain('comprar');
  });
  it('comparação completa roda e escolhe perfis', () => {
    const ctx = ctxWith();
    const { strategies } = candidateStrategies(ctx, rareTarget);
    const c = compareStrategies(ctx, strategies.slice(0, 3), rareTarget, 500, null, null);
    expect(c.evaluations).toHaveLength(3);
    expect(c.consistent.strategyId).not.toBeNull();
  });
});

describe('versões Greater/Perfect e opções da etapa', () => {
  const fireT = (minTier: number): TargetSpec => ({ baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [{ id: 'f', family: 'suffix:Fire', minTier, required: true, priority: 1 }] });
  const rare = (mods: string[]): ItemState => ({ baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: mods.map((modId) => ({ modId })) });
  it('usa a versão mais forte que não exclui tiers aceitos', () => {
    const ctx = ctxWith();
    // Só Fire3 (nível 40) aceito: Greater (35) serve, Perfect (50) excluiria o próprio alvo.
    expect(pickGrade(ctx, 'exalt', fireT(1), rare(['Mana1']))).toBe('greater');
    // Fire2 (nível 20) também aceito: qualquer nível mínimo o excluiria.
    expect(pickGrade(ctx, 'exalt', fireT(2), rare(['Mana1']))).toBe('normal');
  });
  it('estratégia "auto" escolhe o Exaltado Maior quando ajuda', () => {
    const ctx = ctxWith();
    const s: Strategy = { id: 'auto', kind: 'magicExalt', params: { grade: 'auto', sideOmens: true, recovery: 'restart', maxActions: 40 } };
    const d = decide(ctx, s, fireT(1), rare(['Mana1']), 2);
    expect(d.kind === 'action' && d.spec.currency).toBe('greater-exalt');
  });
  it('opções da etapa comparam presságios e versões pela chance exata', () => {
    const ctx = ctxWith();
    const opts = stepOptions(ctx, rare(['Mana1']), fireT(1), { currency: 'exalt' }, null);
    expect(opts[0].recommended).toBe(true);
    const plain = opts.find((o) => o.spec.currency === 'exalt' && !o.spec.omens?.length)!;
    const dextral = opts.find((o) => o.spec.currency === 'exalt' && o.spec.omens?.join() === 'dextral-exaltation')!;
    const greaterDextral = opts.find((o) => o.spec.currency === 'greater-exalt' && o.spec.omens?.join() === 'dextral-exaltation')!;
    // Forçar sufixo e cortar tiers baixos só pode ajudar a acertar Fire3.
    expect(dextral.improves!).toBeGreaterThan(plain.improves!);
    expect(greaterDextral.improves!).toBeGreaterThan(dextral.improves!);
    // Sem livro de preços o custo fica desconhecido, nunca zero.
    expect(opts.every((o) => o.cost === null)).toBe(true);
    // Úteis: some o presságio de prefixo (não ajuda a pegar um sufixo) e fica a recomendada.
    const useful = usefulOptions(opts);
    expect(useful.some((o) => o.recommended)).toBe(true);
    expect(useful.some((o) => o.spec.omens?.includes('sinistral-exaltation'))).toBe(false);
    expect(useful.some((o) => o === greaterDextral)).toBe(true);
  });
  it('melhora que trava o objetivo não conta como melhora', () => {
    const ctx = ctxWith();
    // Falta Fire (sufixo) e os prefixos já estão cheios de lixo-compatível: só sufixo ajuda.
    const t2: TargetSpec = { baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [{ id: 'f', family: 'suffix:Fire', minTier: 3, required: true, priority: 1 }, { id: 'c', family: 'suffix:Cold', minTier: 2, required: true, priority: 1 }] };
    const opts = stepOptions(ctx, rare(['Mana1']), t2, { currency: 'exalt' }, null);
    for (const o of opts) expect(o.improves!).toBeLessThanOrEqual(o.keepsPossible! + 1e-9);
  });
});
