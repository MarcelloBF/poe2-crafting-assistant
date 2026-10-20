import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Dataset, ModDef } from '../src/data/types';
import { DEFAULT_RULES } from '../src/data/rules';
import { actionDistribution, applyAction, checkAction, noPreferredProbability } from '../src/engine/actions';
import { createContext, getBasePool } from '../src/engine/context';
import { eligiblePool, type ItemState, validateItem } from '../src/engine/item';
import { analyzeNextAction } from '../src/engine/probability';
import { mulberry32 } from '../src/engine/rng';
import { divergenceZ, simulateSequence, simulateStrategy } from '../src/engine/simulate';
import { candidateStrategies, decide, type Strategy } from '../src/engine/strategies';
import { type TargetSpec, validateTarget } from '../src/engine/target';
import { DATA, WEIGHTS } from './fixtures';

const abyssMod = (id: string, gen: 'prefix' | 'suffix', lord: 'ulaman' | 'kurgal', stat: string): ModDef => ({
  id,
  name: '',
  gen,
  type: id,
  groups: [id],
  level: 65,
  spawn: [['ring', 1], ['default', 0], [`${lord}_mod`, 1]],
  stats: [{ id: stat, min: 10, max: 20 }],
  text: `+(10-20) ${stat}`,
  tags: [],
  essenceOnly: false,
  desecrated: true,
  lord,
});

const DATA2: Dataset = {
  ...DATA,
  mods: [...DATA.mods, abyssMod('KurgalSpell', 'prefix', 'kurgal', 'spell'), abyssMod('KurgalCdr', 'suffix', 'kurgal', 'cdr'), abyssMod('UlamanSpeed', 'suffix', 'ulaman', 'speed')],
};
const W = { ...WEIGHTS, KurgalSpell: 10, KurgalCdr: 10, UlamanSpeed: 10 };
const ctx = (essences = []) => createContext(DATA2, structuredClone(DEFAULT_RULES), { table: { source: 't', confidence: 'confirmed', importedAt: '', weights: W }, hypothesis: { kind: 'none' } }, essences);
const ring = (mods: string[], rarity: ItemState['rarity'] = 'rare', ilvl = 80): ItemState => ({ baseId: 'Ring', ilvl, rarity, mods: mods.map((modId) => ({ modId })) });

