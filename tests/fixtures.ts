// Dataset sintético com pesos conhecidos para testes com resultados verificáveis à mão.
import type { Dataset, ModDef } from '../src/data/types';
import { DEFAULT_RULES, type EssenceDef } from '../src/data/rules';
import { type WeightSettings, createContext } from '../src/engine/context';

function mod(id: string, gen: 'prefix' | 'suffix', type: string, level: number, stat: string, min: number, max: number, spawn: [string, number][] = [['ring', 1], ['default', 0]], groups = [type]): ModDef {
  return { id, name: id, gen, type, groups, level, spawn, stats: [{ id: stat, min, max }], text: `+(${min}-${max}) ${stat}`, tags: [], essenceOnly: false };
}

export const MODS: ModDef[] = [
  mod('Life1', 'prefix', 'Life', 1, 'life', 10, 19),
  mod('Life2', 'prefix', 'Life', 10, 'life', 20, 29),
  mod('Life3', 'prefix', 'Life', 30, 'life', 30, 39),
  mod('Mana1', 'prefix', 'Mana', 1, 'mana', 10, 19),
  mod('Mana2', 'prefix', 'Mana', 20, 'mana', 20, 29),
  mod('LifeMana1', 'prefix', 'LifeMana', 5, 'life', 5, 9, [['ring', 1], ['default', 0]], ['Life']),
  mod('Fire1', 'suffix', 'Fire', 1, 'fire_res', 6, 10),
  mod('Fire2', 'suffix', 'Fire', 20, 'fire_res', 11, 20),
  mod('Fire3', 'suffix', 'Fire', 40, 'fire_res', 21, 30),
  mod('Cold1', 'suffix', 'Cold', 1, 'cold_res', 6, 10),
  mod('Cold2', 'suffix', 'Cold', 20, 'cold_res', 11, 20),
  mod('Str1', 'suffix', 'Str', 1, 'str', 5, 8),
  mod('Move1', 'prefix', 'Move', 1, 'move', 10, 10, [['boots', 1], ['default', 0]]),
];

export const DATA: Dataset = {
  meta: {
    schema: 1,
    game: 'Path of Exile 2',
    gameVersion: 'fixture',
    source: 'fixture',
    sourceUrl: '',
    importedAt: '2026-01-01T00:00:00Z',
    hashes: {},
    counts: {},
    weightsAvailable: false,
    notes: [],
  },
  bases: [
    { id: 'Ring', name: 'Iron Ring', itemClass: 'Ring', tags: ['ring', 'default'], dropLevel: 1, implicits: [], requirements: null, properties: {} },
    { id: 'Dusk', name: 'Dusk Ring', itemClass: 'Ring', tags: ['ring', 'default'], dropLevel: 1, implicits: ['ImpPS'], requirements: null, properties: {} },
    { id: 'Boots', name: 'Leather Boots', itemClass: 'Boots', tags: ['boots', 'armour', 'default'], dropLevel: 1, implicits: [], requirements: null, properties: {} },
  ],
  mods: MODS,
  implicits: { ImpPS: { id: 'ImpPS', text: '+1 Prefix Modifier allowed', stats: [{ id: 'local_maximum_prefixes_allowed_+', min: 1, max: 1 }, { id: 'local_maximum_suffixes_allowed_+', min: -1, max: -1 }] } },
  stats: [
    { ids: ['life'], langs: { English: [{ cond: [{}], format: ['+#'], handlers: [[]], string: '{0} to maximum Life' }] } },
    {
      ids: ['fire_res'],
      langs: {
        English: [
          { cond: [{ min: 1 }], format: ['+#'], handlers: [[]], string: '{0}% to Fire Resistance' },
          { cond: [{ max: -1 }], format: ['#'], handlers: [['negate']], string: '{0}% reduced Fire Resistance' },
        ],
      },
    },
  ],
};

/** Pesos conhecidos: prefixos somam 100, sufixos somam 100. */
export const WEIGHTS: Record<string, number> = {
  Life1: 20,
  Life2: 15,
  Life3: 5,
  Mana1: 20,
  Mana2: 15,
  LifeMana1: 25,
  Fire1: 30,
  Fire2: 20,
  Fire3: 10,
  Cold1: 15,
  Cold2: 10,
  Str1: 15,
  Move1: 100,
};

export const confirmedWeights: WeightSettings = {
  table: { source: 'fixture', confidence: 'confirmed', importedAt: '2026-01-01', weights: WEIGHTS },
  hypothesis: { kind: 'none' },
};

export function ctxWith(weights: WeightSettings = confirmedWeights, essences: EssenceDef[] = []) {
  return createContext(DATA, structuredClone(DEFAULT_RULES), weights, essences);
}
