// Leitura da tabela de essências do PoE2 a partir da página pública do poe2db (https://poe2db.tw/us/Essence),
// que é gerada dos arquivos do jogo. Cada efeito ("Categoria: texto do mod") é ligado ao id do modificador
// do jogo comparando texto genérico e intervalos de valores. Efeitos sem correspondência ficam com modId = null.

export const POE2DB_ESSENCE_URL = 'https://poe2db.tw/us/Essence';

const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield', 'Buckler', 'Focus'];
const JEWELLERY = ['Amulet', 'Ring'];
const ONE_MELEE = ['One Hand Mace', 'Spear', 'One Hand Sword', 'One Hand Axe', 'Dagger', 'Claw', 'Flail'];
const TWO_MELEE = ['Two Hand Mace', 'Warstaff', 'Two Hand Sword', 'Two Hand Axe'];
const CASTER = ['Wand', 'Staff', 'Sceptre'];
const RANGED = ['Bow', 'Crossbow'];

/** Termos de categoria usados nos textos de essência → classes de item. */
export const CATEGORY_CLASSES = {
  armour: ARMOUR,
  jewellery: JEWELLERY,
  belt: ['Belt'],
  equipment: [...ARMOUR, ...JEWELLERY, 'Belt', ...ONE_MELEE, ...TWO_MELEE, ...CASTER, ...RANGED, 'Talisman', 'Quiver'],
  weapons: [...ONE_MELEE, ...TWO_MELEE, ...CASTER, ...RANGED, 'Talisman'],
  'one handed melee weapon': ONE_MELEE,
  'two handed melee weapon': TWO_MELEE,
  'melee weapon': [...ONE_MELEE, ...TWO_MELEE],
  'martial weapon': [...ONE_MELEE, ...TWO_MELEE, ...RANGED, 'Talisman'],
  'caster weapon': ['Wand', 'Staff'],
  bow: ['Bow'],
  crossbow: ['Crossbow'],
  focus: ['Focus'],
  wand: ['Wand'],
  staff: ['Staff'],
  sceptre: ['Sceptre'],
  quiver: ['Quiver'],
  shield: ['Shield', 'Buckler'],
  helmet: ['Helmet'],
  'body armour': ['Body Armour'],
  gloves: ['Gloves'],
  boots: ['Boots'],
  ring: ['Ring'],
  amulet: ['Amulet'],
  mace: ['One Hand Mace', 'Two Hand Mace'],
  quarterstaff: ['Warstaff'],
  spear: ['Spear'],
  talisman: ['Talisman'],
};