describe('mods da Abyss (profanados)', () => {
  it('ficam fora dos sorteios normais e em famílias próprias', () => {
    const c = ctx();
    const ex = eligiblePool(c, ring(['Life1']), { rarity: 'rare' });
    expect(ex.entries.some((e) => e.entry.mod.desecrated)).toBe(false);
    expect(getBasePool(c, 'Ring').byMod.get('KurgalSpell')!.family).toBe('prefix:KurgalSpell@abyss');
  });
  it('fórmula exata de "nenhuma preferida entre 3 opções" bate com força bruta', () => {
    const non = [1, 2, 3, 4];
    const pref = 5;
    const all = [...non, pref];
    const total = all.reduce((a, b) => a + b, 0);
    let brute = 0;
    // Sequências ordenadas de 3 itens distintos sem o preferido (índice 4).
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        for (let k = 0; k < 5; k++) {
          if (i === j || j === k || i === k || [i, j, k].includes(4)) continue;
          const p1 = all[i] / total;
          const p2 = all[j] / (total - all[i]);
          const p3 = all[k] / (total - all[i] - all[j]);
          brute += p1 * p2 * p3;
        }
    expect(noPreferredProbability(non, pref, 3)).toBeCloseTo(brute, 12);
    expect(noPreferredProbability(non, pref, 1)).toBeCloseTo(10 / 15, 12);
    expect(noPreferredProbability([1, 1], 1, 3)).toBe(0);
  });
  it('regras dos ossos: categoria, nível máximo, item já profanado', () => {
    const c = ctx();
    expect(checkAction(c, ring(['Life1']), { currency: 'preserved-collarbone' }).ok).toBe(true);
    expect(checkAction(c, ring(['Life1']), { currency: 'preserved-jawbone' }).ok).toBe(false); // anel não é arma
    expect(checkAction(c, ring(['Life1']), { currency: 'gnawed-collarbone' }).ok).toBe(false); // ilvl 80 > 64
    expect(checkAction(c, ring(['Life1'], 'rare', 60), { currency: 'gnawed-collarbone' }).ok).toBe(true);
    expect(checkAction(c, ring(['Life1'], 'magic'), { currency: 'preserved-collarbone' }).ok).toBe(false);
    const done: ItemState = { ...ring(['Life1']), mods: [{ modId: 'Life1' }, { modId: 'Fire1', desecrated: true }] };
    expect(checkAction(c, done, { currency: 'preserved-collarbone' }).ok).toBe(false);
  });
  it('presságio de lorde garante mods daquele lorde', () => {
    const c = ctx();
    const d = actionDistribution(c, ring(['Life1']), { currency: 'preserved-collarbone', omens: ['blackblooded'], prefer: ['KurgalCdr'] })!;
    const ids = d.outcomes.map((o) => o.item.mods.find((m) => m.desecrated)!.modId);
    // Só 2 mods Kurgal elegíveis (< 3 opções): ambos aparecem e o jogador sempre escolhe o preferido.
    expect(ids).toEqual(['KurgalCdr']);
    expect(d.outcomes.find((o) => o.item.mods.some((m) => m.modId === 'KurgalCdr'))!.p).toBeCloseTo(1, 10);
  });
  it('sem presságio, opções incluem mods normais; chance = 1 - P(nenhum preferido)', () => {
    const c = ctx();
    const it = ring(['Life1', 'Mana1', 'Fire1']); // prefixos cheios? não: limite 3 — 2 prefixos + 1 sufixo
    const a = analyzeNextAction(c, it, { currency: 'preserved-collarbone' }, {
      baseId: 'Ring',
      ilvl: 80,
      rarity: 'rare',
      requirements: [{ id: 'k', family: 'suffix:KurgalCdr@abyss', minTier: 1, required: true, priority: 1 }],
    });
    const pool = eligiblePool(c, it, { rarity: 'rare', kinds: ['normal', 'desecrated'] });
    const pref = pool.entries.filter((e) => e.entry.mod.id === 'KurgalCdr').reduce((s, e) => s + e.weight, 0);
    const non = pool.entries.filter((e) => e.entry.mod.id !== 'KurgalCdr').map((e) => e.weight);
    expect(a.success.value).toBeCloseTo(1 - noPreferredProbability(non, pref, 3), 10);
    expect(a.success.provenance.confidence).toBe('estimated');
  });
  it('Ecos Abissais: duas chances de ver o preferido', () => {
    const c = ctx();
    const t: TargetSpec = { baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [{ id: 'k', family: 'suffix:KurgalCdr@abyss', minTier: 1, required: true, priority: 1 }] };
    const base = analyzeNextAction(c, ring(['Life1']), { currency: 'preserved-collarbone' }, t).success.value!;
    const echo = analyzeNextAction(c, ring(['Life1']), { currency: 'preserved-collarbone', omens: ['abyssal-echoes'] }, t).success.value!;
    expect(echo).toBeCloseTo(1 - (1 - base) ** 2, 10);
  });
  it('simulação da profanação converge para o cálculo', () => {
    const c = ctx();
    const t: TargetSpec = { baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [{ id: 'k', family: 'suffix:KurgalCdr@abyss', minTier: 1, required: true, priority: 1 }] };
    const start = ring(['Life1']);
    const spec = { currency: 'preserved-collarbone', prefer: ['KurgalCdr'] };
    const exact = analyzeNextAction(c, start, spec, t).success.value!;
    const sim = simulateSequence(c, start, [spec], t, 20000, 5);
    expect(Math.abs(divergenceZ(exact, sim.successes, sim.runs))).toBeLessThan(4);
  });
  it('item cheio: profanar remove um mod aleatório antes', () => {
    const c = ctx();
    const full = ring(['Life2', 'Mana1', 'Fire1', 'Cold1', 'Str1']);
    full.mods = full.mods.slice(0, 5);
    const it: ItemState = { ...full };
    const r = applyAction(c, it, { currency: 'preserved-collarbone' }, mulberry32(3)).item;
    expect(r.mods.filter((m) => m.desecrated)).toHaveLength(1);
    expect(validateItem(c, r)).toEqual([]);
  });
  it('validação: só um mod da Abyss por item, e só em raro', () => {
    const c = ctx();
    const two = validateTarget(c, {
      baseId: 'Ring',
      ilvl: 80,
      rarity: 'rare',
      requirements: [
        { id: 'a', family: 'suffix:KurgalCdr@abyss', minTier: 1, required: true, priority: 1 },
        { id: 'b', family: 'prefix:KurgalSpell@abyss', minTier: 1, required: true, priority: 1 },
      ],
    });
    expect(two.map((i) => i.key)).toContain('tgt.multipleAbyss');
    expect(validateItem(c, { ...ring([]), mods: [{ modId: 'KurgalCdr' }, { modId: 'KurgalSpell' }] }).map((i) => i.key)).toContain('val.multipleDesecrated');
  });
  it('estratégia usa osso + presságio do lorde no mod da Abyss, e Light para tirar profanado errado', () => {
    const c = ctx();
    const t: TargetSpec = {
      baseId: 'Ring',
      ilvl: 80,
      rarity: 'rare',
      requirements: [
        { id: 'l', family: 'prefix:Life', minTier: 3, required: true, priority: 1 },
        { id: 'k', family: 'suffix:KurgalCdr@abyss', minTier: 1, required: true, priority: 1 },
      ],
    };
    const s: Strategy = { id: 's', kind: 'magicExalt', params: { grade: 'normal', sideOmens: true, recovery: 'annul', maxActions: 40 } };
    const d = decide(c, s, t, ring(['Life1']), 3);
    expect(d.kind === 'action' && d.spec.currency).toBe('preserved-collarbone');
    expect(d.kind === 'action' && d.spec.omens).toContain('blackblooded');
    const wrong: ItemState = { ...ring([]), mods: [{ modId: 'Life1' }, { modId: 'Fire1', desecrated: true }] };
    const d2 = decide(c, s, t, wrong, 4);
    expect(d2.kind === 'action' && d2.spec.omens).toEqual(['light']);
    const st = simulateStrategy(c, s, t, { runs: 2000, seed: 9 });
    expect(st.pSuccess).toBeGreaterThan(0.1);
    expect(Object.keys(st.usagePerRun)).toContain('Preserved Collarbone');
  });
  it('candidatas incluem "último mod por profanação" quando há osso para a categoria', () => {
    const c = ctx();
    const t: TargetSpec = { baseId: 'Ring', ilvl: 80, rarity: 'rare', requirements: [{ id: 'l', family: 'prefix:Life', minTier: 3, required: true, priority: 1 }] };
    expect(candidateStrategies(c, t).strategies.some((s) => s.params.desecrate === 'last')).toBe(true);
  });
});

