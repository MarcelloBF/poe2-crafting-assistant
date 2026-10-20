// Regras de crafting do Path of Exile 2 implementadas pelo motor.
//
// Cada regra registra a fonte e o nível de confiança. Valores "null" significam que o dado
// não foi confirmado: o motor marca qualquer cálculo que dependa dele como indisponível,
// e o jogador pode informar o valor em Configurações > Regras.
// Nada aqui foi copiado do Path of Exile 1 por suposição (ex.: não existe Orb of Alteration).

import type { EssenceData } from './types';

export type RuleConfidence = 'confirmed' | 'community' | 'unverified';

export type CurrencyKind =
  | 'transmute'
  | 'augment'
  | 'regal'
  | 'exalt'
  | 'chaos'
  | 'alchemy'
  | 'annul'
  | 'divine'
  | 'fracture'
  | 'desecrate';

export type Grade = 'normal' | 'greater' | 'perfect';

/** Tipo de osso abissal: em que itens a profanação pode ser usada. */
export type BoneSlot = 'weapon' | 'armour' | 'jewellery';

export interface CurrencyRule {
  id: string;
  kind: CurrencyKind;
  grade: Grade;
  /** Nome oficial em inglês (usado também para casar preços de mercado). */
  nameEn: string;
  namePt: string;
  /** Nível mínimo dos modificadores adicionados (versões Greater/Perfect, ossos Ancient). null = desconhecido. */
  minModLevel: number | null;
  confidence: RuleConfidence;
  source: string;
  /** Ossos abissais: categoria de item e nível máximo do item. */
  bone?: { slot: BoneSlot; maxItemLevel: number | null };
}

export type OmenEffect =
  | { kind: 'exaltSide'; side: 'prefix' | 'suffix' }
  | { kind: 'exaltDouble' }
  | { kind: 'annulSide'; side: 'prefix' | 'suffix' }
  | { kind: 'annulDouble' }
  | { kind: 'annulDesecrated' }
  | { kind: 'chaosRemoveSide'; side: 'prefix' | 'suffix' }
  | { kind: 'chaosRemoveLowest' }
  | { kind: 'regalSide'; side: 'prefix' | 'suffix' }
  | { kind: 'alchemySide'; side: 'prefix' | 'suffix' }
  | { kind: 'desecrateSide'; side: 'prefix' | 'suffix' }
  | { kind: 'desecrateLord'; lord: 'ulaman' | 'amanamu' | 'kurgal' }
  | { kind: 'desecrateReroll' };

export interface OmenRule {
  id: string;
  nameEn: string;
  namePt: string;
  appliesTo: CurrencyKind;
  effect: OmenEffect;
  /** Texto do jogo. */
  textEn: string;
  confidence: RuleConfidence;
  source: string;
}

export interface AffixLimits {
  magic: { prefix: number; suffix: number };
  rare: { prefix: number; suffix: number };
}

export interface DesecrationRules {
  /** Quantas opções aparecem ao revelar no Poço das Almas. */
  revealOptions: number;
  revealOptionsConfidence: RuleConfidence;
  /** Classes de item de cada tipo de osso. */
  slotClasses: Record<BoneSlot, string[]>;
  /** Presságios de lorde só funcionam em armas e joias (texto do jogo). */
  lordOmenSlots: BoneSlot[];
}

export interface GameRules {
  rulesVersion: string;
  affixLimits: AffixLimits;
  alchemyModCount: number;
  currencies: Record<string, CurrencyRule>;
  omens: Record<string, OmenRule>;
  desecration: DesecrationRules;
  /** Mecânicas existentes no jogo que o motor ainda não modela (exibidas na interface). */
  notModeled: { id: string; nameEn: string; namePt: string; reasonKey: string }[];
}

const SRC_WIKI = 'poe2wiki.net (comunidade) — verificar no jogo';
const SRC_GAME = 'Comportamento do jogo (PoE2 0.5)';
const SRC_ITEM = 'Texto do item no jogo (via poe2db.tw)';

function cur(
  id: string,
  kind: CurrencyKind,
  grade: Grade,
  nameEn: string,
  namePt: string,
  minModLevel: number | null,
  confidence: RuleConfidence,
  source: string,
  bone?: CurrencyRule['bone'],
): CurrencyRule {
  return { id, kind, grade, nameEn, namePt, minModLevel, confidence, source, ...(bone ? { bone } : {}) };
}

function omen(id: string, nameEn: string, namePt: string, appliesTo: CurrencyKind, effect: OmenEffect, textEn: string): OmenRule {
  return { id, nameEn, namePt, appliesTo, effect, textEn, confidence: 'confirmed', source: SRC_ITEM };
}

