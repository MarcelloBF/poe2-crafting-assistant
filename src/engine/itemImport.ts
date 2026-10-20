// Leitura de um item a partir de texto: Ctrl+C / Ctrl+Alt+C do jogo, ou texto reconhecido (OCR) de uma imagem.
// O reconhecimento é feito comparando cada linha com os textos dos modificadores do jogo (números → "#")
// e usando os valores/intervalos para descobrir o tier. Nada é presumido: linhas sem correspondência
// e mods impossíveis na base são reportados.

import type { BaseDef, Gen, ModDef } from '../data/types';
import { type CraftContext, familyKey, getBasePool, spawnFlag } from './context';
import type { ItemState, Rarity } from './item';
import type { Requirement, TargetSpec } from './target';

/**
 * ok: mod e valor possíveis na base • valueNotOnBase: a família existe na base, mas esse valor/tier não
 * notOnBase: o mod não gera nesta base • unknown: não corresponde a nenhum afixo do jogo.
 */
export type LineStatus = 'ok' | 'valueNotOnBase' | 'notOnBase' | 'unknown' | 'implicit' | 'header';

export interface ModMatch {
  mod: ModDef;
  onBase: boolean;
  /** Tier na base (1 = melhor), se o mod gera na base. */
  tier?: number;
  /** O valor/intervalo lido bate exatamente com este tier. */
  exact: boolean;
}

export interface ParsedLine {
  raw: string;
  /** Texto genérico usado na comparação. */
  key: string;
  status: LineStatus;
  /** Lado indicado no texto (ex.: rótulos "P1"/"S3" ou "Prefix Modifier"), se houver. */
  sideHint?: Gen;
  values: number[];
  isRange: boolean;
  /** Candidatos, melhor primeiro. */
  matches: ModMatch[];
  /** Família escolhida (prefix:Tipo), quando reconhecida. */
  family?: string;
}

export interface ImportResult {
  base: BaseDef | null;
  baseCandidates: BaseDef[];
  rarity: Rarity | null;
  ilvl: number | null;
  lines: ParsedLine[];
  /** Categorias em que TODOS os mods reconhecidos podem gerar (sugestão quando a base não comporta). */
  suggestedClasses: string[];
  warnings: string[];
}

const NUM = /[+-]?\d+(?:[.,]\d+)?/g;

