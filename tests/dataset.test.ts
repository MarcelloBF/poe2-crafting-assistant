// Testes de integridade do dataset real gerado por scripts/import-repoe.mjs.
// Rode após cada atualização dos dados do jogo (npm run data:download && npm test).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Dataset } from '../src/data/types';
import { DEFAULT_RULES } from '../src/data/rules';
import { createContext, getBasePool } from '../src/engine/context';
import { limitsFor, newItem } from '../src/engine/item';
import { actionDistribution } from '../src/engine/actions';
import { simulateStrategy } from '../src/engine/simulate';
import { candidateStrategies } from '../src/engine/strategies';
import { validateTarget, type TargetSpec } from '../src/engine/target';
import { modText, setPtTemplates } from '../src/engine/text';
import { MOD_TEMPLATES_PT_BR } from '../src/i18n/modTemplatesPtBr';
import { ptBR } from '../src/i18n/pt-BR';
import { en } from '../src/i18n/en';

const dir = path.resolve(__dirname, '../public/data/poe2');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const mods = read('mods.json');
const data: Dataset = { meta: read('meta.json'), bases: read('bases.json'), mods: mods.mods, implicits: mods.implicits, stats: read('stats.json') };
const ctx = createContext(data, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'uniform' } });

describe('integridade do dataset real', () => {
  it('ids únicos e campos obrigatórios', () => {
    expect(new Set(data.mods.map((m) => m.id)).size).toBe(data.mods.length);
    expect(new Set(data.bases.map((b) => b.id)).size).toBe(data.bases.length);
    for (const m of data.mods) {
      expect(['prefix', 'suffix']).toContain(m.gen);
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(m.groups)).toBe(true);
    }
  });
  it('implícitos referenciados pelas bases existem', () => {
    for (const b of data.bases) for (const i of b.implicits) expect(data.implicits[i], `${b.name}: ${i}`).toBeDefined();
  });
  it('todas as categorias de equipamento têm modificadores possíveis', () => {
    const classes = new Set(data.bases.map((b) => b.itemClass));
    for (const c of classes) {
      const b = data.bases.find((x) => x.itemClass === c)!;
      expect(getBasePool(ctx, b.id).entries.length, c).toBeGreaterThan(0);
    }
  });
  it('limites de afixos das bases especiais (Dusk/Penumbra Ring) são lidos dos implícitos', () => {
    const dusk = data.bases.find((b) => b.name === 'Dusk Ring');
    if (dusk) expect(limitsFor(ctx, 'rare', dusk.id)).toEqual({ prefix: 4, suffix: 2 });
    const pen = data.bases.find((b) => b.name === 'Penumbra Ring');
    if (pen) expect(limitsFor(ctx, 'rare', pen.id)).toEqual({ prefix: 5, suffix: 1 });
  });
  it('distribuição de uma Transmutação soma 1 em base real', () => {
    const ring = data.bases.find((b) => b.name === 'Iron Ring')!;
    const d = actionDistribution(ctx, newItem(ring.id, 82), { currency: 'transmute' })!;
    expect(d.outcomes.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 9);
    expect(d.provenance.confidence).toBe('estimated');
  });
  it('estratégias rodam em um alvo real', () => {
    const ring = data.bases.find((b) => b.name === 'Iron Ring')!;
    const t: TargetSpec = { baseId: ring.id, ilvl: 82, rarity: 'rare', requirements: [{ id: 'a', family: 'prefix:IncreasedLife', minTier: 6, required: true, priority: 1 }] };
    expect(validateTarget(ctx, t).filter((i) => i.severity === 'error')).toHaveLength(0);
    const { strategies } = candidateStrategies(ctx, t);
    const st = simulateStrategy(ctx, strategies[0], t, { runs: 300, seed: 1 });
    expect(st.runs).toBe(300);
    expect(st.pSuccess).toBeGreaterThan(0);
  });
});

describe('traduções', () => {
  it('dicionários PT e EN têm as mesmas chaves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort());
  });
  it('templates PT referem-se a textos que existem no dataset atual', () => {
    const enStrings = new Set(data.stats.flatMap((s) => (s.langs.English ?? []).map((v) => v.string)));
    const stale = Object.keys(MOD_TEMPLATES_PT_BR).filter((k) => !enStrings.has(k));
    expect(stale).toEqual([]);
  });
  it('placeholders preservados em cada template PT', () => {
    for (const [k, v] of Object.entries(MOD_TEMPLATES_PT_BR)) {
      const ph = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      expect(ph(v), k).toBe(ph(k));
    }
  });
  it('mods comuns de anel aparecem em português', () => {
    setPtTemplates(MOD_TEMPLATES_PT_BR);
    const life = data.mods.find((m) => m.id === 'IncreasedLife1')!;
    expect(modText(ctx, life, 'pt-BR').text).toMatch(/de Vida máxima/);
  });
});