export function categoryClasses(cat) {
  const parts = cat
    .toLowerCase()
    .split(/,\s*|\s+or\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set();
  const unknown = [];
  for (const p of parts) {
    const c = CATEGORY_CLASSES[p];
    if (c) c.forEach((x) => out.add(x));
    else unknown.push(p);
  }
  return { classes: [...out], unknown };
}

const decode = (s) =>
  s
    .replace(/<span class="ndash">[^<]*<\/span>/g, '-')
    .replace(/<br\s*\/?>/g, ' / ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Extrai {nome, regra, efeitos[]} dos cards da página. A página repete cards; fica a versão mais completa. */
export function parseEssencePage(html) {
  const re = /<a class="item_currency[^"]*"[^>]*href="([^"]+)"><img[^>]*height="16"[^>]*\/>([^<]+)<\/a><div>([\s\S]*?)<\/div><\/div><\/div><\/div>/g;
  const byName = new Map();
  let m;
  while ((m = re.exec(html))) {
    const lines = [...(m[3] + '</div>').matchAll(/<div class="explicitMod">([\s\S]*?)<\/div>/g)].map((x) => decode(x[1]));
    const name = decode(m[2]);
    const prev = byName.get(name);
    if (!prev || lines.length > prev.length) byName.set(name, lines);
  }
  const out = [];
  for (const [name, lines] of byName) {
    if (!/Essence/i.test(name) || !lines.length) continue;
    const rule = lines[0];
    const effects = lines.slice(1).map((l) => {
      const i = l.indexOf(':');
      return { category: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    });
    out.push({ name, rule, effects });
  }
  return out;
}

export function genericKey(s) {
  return s
    .toLowerCase()
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\(\s*[+-]?\d+(?:\.\d+)?\s*[-–—]\s*[+-]?\d+(?:\.\d+)?\s*\)/g, '#')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\+\s*#/g, '#')
    .replace(/[^a-z#%\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Intervalos de valores na ordem do texto: "(4-6) to (7-11)" → [[4,6],[7,11]]; "15%" → [[15,15]]. */
export function textRanges(s) {
  const out = [];
  const re = /\(\s*([+-]?\d+(?:\.\d+)?)\s*[-–—]\s*([+-]?\d+(?:\.\d+)?)\s*\)|([+-]?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) out.push([Math.abs(Number(m[1])), Math.abs(Number(m[2]))]);
    else out.push([Math.abs(Number(m[3])), Math.abs(Number(m[3]))]);
  }
  return out.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
}

function sameRanges(a, b) {
  if (a.length !== b.length) return false;
  const k = (r) => r.map(([x, y]) => `${x}-${y}`).sort().join('|');
  return k(a) === k(b);
}

/**
 * Liga os efeitos às ids de mods do jogo.
 * rawMods: export bruto (mods.json do RePoE). bases: bases já filtradas do dataset.
 * Retorna { essences, usedModIds } — usedModIds inclui mods exclusivos de essência a importar.
 */
export function linkEssences(parsed, rawMods, bases, cleanText) {
  const byKey = new Map();
  for (const [id, m] of Object.entries(rawMods)) {
    if (m.domain !== 'item' || (m.generation_type !== 'prefix' && m.generation_type !== 'suffix')) continue;
    const text = cleanText(m.text || '');
    if (!text) continue;
    const key = genericKey(text.replace(/\n/g, ' '));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id, m, text });
  }
  const spawnsOn = (m, cls) =>
    bases.some((b) => b.itemClass === cls && (() => {
      for (const w of m.spawn_weights) if (b.tags.includes(w.tag)) return w.weight > 0;
      return false;
    })());
  const usedModIds = new Set();
  const essences = parsed.map((e) => {
    const tier = /^Lesser /.test(e.name) ? 'lesser' : /^Greater /.test(e.name) ? 'greater' : /^Perfect /.test(e.name) ? 'perfect' : /Essence of (Insanity|Horror|Delirium|Hysteria|the Abyss)/.test(e.name) ? 'special' : 'normal';
    const mode = /^Removes a random modifier/i.test(e.rule) ? 'rareReplace' : /^Upgrades a Magic item to a Rare/i.test(e.rule) ? 'magicToRare' : 'unknown';
    const modRanges = (m, scale) =>
      m.stats
        .map((s) => [Math.min(Math.abs(s.min), Math.abs(s.max)) / scale, Math.max(Math.abs(s.min), Math.abs(s.max)) / scale])
        .filter(([a, b]) => a || b);
    const findMod = (text, classes) => {
      const key = genericKey(text);
      const ranges = textRanges(text).filter(([a, b]) => a || b);
      // Valores decimais (ex.: crítico 1.51-2.1%) são guardados no jogo multiplicados por 100 ou 10.
      const cands = (byKey.get(key) ?? []).filter((c) => [1, 10, 100].some((sc) => sameRanges(modRanges(c.m, sc), ranges)));
      // Prefere o mod que gera nas classes da categoria; senão, um mod que não gera em nada (exclusivo de essência).
      return cands.find((c) => classes.some((cls) => spawnsOn(c.m, cls))) ?? cands.find((c) => !c.m.spawn_weights.some((w) => w.weight > 0)) ?? null;
    };
    const effects = e.effects.map((ef) => {
      const { classes, unknown } = categoryClasses(ef.category);
      let alts = [];
      const best = findMod(ef.text, classes);
      if (best) alts = [best];
      else {
        // "+(9-12) to Strength, Dexterity or Intelligence": um dos mods, sorteado.
        const or = ef.text.match(/^(.*?\bto )(\w+), (\w+) or (\w+)$/) ?? ef.text.match(/^(.*?increased )(\w+), (\w+) or (\w+)$/);
        if (or) alts = [or[2], or[3], or[4]].map((w) => findMod(or[1] + w, classes)).filter(Boolean);
        if (alts.length !== 3) alts = [];
      }
      let effClasses = classes;
      const spawnable = alts.filter((a) => a.m.spawn_weights.some((w) => w.weight > 0));
      if (spawnable.length) effClasses = classes.filter((cls) => spawnable.some((a) => spawnsOn(a.m, cls)));
      alts.forEach((a) => usedModIds.add(a.id));
      return {
        category: ef.category,
        text: ef.text,
        itemClasses: effClasses,
        modId: alts.length === 1 ? alts[0].id : null,
        // Vários mods possíveis: o jogo sorteia um deles (hipótese: chance igual).
        modIds: alts.map((a) => a.id),
        unknownCategoryTerms: unknown,
      };
    });
    return { id: e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), nameEn: e.name, tier, mode, effects };
  });
  return { essences, usedModIds };
}