/** Converte um texto de mod em chave genérica: minúsculas, números/intervalos → "#", sem "+" e espaços extras. */
export function genericKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\(\s*[+-]?\d+(?:[.,]\d+)?\s*[-–—]\s*[+-]?\d+(?:[.,]\d+)?\s*\)/g, '#')
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, '#')
    .replace(/\+\s*#/g, '#')
    .replace(/#\s*#/g, '#')
    .replace(/[^a-z#%\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai valores: "(13-17)%" → [13,17] intervalo; "15%" → [15]; "30(25-35)" (Ctrl+Alt+C) → [30]. */
export function extractValues(s: string): { values: number[]; isRange: boolean } {
  const advanced = s.replace(/(\d+(?:\.\d+)?)\(\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\)/g, '$1');
  const range = advanced.match(/\(\s*([+-]?\d+(?:[.,]\d+)?)\s*[-–—]\s*([+-]?\d+(?:[.,]\d+)?)\s*\)/);
  if (range) return { values: [Number(range[1].replace(',', '.')), Number(range[2].replace(',', '.'))], isRange: true };
  return { values: (advanced.match(NUM) ?? []).map((x) => Math.abs(Number(x.replace(',', '.')))), isRange: false };
}

interface ModIndex {
  byLine: Map<string, ModDef[]>;
  lineKeys: Map<string, string[]>;
}

const indexCache = new WeakMap<object, ModIndex>();
function modIndex(ctx: CraftContext): ModIndex {
  let idx = indexCache.get(ctx.data);
  if (!idx) {
    idx = { byLine: new Map(), lineKeys: new Map() };
    for (const m of ctx.data.mods) {
      const keys = m.text.split('\n').map(genericKey).filter(Boolean);
      idx.lineKeys.set(m.id, keys);
      for (const k of keys) {
        if (!idx.byLine.has(k)) idx.byLine.set(k, []);
        idx.byLine.get(k)!.push(m);
      }
    }
    indexCache.set(ctx.data, idx);
  }
  return idx;
}

function cleanLine(raw: string): { text: string; sideHint?: Gen; implicitTag: boolean } {
  let text = raw.trim();
  let sideHint: Gen | undefined;
  const tierLabel = text.match(/\s+([PS])\s*(\d{1,2})\s*$/);
  if (tierLabel) {
    sideHint = tierLabel[1] === 'P' ? 'prefix' : 'suffix';
    text = text.slice(0, tierLabel.index).trim();
  }
  const implicitTag = /\((implicit|enchant)\)\s*$/i.test(text);
  text = text.replace(/\((implicit|crafted|fractured|desecrated|rune|augmented|enchant)\)\s*$/i, '').trim();
  return { text, sideHint, implicitTag };
}

/** Quanto o valor lido combina com o mod: 2 = exato, 1 = dentro do intervalo, 0 = não combina. */
function valueFit(mod: ModDef, values: number[], isRange: boolean): number {
  const s = mod.stats[0];
  if (!s || !values.length) return 1;
  const lo = Math.min(Math.abs(s.min), Math.abs(s.max));
  const hi = Math.max(Math.abs(s.min), Math.abs(s.max));
  if (isRange) return values[0] === lo && values[1] === hi ? 2 : 0;
  const v = values[0];
  return v >= lo && v <= hi ? 2 : 0;
}

function findBase(ctx: CraftContext, lines: string[]): { base: BaseDef | null; candidates: BaseDef[] } {
  const bases = [...ctx.data.bases].sort((a, b) => b.name.length - a.name.length);
  const candidates: BaseDef[] = [];
  for (const l of lines) {
    const ll = l.toLowerCase().trim();
    for (const b of bases) {
      const n = b.name.toLowerCase();
      if (ll === n || ll.endsWith(' ' + n) || ll.startsWith(n + ' ')) {
        if (!candidates.includes(b)) candidates.push(b);
      }
    }
    if (candidates.length) break;
  }
  const exact = candidates.find((b) => lines.some((l) => l.trim().toLowerCase() === b.name.toLowerCase()));
  const preferred = (exact ? [exact] : candidates).sort((a, b) => Number(b.inGame !== false) - Number(a.inGame !== false));
  return { base: preferred[0] ?? null, candidates };
}

/**
 * Lê o texto do item. Linhas quebradas pelo OCR são reunidas quando a junção corresponde a um mod.
 * `baseOverride` permite ao jogador corrigir a base detectada.
 */
export function parseItemText(ctx: CraftContext, text: string, baseOverride?: string): ImportResult {
  const warnings: string[] = [];
  const rawLines = text
    .split(/\r?\n/)
    // Marcadores de lista e lixo de OCR no início da linha ("»", "|", "•"…).
    .map((l) => l.replace(/[•·●▪]/g, '').replace(/^[^\w(+\-]+/, '').trim())
    .filter((l) => l && !/^-{3,}$/.test(l))
    // Ruído de OCR (ícones, bordas): linhas sem nenhuma palavra de 3+ letras.
    .filter((l) => /[A-Za-z]{3,}/.test(l));
  const found = findBase(ctx, rawLines);
  const base = (baseOverride && ctx.basesById.get(baseOverride)) || found.base;
  let rarity: Rarity | null = null;
  let ilvl: number | null = null;
  const idx = modIndex(ctx);
  const implicitKeys = new Set((base?.implicits ?? []).flatMap((i) => (ctx.data.implicits[i]?.text ?? '').split('\n').map(genericKey)));
  const pool = base ? getBasePool(ctx, base.id) : null;

  const lines: ParsedLine[] = [];
  let pendingAdvanced: { side?: Gen; name?: string } | null = null;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const header = (status: LineStatus = 'header') => lines.push({ raw, key: '', status, values: [], isRange: false, matches: [] });
    const r = raw.match(/^rarity:\s*(\w+)/i);
    if (r) {
      const v = r[1].toLowerCase();
      rarity = v === 'magic' ? 'magic' : v === 'rare' ? 'rare' : v === 'normal' ? 'normal' : null;
      header();
      continue;
    }
    const il = raw.match(/^item level:\s*(\d+)/i);
    if (il) {
      ilvl = Number(il[1]);
      header();
      continue;
    }
    // Ctrl+Alt+C: { Prefix Modifier "Virile" (Tier: 1) — Life }
    const adv = raw.match(/^\{\s*(Prefix|Suffix|Implicit)?[^"]*"?([^"]*)"?/i);
    if (raw.startsWith('{')) {
      pendingAdvanced = { side: adv?.[1]?.toLowerCase() === 'prefix' ? 'prefix' : adv?.[1]?.toLowerCase() === 'suffix' ? 'suffix' : undefined, name: adv?.[2] || undefined };
      header();
      continue;
    }
    if (/^(item class|requires|requirements|level:|str:|dex:|int:|quality|sockets|item level|stack size|corrupted|unidentified|note:)/i.test(raw) || /^requires/i.test(raw)) {
      header();
      continue;
    }
    if (base && raw.trim().toLowerCase() === base.name.toLowerCase()) {
      header();
      continue;
    }

    let { text: t, sideHint, implicitTag } = cleanLine(raw);
    let key = genericKey(t);
    let cands = idx.byLine.get(key) ?? [];
    // Rótulo antes de dois-pontos (ex.: "Body Armour: (6-15)% ...") gerado por algumas ferramentas.
    if (!cands.length && /^[A-Za-z' ]{2,30}:\s/.test(t)) {
      const rest = t.replace(/^[A-Za-z' ]{2,30}:\s*/, '');
      const k2 = genericKey(rest);
      if (idx.byLine.has(k2) || implicitKeys.has(k2)) {
        t = rest;
        key = k2;
        cands = idx.byLine.get(k2) ?? [];
      }
    }
    // OCR pode quebrar uma linha longa em duas.
    if (!cands.length && !implicitKeys.has(key) && i + 1 < rawLines.length) {
      const next = cleanLine(rawLines[i + 1]);
      const joined = genericKey(`${t} ${next.text}`);
      if (idx.byLine.has(joined) || implicitKeys.has(joined)) {
        t = `${t} ${next.text}`;
        key = joined;
        cands = idx.byLine.get(joined) ?? [];
        sideHint = sideHint ?? next.sideHint;
        i++;
      }
    }
    const { values, isRange } = extractValues(t);
    if (implicitTag || (implicitKeys.has(key) && !lines.some((l) => l.status === 'ok' || l.status === 'notOnBase'))) {
      lines.push({ raw, key, status: 'implicit', values, isRange, matches: [] });
      continue;
    }
    if (!cands.length) {
      // Linha sem número e sem correspondência: provavelmente nome do item/categoria.
      const isNamey = !/\d/.test(t) && t.split(' ').length <= 4;
      lines.push({ raw, key, status: isNamey ? 'header' : 'unknown', values, isRange, matches: [] });
      continue;
    }
    const side = pendingAdvanced?.side ?? sideHint;
    const name = pendingAdvanced?.name;
    pendingAdvanced = null;
    const matches: ModMatch[] = cands
      .map((mod) => {
        const entry = pool?.byMod.get(mod.id);
        return { mod, onBase: !!entry && spawnFlag(mod, base!) > 0, tier: entry?.tier, exact: valueFit(mod, values, isRange) === 2 };
      })
      .sort(
        (a, b) =>
          Number(b.onBase && b.exact) - Number(a.onBase && a.exact) ||
          Number(!!name && b.mod.name === name) - Number(!!name && a.mod.name === name) ||
          Number(b.exact) - Number(a.exact) ||
          Number(!side || b.mod.gen === side) - Number(!side || a.mod.gen === side) ||
          Number(b.onBase) - Number(a.onBase) ||
          b.mod.level - a.mod.level,
      );
    const best = matches[0];
    const onBaseFamily = matches.find((m) => m.onBase && (!side || m.mod.gen === side));
    const status: LineStatus = best.onBase && best.exact ? 'ok' : !values.length && best.onBase ? 'ok' : onBaseFamily ? 'valueNotOnBase' : 'notOnBase';
    const chosen = status === 'valueNotOnBase' ? onBaseFamily! : best;
    lines.push({
      raw,
      key,
      status,
      sideHint: side,
      values,
      isRange,
      matches,
      family: familyKey(chosen.mod),
    });
  }

  // Categorias que comportam todos os mods reconhecidos.
  const recognized = lines.filter((l) => l.status === 'ok' || l.status === 'notOnBase' || l.status === 'valueNotOnBase');
  const suggestedClasses: string[] = [];
  if (recognized.some((l) => l.status !== 'ok')) {
    const classes = [...new Set(ctx.data.bases.filter((b) => b.inGame !== false).map((b) => b.itemClass))];
    for (const c of classes) {
      const cb = ctx.data.bases.filter((b) => b.itemClass === c && b.inGame !== false);
      // Exige o mod com o valor lido (quando há valor) em alguma base da categoria.
      const all = recognized.every((l) => l.matches.some((m) => (m.exact || !l.values.length) && cb.some((b) => spawnFlag(m.mod, b) > 0)));
      if (all) suggestedClasses.push(c);
    }
  }
  if (!base) warnings.push('imp.noBase');
  if (lines.some((l) => l.status === 'unknown')) warnings.push('imp.unknownLines');
  if (recognized.some((l) => l.status === 'notOnBase')) warnings.push('imp.notOnBase');
  if (recognized.some((l) => l.status === 'valueNotOnBase')) warnings.push('imp.valueNotOnBase');
  return { base, baseCandidates: found.candidates, rarity, ilvl, lines, suggestedClasses, warnings };
}

/** Monta o objetivo de crafting a partir das linhas reconhecidas na base (tier lido = pior tier aceito). */
export function importToTarget(ctx: CraftContext, res: ImportResult, ilvl: number, rarity: 'magic' | 'rare'): TargetSpec | null {
  if (!res.base) return null;
  const pool = getBasePool(ctx, res.base.id);
  const reqs: Requirement[] = [];
  const seen = new Set<string>();
  for (const l of res.lines) {
    if ((l.status !== 'ok' && l.status !== 'valueNotOnBase') || !l.family || seen.has(l.family)) continue;
    const fam = pool.byFamily.get(l.family) ?? [];
    const m = l.matches.find((x) => x.onBase && familyKey(x.mod) === l.family);
    if (!m || !fam.length) continue;
    seen.add(l.family);
    // Valor lido corresponde a um tier: aceitar esse tier ou melhor. Valor acima do possível: melhor tier da base.
    // Sem valor: qualquer tier.
    const bestReachable = fam.find((e) => e.mod.level <= ilvl)?.tier ?? 1;
    const tier = l.status === 'valueNotOnBase' ? bestReachable : m.exact && m.tier ? Math.max(m.tier, bestReachable) : fam.length;
    reqs.push({ id: `imp-${reqs.length}`, family: l.family, minTier: tier, required: true, priority: 1, minValue: null });
  }
  return { baseId: res.base.id, ilvl, rarity, requirements: reqs };
}

/** Item "como está" (para continuar o crafting a partir dele), só com os mods reconhecidos na base. */
export function importToItem(res: ImportResult, ilvl: number, rarity: Rarity): ItemState | null {
  if (!res.base) return null;
  const mods = res.lines
    .filter((l) => l.status === 'ok')
    .map((l) => {
      const m = l.matches.find((x) => x.onBase)!;
      return {
        modId: m.mod.id,
        values: !l.isRange && l.values.length ? l.values.slice(0, m.mod.stats.length) : undefined,
        ...(m.mod.desecrated || /\(desecrated\)/i.test(l.raw) ? { desecrated: true } : {}),
      };
    });
  return { baseId: res.base.id, ilvl, rarity, mods };
}
