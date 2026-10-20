import { describe, expect, it } from 'vitest';
import { actionDistribution, applyAction, checkAction } from '../src/engine/actions';
import { getBasePool } from '../src/engine/context';
import { eligiblePool, limitsFor, newItem, validateItem, type ItemState } from '../src/engine/item';
import { analyzeNextAction, cumulative, divineSuccessChance, familyTierChance, geometric, sequenceProbability, wilson } from '../src/engine/probability';
import { mulberry32 } from '../src/engine/rng';
import { divergenceZ, simulateSequence } from '../src/engine/simulate';
import { completableByAdding, evaluate, validateTarget, type TargetSpec } from '../src/engine/target';
import { ctxWith } from './fixtures';

const ring = (mods: string[], rarity: ItemState['rarity'] = 'rare', ilvl = 80): ItemState => ({ baseId: 'Ring', ilvl, rarity, mods: mods.map((modId) => ({ modId })) });

describe('compatibilidade de modificadores com a base', () => {
  it('só inclui mods com flag de geração na base', () => {
    const ctx = ctxWith();
    const pool = getBasePool(ctx, 'Ring');
    expect(pool.byMod.has('Move1')).toBe(false);
    expect(pool.byMod.has('Life1')).toBe(true);
    expect(getBasePool(ctx, 'Boots').byMod.has('Move1')).toBe(true);
    expect(getBasePool(ctx, 'Boots').byMod.has('Life1')).toBe(false);
  });
  it('numera tiers por nível (T1 = maior nível)', () => {
    const pool = getBasePool(ctxWith(), 'Ring');
    expect(pool.byMod.get('Life3')!.tier).toBe(1);
    expect(pool.byMod.get('Life1')!.tier).toBe(3);
    expect(pool.byMod.get('Life1')!.tierCount).toBe(3);
  });
});

describe('requisitos de nível', () => {
  it('exclui mods acima do nível do item', () => {
    const ctx = ctxWith();
    const p = eligiblePool(ctx, ring([], 'rare', 15), { rarity: 'rare' });
    const ids = p.entries.map((e) => e.entry.mod.id);
    expect(ids).toContain('Life2');
    expect(ids).not.toContain('Life3');
    expect(ids).not.toContain('Fire2');
  });
});

describe('limites de prefixos e sufixos e grupos', () => {
  it('não oferece prefixos quando há 3 prefixos', () => {
    const ctx = ctxWith();
    const it3 = ring(['Life1', 'Mana1', 'LifeMana1']);
    // LifeMana1 compartilha grupo Life com Life1 — este item é inválido.
    expect(validateItem(ctx, it3).some((i) => i.key === 'val.groupConflict')).toBe(true);
  });
  it('respeita exclusividade de grupo', () => {
    const ctx = ctxWith();
    const p = eligiblePool(ctx, ring(['Life1']), { rarity: 'rare' });
    const ids = p.entries.map((e) => e.entry.mod.id);
    expect(ids).not.toContain('Life2');
    expect(ids).not.toContain('LifeMana1');
    expect(ids).toContain('Mana1');
  });
  it('mágico aceita no máximo 1 prefixo e 1 sufixo', () => {
    const ctx = ctxWith();
    const magic = ring(['Life1'], 'magic');
    const p = eligiblePool(ctx, magic, { rarity: 'magic' });
    expect(p.entries.every((e) => e.entry.mod.gen === 'suffix')).toBe(true);
    expect(validateItem(ctx, ring(['Life1', 'Mana1'], 'magic')).some((i) => i.key === 'val.tooManyPrefixes')).toBe(true);
  });
  it('raro com 3 prefixos só recebe sufixo; omen sinistro é inválido', () => {
    const ctx = ctxWith();
    // 3 prefixos de grupos distintos não existem no fixture; criamos um item com 3 sufixos.
    const full = ring(['Fire1', 'Cold1', 'Str1']);
    expect(checkAction(ctx, full, { currency: 'exalt', omens: ['dextral-exaltation'] }).ok).toBe(false);
    expect(checkAction(ctx, full, { currency: 'exalt', omens: ['sinistral-exaltation'] }).ok).toBe(true);
    const d = actionDistribution(ctx, full, { currency: 'exalt' })!;
    expect(d.outcomes.every((o) => o.item.mods.length === 4)).toBe(true);
  });
});

