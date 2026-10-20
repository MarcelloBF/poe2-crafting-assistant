import { describe, expect, it } from 'vitest';
import { costOfUsage, costPercentiles, expectedTotalCost, isStale, parseNinjaExchange, type PriceBook } from '../src/engine/cost';
import { createProject, materialsUsed, recordAttempt, startNewBase, tutorialState, undoAttempt } from '../src/engine/project';
import { mulberry32 } from '../src/engine/rng';
import { modText, setPtTemplates } from '../src/engine/text';
import { MOD_TEMPLATES_PT_BR } from '../src/i18n/modTemplatesPtBr';
import type { TargetSpec } from '../src/engine/target';
import { ctxWith } from './fixtures';

const book: PriceBook = {
  league: 'Teste',
  unit: 'exalted',
  entries: {
    'Exalted Orb': { value: 1, source: 'manual', updatedAt: '2026-01-01T00:00:00Z' },
    'Orb of Transmutation': { value: 0.1, source: 'poe.ninja', updatedAt: '2026-01-01T00:00:00Z' },
  },
};

describe('custos', () => {
  it('soma custos e aponta preços faltantes', () => {
    const r = costOfUsage({ 'Exalted Orb': 3, 'Orb of Transmutation': 10 }, book, null, Date.parse('2026-01-01T01:00:00Z'));
    expect(r.total).toBeCloseTo(4, 10);
    const m = costOfUsage({ 'Exalted Orb': 1, __base__: 1, 'Regal Orb': 1 }, book, null);
    expect(m.total).toBeNull();
    expect(m.missing).toEqual(['__base__', 'Regal Orb']);
    expect(costOfUsage({ __base__: 2 }, book, 0.5).total).toBe(1);
  });
  it('marca preços de mercado desatualizados, nunca os manuais', () => {
    const now = Date.parse('2026-01-03T00:00:00Z');
    expect(isStale(book.entries['Orb of Transmutation'], now)).toBe(true);
    expect(isStale(book.entries['Exalted Orb'], now)).toBe(false);
  });
  it('custo esperado = custo por execução / chance', () => {
    expect(expectedTotalCost(10, 0.2)).toBeCloseTo(50, 10);
    expect(expectedTotalCost(10, 0)).toBeNull();
  });
  it('percentis de custo com execuções sempre bem-sucedidas = custo da execução', () => {
    const p = costPercentiles([5, 5, 5], [true, true, true], mulberry32(1), 200)!;
    expect(p.p50).toBe(5);
    expect(p.p90).toBe(5);
  });
  it('converte a resposta do poe.ninja (PoE2) para exalted', () => {
    const json = {
      core: { items: [{ id: 'divine', name: 'Divine Orb' }], rates: { exalted: 686.4, chaos: 9.7 }, primary: 'divine', secondary: 'chaos' },
      lines: [{ id: 'exalted', primaryValue: 0.001457 }, { id: 'alch', primaryValue: 0.004459 }],
      items: [{ id: 'exalted', name: 'Exalted Orb' }, { id: 'alch', name: 'Orb of Alchemy' }],
    };
    const r = parseNinjaExchange(json, '2026-10-20T00:00:00Z');
    expect(r.entries['Exalted Orb'].value).toBeCloseTo(1.0, 1);
    expect(r.entries['Orb of Alchemy'].value).toBeCloseTo(3.06, 2);
    expect(r.entries['Divine Orb'].value).toBe(686.4);
    expect(r.divineInExalted).toBe(686.4);
  });
});

const target: TargetSpec = {
  baseId: 'Ring',
  ilvl: 80,
  rarity: 'rare',
  requirements: [
    { id: 'a', family: 'prefix:Life', minTier: 2, required: true, priority: 1 },
    { id: 'b', family: 'suffix:Fire', minTier: 3, required: true, priority: 1 },
  ],
};