const BONE_PT: Record<string, string> = { Jawbone: 'Mandíbula', Rib: 'Costela', Collarbone: 'Clavícula' };
const BONE_GRADE_PT: Record<string, string> = { Gnawed: 'Roída', Preserved: 'Preservada', Ancient: 'Ancestral' };

function bones(): Record<string, CurrencyRule> {
  const out: Record<string, CurrencyRule> = {};
  const parts: [string, BoneSlot][] = [
    ['Jawbone', 'weapon'],
    ['Rib', 'armour'],
    ['Collarbone', 'jewellery'],
  ];
  for (const [part, slot] of parts) {
    for (const [g, grade] of [
      ['Gnawed', 'normal'],
      ['Preserved', 'greater'],
      ['Ancient', 'perfect'],
    ] as const) {
      const id = `${g.toLowerCase()}-${part.toLowerCase()}`;
      // Textos do jogo: Gnawed "Maximum Item Level: 64"; Ancient "Minimum Modifier Level: 40".
      out[id] = cur(id, 'desecrate', grade, `${g} ${part}`, `${BONE_PT[part]} ${BONE_GRADE_PT[g]} (${g} ${part})`, g === 'Ancient' ? 40 : 0, 'confirmed', SRC_ITEM, {
        slot,
        maxItemLevel: g === 'Gnawed' ? 64 : null,
      });
    }
  }
  return out;
}