describe('regras dos métodos de crafting', () => {
  it('Transmutação: normal -> mágico com 1 mod, pesos exatos', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, newItem('Ring', 80), { currency: 'transmute' })!;
    expect(d.provenance.confidence).toBe('confirmed');
    const total = d.outcomes.reduce((s, o) => s + o.p, 0);
    expect(total).toBeCloseTo(1, 10);
    const life3 = d.outcomes.find((o) => o.item.mods[0].modId === 'Life3')!;
    expect(life3.p).toBeCloseTo(5 / 200, 10); // soma de todos os pesos do anel = 200
    expect(d.outcomes.every((o) => o.item.rarity === 'magic')).toBe(true);
  });
  it('Augmentation exige item mágico com espaço', () => {
    const ctx = ctxWith();
    expect(checkAction(ctx, newItem('Ring', 80), { currency: 'augment' }).ok).toBe(false);
    expect(checkAction(ctx, ring(['Life1', 'Fire1'], 'magic'), { currency: 'augment' }).ok).toBe(false);
    expect(checkAction(ctx, ring(['Life1'], 'magic'), { currency: 'augment' }).ok).toBe(true);
  });
  it('Regal: mágico -> raro +1 mod; coroação sinistra só prefixo', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, ring(['Fire1'], 'magic'), { currency: 'regal', omens: ['sinistral-coronation'] })!;
    expect(d.outcomes.every((o) => o.item.rarity === 'rare' && o.item.mods.length === 2)).toBe(true);
    expect(d.outcomes.every((o) => ctx.modsById.get(o.item.mods[1].modId)!.gen === 'prefix')).toBe(true);
  });
  it('Chaos remove um mod aleatório e adiciona outro', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, ring(['Life1', 'Fire1']), { currency: 'chaos' })!;
    expect(d.outcomes.every((o) => o.item.mods.length === 2)).toBe(true);
    const keepsLife = d.outcomes.filter((o) => o.item.mods.some((m) => m.modId === 'Life1')).reduce((s, o) => s + o.p, 0);
    // Life1 fica se Fire1 for removido (1/2); se Life1 sair, pode voltar: pool = 100 prefixos + 40 sufixos (sem Fire).
    expect(keepsLife).toBeCloseTo(0.5 + 0.5 * (20 / 140), 10);
  });
  it('Omen of Whittling remove o mod de menor nível', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, ring(['Life3', 'Fire1']), { currency: 'chaos', omens: ['whittling'] })!;
    expect(d.outcomes.every((o) => o.item.mods.some((m) => m.modId === 'Life3'))).toBe(true);
  });
  it('Annulment com omen destro remove só sufixo; fraturado nunca sai', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, ring(['Life1', 'Fire1', 'Cold1']), { currency: 'annul', omens: ['dextral-annulment'] })!;
    expect(d.outcomes.every((o) => o.item.mods.some((m) => m.modId === 'Life1'))).toBe(true);
    const fr: ItemState = { ...ring(['Life1', 'Fire1']), mods: [{ modId: 'Life1', fractured: true }, { modId: 'Fire1' }] };
    const d2 = actionDistribution(ctx, fr, { currency: 'annul' })!;
    expect(d2.outcomes).toHaveLength(1);
    expect(d2.outcomes[0].item.mods[0].modId).toBe('Life1');
  });
  it('Greater Exalted aplica nível mínimo 35 por família', () => {
    const ctx = ctxWith();
    const d = actionDistribution(ctx, ring(['Mana1']), { currency: 'greater-exalt', omens: ['dextral-exaltation'] })!;
    const ids = d.outcomes.map((o) => o.item.mods[1].modId);
    expect(ids).toContain('Fire3'); // família Fire tem tier >= 35 -> só Fire3
    expect(ids).not.toContain('Fire1');
    expect(ids).toContain('Cold1'); // família Cold não tem tier >= 35 -> continua elegível
  });
  it('moedas com nível mínimo desconhecido são recusadas', () => {
    const ctx = ctxWith();
    // Greater Transmutation tem nível mínimo confirmado (44); simula uma regra ainda sem esse dado.
    expect(checkAction(ctx, newItem('Ring', 80), { currency: 'greater-transmute' }).ok).toBe(true);
    ctx.rules.currencies['greater-transmute'] = { ...ctx.rules.currencies['greater-transmute'], minModLevel: null };
    expect(checkAction(ctx, newItem('Ring', 80), { currency: 'greater-transmute' }).ok).toBe(false);
  });
  it('Fracturing exige 4+ mods', () => {
    const ctx = ctxWith();
    expect(checkAction(ctx, ring(['Life1', 'Fire1', 'Cold1']), { currency: 'fracture' }).ok).toBe(false);
    expect(checkAction(ctx, ring(['Life1', 'Mana1', 'Fire1', 'Cold1']), { currency: 'fracture' }).ok).toBe(true);
  });
  it('Essência garante o modificador', () => {
    const ctx = ctxWith(undefined, [{ id: 'e1', nameEn: 'Test Essence', tier: 'normal', mode: 'magicToRare', effects: [{ category: 'Ring', text: '', itemClasses: ['Ring'], modIds: ['Life3'] }], source: 'teste' }]);
    const d = actionDistribution(ctx, ring(['Fire1'], 'magic'), { currency: 'essence', essenceId: 'e1' })!;
    expect(d.outcomes).toHaveLength(1);
    expect(d.outcomes[0].item.rarity).toBe('rare');
    expect(d.outcomes[0].item.mods.map((m) => m.modId)).toEqual(['Fire1', 'Life3']);
  });
});