describe('essências', () => {
  const ess = (mode: 'magicToRare' | 'rareReplace', modIds: string[]) => [
    { id: 'e', nameEn: 'Test Essence', tier: 'normal' as const, mode, effects: [{ category: 'Ring', text: '', itemClasses: ['Ring'], modIds }] },
  ];
  it('efeito com vários mods: um deles é sorteado (estimativa)', () => {
    const c = createContext(DATA2, structuredClone(DEFAULT_RULES), { table: { source: 't', confidence: 'confirmed', importedAt: '', weights: W }, hypothesis: { kind: 'none' } }, ess('magicToRare', ['Fire2', 'Cold2', 'Str1']));
    const d = actionDistribution(c, ring([], 'magic'), { currency: 'essence', essenceId: 'e' })!;
    expect(d.outcomes).toHaveLength(3);
    d.outcomes.forEach((o) => expect(o.p).toBeCloseTo(1 / 3, 10));
    expect(d.provenance.assumptions).toContain('assume.essenceAlternatives');
  });
  it('Perfect (rareReplace): remove do lado cheio e adiciona o garantido', () => {
    const c = createContext(DATA2, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'none' } }, ess('rareReplace', ['Fire3']));
    // Sufixos cheios (Cold1, Str1 + ... ) — com 2 sufixos o lado não está cheio; usamos 3 grupos de sufixo.
    const it = ring(['Life1', 'Cold1', 'Str1']);
    const d = actionDistribution(c, it, { currency: 'essence', essenceId: 'e' })!;
    expect(d.outcomes.every((o) => o.item.mods.some((m) => m.modId === 'Fire3'))).toBe(true);
    expect(d.outcomes.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 10);
  });
  it('Cristalização: a essência Perfect remove só do lado do presságio', () => {
    const c = createContext(DATA2, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'none' } }, ess('rareReplace', ['Fire3']));
    const it = ring(['Life1', 'Cold1', 'Str1']);
    const d = actionDistribution(c, it, { currency: 'essence', essenceId: 'e', omens: ['sinistral-crystallisation'] })!;
    // Único prefixo (Life1) sai; os sufixos ficam.
    expect(d.outcomes).toHaveLength(1);
    expect(d.outcomes[0].item.mods.map((m) => m.modId).sort()).toEqual(['Cold1', 'Fire3', 'Str1']);
    // Presságio de essência não vale para Exaltado, e Cristalização não vale para essência que não remove.
    expect(checkAction(c, it, { currency: 'exalt', omens: ['sinistral-crystallisation'] }).ok).toBe(false);
    const c2 = createContext(DATA2, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'none' } }, ess('magicToRare', ['Fire3']));
    expect(checkAction(c2, ring([], 'magic'), { currency: 'essence', essenceId: 'e', omens: ['dextral-crystallisation'] }).ok).toBe(false);
  });
  it('essência não se aplica a outra categoria', () => {
    const c = createContext(DATA2, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'none' } }, ess('magicToRare', ['Fire3']));
    expect(checkAction(c, { baseId: 'Boots', ilvl: 80, rarity: 'magic', mods: [] }, { currency: 'essence', essenceId: 'e' }).ok).toBe(false);
  });
});

