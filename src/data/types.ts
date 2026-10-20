// Tipos do dataset gerado por scripts/import-repoe.mjs.

export type Gen = 'prefix' | 'suffix';

export interface StatRange {
  id: string;
  min: number;
  max: number;
}

export interface ModDef {
  id: string;
  /** Nome do afixo no jogo (ex.: "Hale", "of the Lynx"). */
  name: string;
  gen: Gen;
  /** Tipo do modificador (identifica a "família" de tiers). */
  type: string;
  /** Grupos de geração: dois modificadores do mesmo grupo não coexistem. */
  groups: string[];
  /** Nível de item mínimo para o modificador gerar. */
  level: number;
  /** Flags de geração do cliente [tag, 0|1]. A primeira tag presente na base decide. */
  spawn: [string, number][];
  stats: StatRange[];
  /** Texto em inglês vindo dos dados do jogo. */
  text: string;
  tags: string[];
  essenceOnly: boolean;
  /** Mod profanado (Abyss): só aparece revelando um mod profanado no Poço das Almas. */
  desecrated?: boolean;
  /** Lorde abissal do mod exclusivo (null = profanado genérico). */
  lord?: 'ulaman' | 'amanamu' | 'kurgal' | null;
}

export interface EssenceEffect {
  category: string;
  text: string;
  itemClasses: string[];
  /** Mods possíveis do efeito (vários = o jogo sorteia um). */
  modIds: string[];
}

export interface EssenceData {
  id: string;
  nameEn: string;
  tier: 'lesser' | 'normal' | 'greater' | 'perfect' | 'special';
  /** magicToRare: Mágico → Raro + mod garantido; rareReplace: remove 1 mod aleatório e adiciona o garantido. */
  mode: 'magicToRare' | 'rareReplace' | 'normalToMagic' | 'unknown';
  effects: EssenceEffect[];
  /** Origem do registro (dataset ou cadastro do jogador). */
  source?: string;
}

export interface BaseDef {
  id: string;
  name: string;
  /** false = classe existe no cliente mas ainda não foi lançada (lista curada em data-config). */
  inGame?: boolean;
  itemClass: string;
  tags: string[];
  dropLevel: number;
  implicits: string[];
  requirements: { level?: number; strength?: number; dexterity?: number; intelligence?: number } | null;
  properties: Record<string, unknown>;
}

export interface ImplicitDef {
  id: string;
  text: string;
  stats: StatRange[];
}

export interface TranslationVariant {
  cond: { min?: number; max?: number; negated?: boolean }[];
  format: string[];
  handlers: string[][];
  string: string;
}

export interface StatTranslation {
  ids: string[];
  langs: Record<string, TranslationVariant[]>;
  /** Ids de stat do site de trade por tipo (explicit, desecrated, implicit…). */
  trade?: Record<string, string>;
}

export interface DatasetMeta {
  schema: number;
  game: string;
  gameVersion: string;
  source: string;
  sourceUrl: string;
  importedAt: string;
  hashes: Record<string, string>;
  counts: Record<string, number>;
  weightsAvailable: boolean;
  release?: { unreleasedClasses: string[]; reviewedAt: string | null; source: string | null };
  essenceSource?: { name: string; url: string } | null;
  notes: string[];
}

export interface Dataset {
  meta: DatasetMeta;
  bases: BaseDef[];
  mods: ModDef[];
  implicits: Record<string, ImplicitDef>;
  stats: StatTranslation[];
  /** Tabela de essências (importada do poe2db). */
  essences?: EssenceData[];
}

/** Nível de confiança de um número apresentado ao jogador. */
export type Confidence = 'confirmed' | 'estimated' | 'unavailable';

export interface Provenance {
  confidence: Confidence;
  /** Chaves i18n das hipóteses usadas (ex.: "assume.uniformWeights"). */
  assumptions: string[];
}

export function combineProvenance(...ps: Provenance[]): Provenance {
  const order: Confidence[] = ['confirmed', 'estimated', 'unavailable'];
  let worst = 0;
  const assumptions = new Set<string>();
  for (const p of ps) {
    worst = Math.max(worst, order.indexOf(p.confidence));
    p.assumptions.forEach((a) => assumptions.add(a));
  }
  return { confidence: order[worst], assumptions: [...assumptions] };
}