describe('proveniência dos pesos', () => {
  it('sem pesos: indisponível; hipótese uniforme: estimado', () => {
    const none = ctxWith({ table: null, hypothesis: { kind: 'none' } });
    expect(actionDistribution(none, newItem('Ring', 80), { currency: 'transmute' })!.provenance.confidence).toBe('unavailable');
    const uni = ctxWith({ table: null, hypothesis: { kind: 'uniform' } });
    const d = actionDistribution(uni, newItem('Ring', 80), { currency: 'transmute' })!;
    expect(d.provenance.confidence).toBe('estimated');
    expect(d.provenance.assumptions).toContain('assume.uniformWeights');
  });
  it('um único candidato é confirmado mesmo sem pesos', () => {
    const none = ctxWith({ table: null, hypothesis: { kind: 'none' } });
    const boots: ItemState = { baseId: 'Boots', ilvl: 80, rarity: 'normal', mods: [] };
    const d = actionDistribution(none, boots, { currency: 'transmute' })!;
    expect(d.provenance.confidence).toBe('confirmed');
    expect(d.outcomes).toHaveLength(1);
  });
});

const target = (over: Partial<TargetSpec> = {}): TargetSpec => ({
  baseId: 'Ring',
  ilvl: 80,
  rarity: 'rare',
  requirements: [
    { id: 'a', family: 'prefix:Life', minTier: 2, required: true, priority: 1 },
    { id: 'b', family: 'suffix:Fire', minTier: 3, required: true, priority: 1 },
  ],
  ...over,
});

