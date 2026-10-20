import { describe, expect, it } from 'vitest';
// @ts-expect-error - módulo JS do script de importação
import { buildDataset, cleanText } from '../scripts/import-repoe.mjs';
import fs from 'node:fs';
import path from 'node:path';

const raw = {
  mods: {
    IncreasedLife1: { domain: 'item', generation_type: 'prefix', groups: ['IncreasedLife'], implicit_tags: ['life'], is_essence_only: false, name: 'Hale', required_level: 1, spawn_weights: [{ tag: 'ring', weight: 1 }, { tag: 'default', weight: 0 }], stats: [{ id: 'base_maximum_life', min: 10, max: 19 }], text: '+(10-19) to maximum [Life]', type: 'IncreasedLife' },
    MonsterThing: { domain: 'monster', generation_type: 'prefix', groups: [], implicit_tags: [], is_essence_only: false, name: '', required_level: 1, spawn_weights: [{ tag: 'default', weight: 1 }], stats: [], text: '', type: 'X' },
    NeverSpawns: { domain: 'item', generation_type: 'suffix', groups: ['A'], implicit_tags: [], is_essence_only: false, name: 'of Nothing', required_level: 1, spawn_weights: [{ tag: 'default', weight: 0 }], stats: [], text: '', type: 'A' },
    RingImplicit: { domain: 'item', generation_type: 'unique', groups: [], implicit_tags: [], is_essence_only: false, name: '', required_level: 1, spawn_weights: [], stats: [{ id: 'base_maximum_life', min: 5, max: 5 }], text: '+5 to maximum Life', type: 'I' },
  },
  bases: {
    'Metadata/Items/Rings/Ring1': { domain: 'item', item_class: 'Ring', name: 'Iron Ring', release_state: 'released', tags: ['ring', 'default'], drop_level: 1, implicits: ['RingImplicit'] },
    'Metadata/Items/Rings/Unreleased': { domain: 'item', item_class: 'Ring', name: 'Nope', release_state: 'unreleased', tags: ['ring'], drop_level: 1, implicits: [] },
    'Metadata/Items/Fish': { domain: 'item', item_class: 'FishingRod', name: 'Rod', release_state: 'released', tags: [], drop_level: 1, implicits: [] },
  },
  stats: [
    { ids: ['base_maximum_life'], English: [{ condition: [{}], format: ['+#'], index_handlers: [[]], string: '{0} to maximum [Life]' }], trade_stats: [] },
    { ids: ['unused'], English: [{ condition: [{}], format: ['#'], index_handlers: [[]], string: 'x' }] },
  ],
};

// @ts-expect-error - módulo JS do script de importação
import { categoryClasses, linkEssences, parseEssencePage, textRanges } from '../scripts/essences.mjs';

describe('importador de essências (poe2db)', () => {
  const card = (name: string, rule: string, lines: string[]) =>
    `<a class="item_currency StackableCurrency" href="x"><img loading="lazy" src="" alt="a" height="16" />${name}</a><div><div class="property">Stack Size: 1 / 10</div><div class="separator"></div><div class="explicitMod">${rule}</div>${lines.map((l) => `<div class="explicitMod">${l}</div>`).join('')}</div></div></div></div>`;
  const html =
    card('Essence of the Body', 'Upgrades a <a>Magic</a> item to a <a>Rare</a> item, adding a guaranteed modifier', [
      'Amulet, Boots, Gloves or Ring: <span class=\'mod-value\'>+(70<span class="ndash">—</span>84)</span> to maximum Life',
    ]) + card('Perfect Essence of the Body', 'Removes a random modifier and augments a <a>Rare</a> item with a new guaranteed modifier', ['Body Armour: (8<span class="ndash">—</span>10)% increased maximum Life']);
  it('lê nome, regra e todos os efeitos (inclusive o último)', () => {
    const p = parseEssencePage(html);
    expect(p).toHaveLength(2);
    expect(p[0].effects[0]).toEqual({ category: 'Amulet, Boots, Gloves or Ring', text: '+(70-84) to maximum Life' });
    expect(p[1].effects).toHaveLength(1);
  });
  it('traduz categorias e intervalos', () => {
    expect(categoryClasses('Belt, Body Armour, Helmet or Shield').classes).toEqual(['Belt', 'Body Armour', 'Helmet', 'Shield', 'Buckler']);
    expect(categoryClasses('Jewellery').classes).toEqual(['Amulet', 'Ring']);
    expect(textRanges('Adds (4-6) to (7-11) Physical Damage')).toEqual([[4, 6], [7, 11]]);
  });
  it('liga o efeito ao mod do jogo pelo texto e intervalo', () => {
    const rawMods = {
      IncreasedLife6: { domain: 'item', generation_type: 'prefix', text: '+(70-84) to maximum Life', stats: [{ id: 'l', min: 70, max: 84 }], spawn_weights: [{ tag: 'ring', weight: 1 }] },
      IncreasedLife7: { domain: 'item', generation_type: 'prefix', text: '+(85-99) to maximum Life', stats: [{ id: 'l', min: 85, max: 99 }], spawn_weights: [{ tag: 'ring', weight: 1 }] },
      EssenceLifePct: { domain: 'item', generation_type: 'prefix', text: '(8-10)% increased maximum Life', stats: [{ id: 'p', min: 8, max: 10 }], spawn_weights: [{ tag: 'default', weight: 0 }] },
    };
    const bases = [{ itemClass: 'Ring', tags: ['ring', 'default'] }, { itemClass: 'Body Armour', tags: ['body_armour', 'default'] }];
    const { essences, usedModIds } = linkEssences(parseEssencePage(html), rawMods, bases, (s: string) => s);
    expect(essences[0].mode).toBe('magicToRare');
    expect(essences[0].effects[0].modIds).toEqual(['IncreasedLife6']);
    expect(essences[0].effects[0].itemClasses).toEqual(['Ring']);
    expect(essences[1].mode).toBe('rareReplace');
    expect(essences[1].tier).toBe('perfect');
    expect(essences[1].effects[0].modIds).toEqual(['EssenceLifePct']);
    expect([...usedModIds].sort()).toEqual(['EssenceLifePct', 'IncreasedLife6']);
  });
});

