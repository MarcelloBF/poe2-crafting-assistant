import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Dataset } from '../src/data/types';
import { DEFAULT_RULES } from '../src/data/rules';
import { createContext } from '../src/engine/context';
import { extractValues, genericKey, importToItem, importToTarget, parseItemText } from '../src/engine/itemImport';
import { validateItem } from '../src/engine/item';
import { validateTarget } from '../src/engine/target';

const dir = path.resolve(__dirname, '../public/data/poe2');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const mods = read('mods.json');
const data: Dataset = { meta: read('meta.json'), bases: read('bases.json'), mods: mods.mods, implicits: mods.implicits, stats: read('stats.json') };
const ctx = createContext(data, structuredClone(DEFAULT_RULES), { table: null, hypothesis: { kind: 'uniform' } });

describe('normalização de texto', () => {
  it('troca números e intervalos por #', () => {
    expect(genericKey('(13-17)% increased Cold Damage')).toBe('#% increased cold damage');
    expect(genericKey('+45 to maximum Life')).toBe('# to maximum life');
    expect(genericKey('Adds (3-5) to (6-9) Fire damage to Attacks')).toBe('adds # to # fire damage to attacks');
  });
  it('extrai valores e intervalos (inclusive Ctrl+Alt+C)', () => {
    expect(extractValues('(13-17)% increased Cold Damage')).toEqual({ values: [13, 17], isRange: true });
    expect(extractValues('15% increased Cold Damage')).toEqual({ values: [15], isRange: false });
    expect(extractValues('+30(25-35) to maximum Life')).toEqual({ values: [30], isRange: false });
  });
});

// Texto como o OCR lê a imagem enviada pelo jogador (tooltip de ferramenta externa).
const SCREENSHOT = `Gold Ring
Rings
Requires: 40 Level.
Body Armour: (6-15)% increased Rarity of Items found
(15-25)% increased Spell Damage while on Full
Energy Shield P1
(13-17)% increased Cold Damage P4
(25-34)% increased Spell Damage P8
(25-28)% increased Cast Speed S3
(11-14)% increased Rarity of Items found S4
(16-18)% increased Critical Hit Chance for Spells S5`;

describe('item da imagem do jogador (Gold Ring)', () => {
  const r = parseItemText(ctx, SCREENSHOT);
  const byText = (s: string) => r.lines.find((l) => l.raw.includes(s))!;
  it('detecta a base e o implícito', () => {
    expect(r.base?.name).toBe('Gold Ring');
    expect(byText('Body Armour').status).toBe('implicit');
  });
  it('reconhece mods possíveis no anel com o tier exato', () => {
    const cold = byText('Cold Damage');
    expect(cold.status).toBe('ok');
    expect(cold.matches[0].mod.id).toBe('ColdDamagePercent3');
    const rar = byText('(11-14)% increased Rarity');
    expect(rar.status).toBe('ok');
    expect(rar.matches[0].mod.gen).toBe('suffix');
  });
  it('aponta mods que não existem no anel', () => {
    expect(byText('(25-34)% increased Spell Damage').status).toBe('notOnBase');
    expect(byText('Critical Hit Chance for Spells').status).toBe('notOnBase');
    // Velocidade de conjuração existe em anel, mas 25-28 só em amuleto/foco/varinha.
    expect(byText('Cast Speed').status).toBe('valueNotOnBase');
    // Mod da Abyss (Kurgal) para anel/amuleto: reconhecido como profanado.
    const abyss = byText('Spell Damage while on Full');
    expect(abyss.status).toBe('ok');
    expect(abyss.matches[0].mod.desecrated).toBe(true);
    expect(abyss.matches[0].mod.lord).toBe('kurgal');
    expect(r.warnings).toEqual(expect.arrayContaining(['imp.notOnBase', 'imp.valueNotOnBase']));
  });
  it('sugere categorias onde os mods reconhecidos existem', () => {
    expect(r.suggestedClasses).not.toContain('Ring');
  });
  it('gera um objetivo válido só com o que é possível na base', () => {
    const t = importToTarget(ctx, r, 82, 'rare')!;
    expect(t.requirements.map((x) => x.family).sort()).toEqual(['prefix:ColdDamagePercentage', 'prefix:IncreasedSpellDamageOnFullEnergyShield@abyss', 'suffix:IncreasedCastSpeed', 'suffix:ItemFoundRarityIncrease'].sort());
    expect(validateTarget(ctx, t).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

// Saída real do OCR (tesseract.js) para a imagem enviada, com marcadores e ruído de ícones.
const OCR_RAW = `i | |
a
4
Gold Ring
Rings
Requires: 40 Level.
| » Body Armour: (6-15)% increased Rarity of Items found
» (15-25)% increased Spell Damage while on Full
Energy Shield
» (13-17)% increased Cold Damage
» (25-34)% increased Spell Damage
» (25-28)% increased Cast Speed
« (11-14)% increased Rarity of Items found
» (16-18)% increased Critical Hit Chance for Spells
7 Su I I I CL I GR`;

describe('texto bruto do OCR', () => {
  it('ignora ruído e marcadores e reconhece as mesmas linhas', () => {
    const r = parseItemText(ctx, OCR_RAW);
    expect(r.base?.name).toBe('Gold Ring');
    const st = (s: string) => r.lines.find((l) => l.raw.includes(s))?.status;
    expect(st('Cold Damage')).toBe('ok');
    expect(st('(11-14)%')).toBe('ok');
    expect(st('Body Armour')).toBe('implicit');
    expect(st('(25-34)% increased Spell Damage')).toBe('notOnBase');
    expect(r.lines.some((l) => l.raw.includes('Su I I'))).toBe(false);
    expect(r.lines.filter((l) => l.status === 'unknown')).toHaveLength(0);
  });
});

const CTRL_C = `Item Class: Rings
Rarity: Rare
Doom Loop
Iron Ring
--------
Requires: Level 33
--------
Item Level: 81
--------
Adds 2 to 4 Physical Damage to Attacks (implicit)
--------
+64 to maximum Life
+32% to Fire Resistance
+28% to Cold Resistance`;

describe('texto copiado do jogo (Ctrl+C)', () => {
  const r = parseItemText(ctx, CTRL_C);
  it('lê raridade, nível do item, base e mods', () => {
    expect(r.base?.name).toBe('Iron Ring');
    expect(r.rarity).toBe('rare');
    expect(r.ilvl).toBe(81);
    const ok = r.lines.filter((l) => l.status === 'ok');
    expect(ok).toHaveLength(3);
    expect(r.lines.find((l) => l.raw.includes('Physical'))!.status).toBe('implicit');
    expect(r.lines.find((l) => l.raw === 'Doom Loop')!.status).toBe('header');
  });
  it('converte em item atual válido com valores', () => {
    const it = importToItem(r, 81, 'rare')!;
    expect(it.mods).toHaveLength(3);
    expect(validateItem(ctx, it)).toEqual([]);
    expect(it.mods.find((m) => m.modId.startsWith('IncreasedLife'))!.values).toEqual([64]);
  });
});