describe('dados reais: essências e Abyss', () => {
  const dir = path.resolve(__dirname, '../public/data/poe2');
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const mods = read('mods.json');
  const data: Dataset = { meta: read('meta.json'), bases: read('bases.json'), mods: mods.mods, implicits: mods.implicits, stats: read('stats.json'), essences: read('essences.json') };
  const real = createContext(data, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'uniform' } });
  it('tabela de essências importada e ligada aos mods do jogo', () => {
    expect(data.essences!.length).toBeGreaterThan(60);
    const body = data.essences!.find((e) => e.nameEn === 'Essence of the Body')!;
    expect(body.mode).toBe('magicToRare');
    const ringEff = body.effects.find((e) => e.itemClasses.includes('Ring'))!;
    expect(ringEff.modIds).toEqual(['IncreasedLife6']);
    const perfect = data.essences!.find((e) => e.nameEn.startsWith('Perfect Essence of the Body'))!;
    expect(perfect.mode).toBe('rareReplace');
  });
  it('mod Kurgal de anel/amuleto existe e só aparece por profanação', () => {
    const goldRing = data.bases.find((b) => b.name === 'Gold Ring')!;
    const e = getBasePool(real, goldRing.id).byMod.get('AbyssModRingAmuletKurgalPrefixSpellDamageWhileEnergyShieldFull')!;
    expect(e.kind).toBe('desecrated');
    expect(e.mod.lord).toBe('kurgal');
  });
  it('estratégia com essência aparece para alvo de vida em anel', () => {
    const iron = data.bases.find((b) => b.name === 'Iron Ring')!;
    const t: TargetSpec = { baseId: iron.id, ilvl: 82, rarity: 'rare', requirements: [{ id: 'l', family: 'prefix:IncreasedLife', minTier: 8, required: true, priority: 1 }] };
    const { strategies } = candidateStrategies(real, t);
    expect(strategies.some((s) => s.kind === 'essenceExalt' && s.params.essenceId === 'essence-of-the-body')).toBe(true);
  });
});