describe('validação de alvos impossíveis', () => {
  it('aceita alvo válido', () => {
    expect(validateTarget(ctxWith(), target()).filter((i) => i.severity === 'error')).toHaveLength(0);
  });
  it('rejeita família que não gera na base', () => {
    const issues = validateTarget(ctxWith(), target({ requirements: [{ id: 'x', family: 'prefix:Move', minTier: 1, required: true, priority: 1 }] }));
    expect(issues.map((i) => i.key)).toContain('tgt.familyNotOnBase');
  });
  it('rejeita tier inalcançável no nível do item', () => {
    const issues = validateTarget(ctxWith(), target({ ilvl: 15, requirements: [{ id: 'x', family: 'prefix:Life', minTier: 1, required: true, priority: 1 }] }));
    expect(issues.map((i) => i.key)).toContain('tgt.ilvlTooLow');
  });
  it('rejeita grupos conflitantes e excesso de afixos', () => {
    const c = validateTarget(ctxWith(), target({ requirements: [
      { id: 'a', family: 'prefix:Life', minTier: 3, required: true, priority: 1 },
      { id: 'b', family: 'prefix:LifeMana', minTier: 1, required: true, priority: 1 },
    ] }));
    expect(c.map((i) => i.key)).toContain('tgt.groupConflict');
    const m = validateTarget(ctxWith(), target({ rarity: 'magic', requirements: [
      { id: 'a', family: 'prefix:Life', minTier: 3, required: true, priority: 1 },
      { id: 'b', family: 'prefix:Mana', minTier: 2, required: true, priority: 1 },
    ] }));
    expect(m.map((i) => i.key)).toContain('tgt.tooManyPrefixes');
  });
  it('rejeita valor mínimo impossível', () => {
    const v = validateTarget(ctxWith(), target({ requirements: [{ id: 'a', family: 'prefix:Life', minTier: 2, required: true, priority: 1, minValue: 45 }] }));
    expect(v.map((i) => i.key)).toContain('tgt.valueTooHigh');
  });
});

describe('cálculos de probabilidade', () => {
  it('chance exata do próximo Exalted completar o item', () => {
    const ctx = ctxWith();
    // Item tem Life2 (T2); falta Fire. Pool raro: prefixos sem grupo Life (Mana1, Mana2 = 35) + sufixos (100) = 135.
    const a = analyzeNextAction(ctx, ring(['Life2']), { currency: 'exalt' }, target());
    expect(a.success.value).toBeCloseTo(60 / 135, 10);
    expect(a.success.provenance.confidence).toBe('confirmed');
  });
  it('chance de família e de tier', () => {
    const ctx = ctxWith();
    const r = familyTierChance(ctx, ring(['Mana1']), { currency: 'exalt' }, 'suffix:Fire', 1);
    // pool: prefixos sem Mana: Life1,Life2,Life3,LifeMana1 = 65; sufixos = 100 => 165
    expect(r.family.value).toBeCloseTo(60 / 165, 10);
    expect(r.tier.value).toBeCloseTo(10 / 165, 10);
    expect(r.tierGivenFamily.value).toBeCloseTo(10 / 60, 10);
  });
  it('enumeração de sequência = soma manual (regal + exalt)', () => {
    const ctx = ctxWith();
    const start = ring(['Life2'], 'magic');
    const res = sequenceProbability(ctx, start, [{ currency: 'regal' }, { currency: 'exalt' }], target())!;
    // P(Fire em 2 adições). 1ª: pool 135 (35 prefixo + 100 sufixo).
    // Se 1ª é Fire (60/135) -> sucesso.
    // Se 1ª é Mana (35/135): 2ª pool = 100 sufixos -> Fire 60/100.
    // Se 1ª é Cold (grupo Cold inteiro = 25 sai do pool): 2ª pool = 110 -> Fire 60/110.
    // Se 1ª é Str1 (15): 2ª pool = 120 -> Fire 60/120.
    const manual = 60 / 135 + (35 / 135) * (60 / 100) + (25 / 135) * (60 / 110) + (15 / 135) * (60 / 120);
    expect(res.success.value).toBeCloseTo(manual, 10);
  });
  it('mods não são tratados como independentes (grupos)', () => {
    const ctx = ctxWith();
    // Probabilidade de obter Life e LifeMana juntos é 0 (mesmo grupo).
    const t: TargetSpec = { baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [
      { id: 'a', family: 'prefix:Life', minTier: 3, required: true, priority: 1 },
      { id: 'b', family: 'prefix:LifeMana', minTier: 1, required: true, priority: 1 },
    ] };
    const res = sequenceProbability(ctx, newItem('Ring', 80), [{ currency: 'transmute' }, { currency: 'augment' }, { currency: 'regal' }], t)!;
    expect(res.success.value).toBe(0);
    expect(res.success.provenance.confidence).toBe('confirmed');
  });
  it('geométrica, acumulada e Wilson', () => {
    const g = geometric(0.1)!;
    expect(g.expected).toBeCloseTo(10, 10);
    expect(g.p50).toBe(7);
    expect(cumulative(0.1, 10)).toBeCloseTo(1 - 0.9 ** 10, 12);
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
    expect(geometric(0)).toBeNull();
  });
  it('Divine: chance de atingir valor mínimo (valores uniformes)', () => {
    const ctx = ctxWith();
    const t = target({ requirements: [{ id: 'a', family: 'prefix:Life', minTier: 1, required: true, priority: 1, minValue: 35 }] });
    const r = divineSuccessChance(ctx, t, ring(['Life3']));
    expect(r.value).toBeCloseTo(5 / 10, 10);
    expect(r.provenance.confidence).toBe('estimated');
  });
});

