import type { ModDef, StatRange, StatTranslation, TranslationVariant } from '../data/types';
import { type CraftContext, familyKey } from './context';

export type Lang = 'pt-BR' | 'en';

/** Mapa de templates EN -> PT-BR (tradução manual, não oficial). Registrado pela camada i18n. */
let ptTemplates: Record<string, string> = {};
export function setPtTemplates(map: Record<string, string>) {
  ptTemplates = map;
}

const indexCache = new WeakMap<object, Map<string, StatTranslation>>();
function statIndex(ctx: CraftContext): Map<string, StatTranslation> {
  let idx = indexCache.get(ctx.data);
  if (!idx) {
    idx = new Map();
    for (const s of ctx.data.stats) for (const id of s.ids) if (!idx.has(id)) idx.set(id, s);
    indexCache.set(ctx.data, idx);
  }
  return idx;
}

function condOk(v: TranslationVariant, vals: number[]): boolean {
  return v.cond.every((c, i) => {
    const x = vals[i] ?? 0;
    if (c.min !== undefined && x < c.min) return false;
    if (c.max !== undefined && x > c.max) return false;
    return true;
  });
}

function applyHandlers(x: number, hs: string[]): number {
  for (const h of hs) {
    if (h === 'negate') x = -x;
    else if (h === 'divide_by_one_hundred') x = x / 100;
    else if (h.startsWith('per_minute_to_per_second')) x = x / 60;
    else if (h === 'milliseconds_to_seconds') x = x / 1000;
    else if (h === 'divide_by_ten_1dp_if_required') x = x / 10;
  }
  return x;
}

function fmtNum(x: number): string {
  const r = Math.round(x * 100) / 100;
  return String(r);
}

/** Formata um bloco de stats. Valores são intervalos (min-max) ou valores rolados. */
function formatEntry(entry: StatTranslation, stats: (StatRange & { value?: number })[], lang: Lang): { text: string; translated: boolean } | null {
  const vals = entry.ids.map((id) => {
    const s = stats.find((x) => x.id === id);
    return s ? (s.value ?? s.max) : 0;
  });
  const variants = entry.langs.English ?? [];
  const v = variants.find((x) => condOk(x, vals));
  if (!v) return null;
  let template = v.string;
  let translated = lang === 'en';
  if (lang === 'pt-BR') {
    const native = entry.langs['Portuguese']?.[variants.indexOf(v)]?.string;
    const pt = native ?? ptTemplates[v.string];
    if (pt) {
      template = pt;
      translated = true;
    }
  }
  const text = template.replace(/\{(\d+)(?::[^}]*)?\}/g, (_, d) => {
    const i = Number(d);
    const s = stats.find((x) => x.id === entry.ids[i]);
    const fmt = v.format[i] ?? '#';
    if (!s || fmt === 'ignore') return '';
    const hs = v.handlers[i] ?? [];
    let lo = applyHandlers(s.value ?? s.min, hs);
    let hi = applyHandlers(s.value ?? s.max, hs);
    if (lo > hi) [lo, hi] = [hi, lo];
    const plus = fmt === '+#' && lo >= 0 ? '+' : '';
    return lo === hi ? `${plus}${fmtNum(lo)}` : `${plus}(${fmtNum(lo)}-${fmtNum(hi)})`;
  });
  return { text, translated };
}

export interface ModText {
  text: string;
  /** false = texto PT indisponível, exibindo inglês. */
  translated: boolean;
}

export function formatStats(ctx: CraftContext, stats: (StatRange & { value?: number })[], lang: Lang, fallback: string): ModText {
  const idx = statIndex(ctx);
  const done = new Set<StatTranslation>();
  const lines: string[] = [];
  let translated = true;
  for (const s of stats) {
    const e = idx.get(s.id);
    if (!e) continue;
    if (done.has(e)) continue;
    done.add(e);
    const r = formatEntry(e, stats, lang);
    if (!r) continue;
    if (r.text.trim()) lines.push(r.text);
    translated &&= r.translated;
  }
  if (!lines.length) return { text: fallback, translated: lang === 'en' };
  if (lang === 'pt-BR' && !translated) return { text: fallback, translated: false };
  return { text: lines.join(' / '), translated };
}

/** Rótulo genérico da família no idioma (números trocados por "#"). */
export function familyText(ctx: CraftContext, family: string, lang: Lang): string {
  const mod = ctx.data.mods.find((m) => familyKey(m) === family);
  if (!mod) return family;
  return modText(ctx, mod, lang).text.replace(/\((-?[\d.]+)-(-?[\d.]+)\)|-?\d+(\.\d+)?/g, '#');
}

/** Texto de um implícito de base no idioma (fallback: inglês). */
export function implicitText(ctx: CraftContext, id: string, lang: Lang): ModText {
  const imp = ctx.data.implicits[id];
  if (!imp) return { text: id, translated: false };
  const fallback = imp.text.replace(/\n/g, ' / ');
  if (lang === 'en') return { text: fallback, translated: true };
  return formatStats(ctx, imp.stats, lang, fallback);
}

export function modText(ctx: CraftContext, mod: ModDef, lang: Lang, values?: number[]): ModText {
  if (lang === 'en' && !values) return { text: mod.text.replace(/\n/g, ' / '), translated: true };
  const stats = mod.stats.map((s, i) => ({ ...s, value: values?.[i] }));
  return formatStats(ctx, stats, lang, mod.text.replace(/\n/g, ' / '));
}