describe('importador RePoE', () => {
  const ds = buildDataset(raw, { gameVersion: '9.9.9', importedAt: '2026-10-20T00:00:00Z' });
  it('filtra bases e mods relevantes', () => {
    expect(ds.bases.map((b: any) => b.name)).toEqual(['Iron Ring']);
    expect(ds.mods.map((m: any) => m.id)).toEqual(['IncreasedLife1']);
    expect(ds.implicits.RingImplicit.text).toBe('+5 to maximum Life');
  });
  it('limpa marcação de palavras-chave e registra versão e ausência de pesos', () => {
    expect(ds.mods[0].text).toBe('+(10-19) to maximum Life');
    expect(cleanText('[ContainsIrradiated|Irradiated] map')).toBe('Irradiated map');
    expect(ds.meta.gameVersion).toBe('9.9.9');
    expect(ds.meta.importedAt).toBe('2026-10-20T00:00:00Z');
    expect(ds.meta.weightsAvailable).toBe(false);
    expect(ds.stats).toHaveLength(1);
    expect(ds.stats[0].langs.English[0].string).toBe('{0} to maximum Life');
  });
  it('marca classes não lançadas e remove bases não obtíveis', () => {
    const r = buildDataset(
      {
        ...raw,
        bases: {
          ...raw.bases,
          'Metadata/Items/Daggers/D1': { domain: 'item', item_class: 'Dagger', name: 'Glass Shank', release_state: 'released', tags: ['dagger', 'default'], drop_level: 1, implicits: [] },
          'Metadata/Items/Swords/Energy': { domain: 'item', item_class: 'One Hand Sword', name: 'Energy Blade', release_state: 'released', tags: ['not_for_sale', 'sword'], drop_level: 1, implicits: [] },
          'Metadata/Items/Rings/FourRingBase': { domain: 'item', item_class: 'Ring', name: 'Ring', release_state: 'released', tags: ['ring', 'default'], drop_level: 1, implicits: [] },
        },
      },
      { release: { unreleasedClasses: ['Dagger'], excludedTags: ['not_for_sale'] } },
    );
    const names = r.bases.map((b: any) => b.name);
    expect(names).not.toContain('Energy Blade');
    expect(names).not.toContain('Ring');
    expect(r.bases.find((b: any) => b.name === 'Glass Shank').inGame).toBe(false);
    expect(r.bases.find((b: any) => b.name === 'Iron Ring').inGame).toBe(true);
    expect(r.meta.release.unreleasedClasses).toEqual(['Dagger']);
  });
  it('dataset publicado: adagas ficam marcadas como não lançadas', () => {
    const bases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/poe2/bases.json'), 'utf8'));
    expect(bases.filter((b: any) => b.itemClass === 'Dagger').every((b: any) => b.inGame === false)).toBe(true);
    expect(bases.filter((b: any) => b.itemClass === 'Ring').every((b: any) => b.inGame !== false)).toBe(true);
  });
  it('o dataset publicado tem metadados de versão e fonte', () => {
    const meta = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/poe2/meta.json'), 'utf8'));
    expect(meta.gameVersion).toMatch(/\d+\.\d+/);
    expect(meta.sourceUrl).toContain('repoe-fork');
    expect(meta.weightsAvailable).toBe(false);
    expect(meta.counts.mods).toBeGreaterThan(500);
  });
});