describe('simulação vs cálculo exato', () => {
  it('frequência simulada converge para a probabilidade exata', () => {
    const ctx = ctxWith();
    const start = ring(['Life2'], 'magic');
    const specs = [{ currency: 'regal' }, { currency: 'exalt' }];
    const exact = sequenceProbability(ctx, start, specs, target())!.success.value!;
    const sim = simulateSequence(ctx, start, specs, target(), 20000, 99);
    expect(Math.abs(divergenceZ(exact, sim.successes, sim.runs))).toBeLessThan(4);
  });
  it('simulação é reprodutível com a mesma semente', () => {
    const ctx = ctxWith();
    const a = applyAction(ctx, newItem('Ring', 80), { currency: 'alchemy' }, mulberry32(5)).item;
    const b = applyAction(ctx, newItem('Ring', 80), { currency: 'alchemy' }, mulberry32(5)).item;
    expect(a).toEqual(b);
    expect(a.mods).toHaveLength(4);
    expect(a.rarity).toBe('rare');
  });
});

describe('avaliação do item', () => {
  it('completável apenas adicionando', () => {
    const ctx = ctxWith();
    expect(completableByAdding(ctx, target(), ring(['Life2']))).toBe(true);
    // Life1 (T3) bloqueia o grupo Life: requisito T2 nunca mais entra sem remover.
    expect(completableByAdding(ctx, target(), ring(['Life1']))).toBe(false);
    // Dois sufixos sem Fire: ainda há um espaço de sufixo.
    expect(completableByAdding(ctx, target(), ring(['Life2', 'Cold1', 'Str1']))).toBe(true);
    // Mágico com sufixo ocupado por Cold: sem espaço para Fire como mágico.
    expect(completableByAdding(ctx, { ...target(), rarity: 'magic' }, ring(['Life2', 'Cold1'], 'magic'), 'magic')).toBe(false);
    expect(evaluate(ctx, target(), ring(['Life2', 'Fire3'])).allRequired).toBe(true);
  });
});

describe('limites de afixos alterados pela base', () => {
  it('implícito "+1 prefixo / -1 sufixo" altera o limite do raro', () => {
    const ctx = ctxWith();
    expect(limitsFor(ctx, 'rare', 'Dusk')).toEqual({ prefix: 4, suffix: 2 });
    expect(limitsFor(ctx, 'magic', 'Dusk')).toEqual({ prefix: 1, suffix: 1 });
    const two: ItemState = { baseId: 'Dusk', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Fire1' }, { modId: 'Cold1' }] };
    expect(checkAction(ctx, two, { currency: 'exalt', omens: ['dextral-exaltation'] }).ok).toBe(false);
    expect(validateItem(ctx, { ...two, mods: [...two.mods, { modId: 'Str1' }] }).some((i) => i.key === 'val.tooManySuffixes')).toBe(true);
  });
});