export const DEFAULT_RULES: GameRules = {
  rulesVersion: '0.5.x',
  affixLimits: { magic: { prefix: 1, suffix: 1 }, rare: { prefix: 3, suffix: 3 } },
  alchemyModCount: 4,
  currencies: {
    transmute: cur('transmute', 'transmute', 'normal', 'Orb of Transmutation', 'Orbe de Transmutação', 0, 'confirmed', SRC_GAME),
    'greater-transmute': cur('greater-transmute', 'transmute', 'greater', 'Greater Orb of Transmutation', 'Orbe de Transmutação Maior', null, 'unverified', 'Nível mínimo não confirmado'),
    'perfect-transmute': cur('perfect-transmute', 'transmute', 'perfect', 'Perfect Orb of Transmutation', 'Orbe de Transmutação Perfeito', null, 'unverified', 'Nível mínimo não confirmado'),
    augment: cur('augment', 'augment', 'normal', 'Orb of Augmentation', 'Orbe de Aumento', 0, 'confirmed', SRC_GAME),
    'greater-augment': cur('greater-augment', 'augment', 'greater', 'Greater Orb of Augmentation', 'Orbe de Aumento Maior', null, 'unverified', 'Nível mínimo não confirmado'),
    'perfect-augment': cur('perfect-augment', 'augment', 'perfect', 'Perfect Orb of Augmentation', 'Orbe de Aumento Perfeito', null, 'unverified', 'Nível mínimo não confirmado'),
    regal: cur('regal', 'regal', 'normal', 'Regal Orb', 'Orbe Régio', 0, 'confirmed', SRC_GAME),
    'greater-regal': cur('greater-regal', 'regal', 'greater', 'Greater Regal Orb', 'Orbe Régio Maior', null, 'unverified', 'Nível mínimo não confirmado'),
    'perfect-regal': cur('perfect-regal', 'regal', 'perfect', 'Perfect Regal Orb', 'Orbe Régio Perfeito', null, 'unverified', 'Nível mínimo não confirmado'),
    exalt: cur('exalt', 'exalt', 'normal', 'Exalted Orb', 'Orbe Exaltado', 0, 'confirmed', SRC_GAME),
    'greater-exalt': cur('greater-exalt', 'exalt', 'greater', 'Greater Exalted Orb', 'Orbe Exaltado Maior', 35, 'community', SRC_WIKI),
    'perfect-exalt': cur('perfect-exalt', 'exalt', 'perfect', 'Perfect Exalted Orb', 'Orbe Exaltado Perfeito', 50, 'community', SRC_WIKI),
    chaos: cur('chaos', 'chaos', 'normal', 'Chaos Orb', 'Orbe do Caos', 0, 'confirmed', SRC_GAME),
    'greater-chaos': cur('greater-chaos', 'chaos', 'greater', 'Greater Chaos Orb', 'Orbe do Caos Maior', 35, 'community', SRC_WIKI),
    'perfect-chaos': cur('perfect-chaos', 'chaos', 'perfect', 'Perfect Chaos Orb', 'Orbe do Caos Perfeito', 50, 'community', SRC_WIKI),
    alchemy: cur('alchemy', 'alchemy', 'normal', 'Orb of Alchemy', 'Orbe de Alquimia', 0, 'confirmed', SRC_GAME),
    annul: cur('annul', 'annul', 'normal', 'Orb of Annulment', 'Orbe de Anulação', 0, 'confirmed', SRC_GAME),
    divine: cur('divine', 'divine', 'normal', 'Divine Orb', 'Orbe Divino', 0, 'confirmed', SRC_GAME),
    fracture: cur('fracture', 'fracture', 'normal', 'Fracturing Orb', 'Orbe de Fratura', 0, 'community', SRC_WIKI),
    ...bones(),
  },
  omens: {
    'sinistral-exaltation': omen('sinistral-exaltation', 'Omen of Sinistral Exaltation', 'Presságio da Exaltação Sinistra', 'exalt', { kind: 'exaltSide', side: 'prefix' }, 'Your next Exalted Orb will add only prefix modifiers'),
    'dextral-exaltation': omen('dextral-exaltation', 'Omen of Dextral Exaltation', 'Presságio da Exaltação Destra', 'exalt', { kind: 'exaltSide', side: 'suffix' }, 'Your next Exalted Orb will add only suffix modifiers'),
    'greater-exaltation': omen('greater-exaltation', 'Omen of Greater Exaltation', 'Presságio da Exaltação Maior', 'exalt', { kind: 'exaltDouble' }, 'Your next Exalted Orb will add two random modifiers'),
    'sinistral-annulment': omen('sinistral-annulment', 'Omen of Sinistral Annulment', 'Presságio da Anulação Sinistra', 'annul', { kind: 'annulSide', side: 'prefix' }, 'Your next Orb of Annulment will remove only prefix modifiers'),
    'dextral-annulment': omen('dextral-annulment', 'Omen of Dextral Annulment', 'Presságio da Anulação Destra', 'annul', { kind: 'annulSide', side: 'suffix' }, 'Your next Orb of Annulment will remove only suffix modifiers'),
    'greater-annulment': omen('greater-annulment', 'Omen of Greater Annulment', 'Presságio da Anulação Maior', 'annul', { kind: 'annulDouble' }, 'Your next Orb of Annulment will remove two modifiers'),
    light: omen('light', 'Omen of Light', 'Presságio da Luz', 'annul', { kind: 'annulDesecrated' }, 'Your next Orb of Annulment will remove only Desecrated modifiers'),
    whittling: omen('whittling', 'Omen of Whittling', 'Presságio do Desbaste', 'chaos', { kind: 'chaosRemoveLowest' }, 'Your next Chaos Orb will remove the lowest level modifier'),
    'sinistral-erasure': omen('sinistral-erasure', 'Omen of Sinistral Erasure', 'Presságio do Apagamento Sinistro', 'chaos', { kind: 'chaosRemoveSide', side: 'prefix' }, 'Your next Chaos Orb will remove only prefix modifiers'),
    'dextral-erasure': omen('dextral-erasure', 'Omen of Dextral Erasure', 'Presságio do Apagamento Destro', 'chaos', { kind: 'chaosRemoveSide', side: 'suffix' }, 'Your next Chaos Orb will remove only suffix modifiers'),
    'sinistral-coronation': omen('sinistral-coronation', 'Omen of Sinistral Coronation', 'Presságio da Coroação Sinistra', 'regal', { kind: 'regalSide', side: 'prefix' }, 'Your next Regal Orb will add only prefix modifiers'),
    'dextral-coronation': omen('dextral-coronation', 'Omen of Dextral Coronation', 'Presságio da Coroação Destra', 'regal', { kind: 'regalSide', side: 'suffix' }, 'Your next Regal Orb will add only suffix modifiers'),
    'sinistral-alchemy': omen('sinistral-alchemy', 'Omen of Sinistral Alchemy', 'Presságio da Alquimia Sinistra', 'alchemy', { kind: 'alchemySide', side: 'prefix' }, 'Your next Orb of Alchemy will result in the maximum number of prefix modifiers'),
    'dextral-alchemy': omen('dextral-alchemy', 'Omen of Dextral Alchemy', 'Presságio da Alquimia Destra', 'alchemy', { kind: 'alchemySide', side: 'suffix' }, 'Your next Orb of Alchemy will result in the maximum number of suffix modifiers'),
    'sinistral-necromancy': omen('sinistral-necromancy', 'Omen of Sinistral Necromancy', 'Presságio da Necromancia Sinistra', 'desecrate', { kind: 'desecrateSide', side: 'prefix' }, 'Your next Desecration attempt will add only prefix modifiers'),
    'dextral-necromancy': omen('dextral-necromancy', 'Omen of Dextral Necromancy', 'Presságio da Necromancia Destra', 'desecrate', { kind: 'desecrateSide', side: 'suffix' }, 'Your next Desecration attempt will add only suffix modifiers'),
    sovereign: omen('sovereign', 'Omen of the Sovereign', 'Presságio do Soberano (Ulaman)', 'desecrate', { kind: 'desecrateLord', lord: 'ulaman' }, 'Your next Weapon or Jewellery Desecration attempt will guarantee a random Ulaman modifier'),
    liege: omen('liege', 'Omen of the Liege', 'Presságio do Suserano (Amanamu)', 'desecrate', { kind: 'desecrateLord', lord: 'amanamu' }, 'Your next Weapon or Jewellery Desecration attempt will guarantee a random Amanamu modifier'),
    blackblooded: omen('blackblooded', 'Omen of the Blackblooded', 'Presságio do Sangue-Negro (Kurgal)', 'desecrate', { kind: 'desecrateLord', lord: 'kurgal' }, 'Your next Weapon or Jewellery Desecration attempt will guarantee a random Kurgal modifier'),
    'abyssal-echoes': omen('abyssal-echoes', 'Omen of Abyssal Echoes', 'Presságio dos Ecos Abissais', 'desecrate', { kind: 'desecrateReroll' }, 'The next time you reveal Desecrated modifiers you can reroll the options once'),
  },
  desecration: {
    revealOptions: 3,
    revealOptionsConfidence: 'community',
    slotClasses: {
      weapon: ['One Hand Mace', 'Two Hand Mace', 'Spear', 'Warstaff', 'Bow', 'Crossbow', 'Wand', 'Staff', 'Sceptre', 'Talisman', 'Quiver', 'One Hand Sword', 'Two Hand Sword', 'One Hand Axe', 'Two Hand Axe', 'Dagger', 'Claw', 'Flail'],
      armour: ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield', 'Buckler', 'Focus'],
      jewellery: ['Amulet', 'Ring', 'Belt'],
    },
    lordOmenSlots: ['weapon', 'jewellery'],
  },
  notModeled: [
    { id: 'putrefaction', nameEn: 'Omen of Putrefaction', namePt: 'Presságio da Putrefação', reasonKey: 'notModeled.putrefaction' },
    { id: 'abyssMark', nameEn: 'Essence of the Abyss (Mark of the Abyssal Lord)', namePt: 'Essência do Abismo (Marca do Lorde Abissal)', reasonKey: 'notModeled.abyssMark' },
    { id: 'catalysts', nameEn: 'Catalysts / Omen of Catalysing Exaltation', namePt: 'Catalisadores / Presságio da Exaltação Catalisadora', reasonKey: 'notModeled.catalysts' },
    { id: 'homogenising', nameEn: 'Omen of Homogenising Exaltation/Coronation', namePt: 'Presságios Homogeneizadores', reasonKey: 'notModeled.homogenising' },
    { id: 'specialEssences', nameEn: 'Essences of Delirium / Insanity', namePt: 'Essências de Delírio / Insanidade', reasonKey: 'notModeled.specialEssences' },
    { id: 'vaal', nameEn: 'Vaal Orb (corruption)', namePt: 'Orbe Vaal (corrupção)', reasonKey: 'notModeled.vaal' },
    { id: 'runes', nameEn: 'Runes / Soul Cores / Verisium', namePt: 'Runas / Núcleos de Alma / Verisium', reasonKey: 'notModeled.runes' },
    { id: 'chance', nameEn: 'Orb of Chance', namePt: 'Orbe do Acaso', reasonKey: 'notModeled.chance' },
  ],
};

/** Essência (do dataset ou cadastrada pelo jogador). */
export type EssenceDef = EssenceData;

export function currenciesOfKind(rules: GameRules, kind: CurrencyKind): CurrencyRule[] {
  return Object.values(rules.currencies).filter((c) => c.kind === kind);
}

export function currencyFor(rules: GameRules, kind: CurrencyKind, grade: Grade): CurrencyRule | undefined {
  return Object.values(rules.currencies).find((c) => c.kind === kind && c.grade === grade);
}

export function boneSlotOf(rules: GameRules, itemClass: string): BoneSlot | null {
  for (const [slot, classes] of Object.entries(rules.desecration.slotClasses)) if (classes.includes(itemClass)) return slot as BoneSlot;
  return null;
}

/** Osso adequado à classe do item e ao grau desejado. */
export function boneFor(rules: GameRules, itemClass: string, grade: Grade): CurrencyRule | undefined {
  const slot = boneSlotOf(rules, itemClass);
  return Object.values(rules.currencies).find((c) => c.kind === 'desecrate' && c.grade === grade && c.bone?.slot === slot);
}