describe('projeto e tutorial adaptativo', () => {
  const strategy = { id: 's', kind: 'magicExalt' as const, params: { grade: 'normal' as const, sideOmens: false, recovery: 'restart' as const, maxActions: 40 } };

  it('recomenda a primeira ação e exige o resultado real', () => {
    const ctx = ctxWith();
    const p = createProject('Anel', target, strategy);
    const ts = tutorialState(ctx, p);
    expect(ts.decision?.kind).toBe('action');
    expect(ts.analysis?.success.value).toBe(0);
  });
  it('rejeita resultado impossível e aceita o real', () => {
    const ctx = ctxWith();
    const p = createProject('Anel', target, strategy);
    const bad = recordAttempt(ctx, p, { currency: 'transmute' }, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Move1' }] });
    expect(bad.project).toBeNull();
    expect(bad.issues.map((i) => i.key)).toContain('val.modNotOnBase');
    const ok = recordAttempt(ctx, p, { currency: 'transmute' }, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }] });
    expect(ok.project!.attempts).toHaveLength(1);
    expect(ok.project!.attempts[0].outcome).toBe('progress');
    expect(ok.unexpected).toBe(false);
    const next = tutorialState(ctx, ok.project!);
    expect(next.decision?.kind === 'action' && next.decision.spec.currency).toBe('augment');
  });
  it('detecta resultado diferente do possível', () => {
    const ctx = ctxWith();
    const p = createProject('Anel', target, strategy);
    const r = recordAttempt(ctx, p, { currency: 'transmute' }, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Life2' }, { modId: 'Fire1' }] });
    expect(r.unexpected).toBe(true);
    expect(r.project!.attempts[0].outcome).toBe('unexpected');
  });
  it('voltar etapa restaura o item; base nova conta material', () => {
    const ctx = ctxWith();
    const p0 = createProject('Anel', target, strategy);
    const p1 = recordAttempt(ctx, p0, { currency: 'transmute' }, { baseId: 'Ring', ilvl: 80, rarity: 'magic', mods: [{ modId: 'Str1' }] }).project!;
    const p2 = undoAttempt(p1);
    expect(p2.item.rarity).toBe('normal');
    expect(p2.attempts).toHaveLength(0);
    const p3 = startNewBase(p1);
    expect(p3.item.mods).toHaveLength(0);
    expect(materialsUsed(p3)).toEqual({ __base__: 2, 'Orb of Transmutation': 1 });
  });
  it('marca o projeto como concluído quando o resultado real atinge o alvo', () => {
    const ctx = ctxWith();
    let p = createProject('Anel', target, strategy);
    p = { ...p, item: { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life2' }] } };
    const r = recordAttempt(ctx, p, { currency: 'exalt' }, { baseId: 'Ring', ilvl: 80, rarity: 'rare', mods: [{ modId: 'Life2' }, { modId: 'Fire1' }] });
    expect(r.project!.status).toBe('done');
    expect(r.project!.attempts[0].outcome).toBe('success');
  });
});

describe('traduções de modificadores', () => {
  it('inglês vem dos dados do jogo', () => {
    const ctx = ctxWith();
    expect(modText(ctx, ctx.modsById.get('Life2')!, 'en').text).toBe('+(20-29) life');
    expect(modText(ctx, ctx.modsById.get('Life2')!, 'en', [25]).text).toBe('+25 to maximum Life');
  });
  it('português usa template ligado ao id do stat', () => {
    const ctx = ctxWith();
    setPtTemplates(MOD_TEMPLATES_PT_BR);
    const t = modText(ctx, ctx.modsById.get('Life2')!, 'pt-BR');
    expect(t.text).toBe('+(20-29) de Vida máxima');
    expect(t.translated).toBe(true);
    expect(modText(ctx, ctx.modsById.get('Fire3')!, 'pt-BR').text).toBe('+(21-30)% de Resistência a Fogo');
  });
  it('sem tradução, exibe inglês e sinaliza', () => {
    const ctx = ctxWith();
    setPtTemplates({});
    const t = modText(ctx, ctx.modsById.get('Life2')!, 'pt-BR');
    expect(t.translated).toBe(false);
    expect(t.text).toBe('+(20-29) life');
    setPtTemplates(MOD_TEMPLATES_PT_BR);
  });
});
