import { useCallback } from 'react';
import { useStore } from '../store/store';
import { en } from './en';
import { ptBR, type Dict } from './pt-BR';
import type { Lang } from '../engine/text';

const dicts: Record<Lang, Dict> = { 'pt-BR': ptBR as Dict, en };

export type TKey = keyof Dict;
export type TParams = Record<string, string | number | undefined>;

function interpolate(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

export function translate(lang: Lang, key: string, params?: TParams): string {
  const v = (dicts[lang] as Record<string, unknown>)[key] ?? (dicts['pt-BR'] as Record<string, unknown>)[key];
  if (typeof v !== 'string') return key;
  return interpolate(v, params);
}

export function translateList(lang: Lang, key: string, params?: TParams): string[] {
  const v = (dicts[lang] as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.map((x) => interpolate(x, params)) : [];
}

export function useT() {
  const lang = useStore((s) => s.settings.lang);
  const t = useCallback((key: string, params?: TParams) => translate(lang, key, params), [lang]);
  const tl = useCallback((key: string, params?: TParams) => translateList(lang, key, params), [lang]);
  return { t, tl, lang };
}

export function formatPct(p: number | null | undefined, lang: Lang): string {
  if (p == null || Number.isNaN(p)) return '—';
  const v = p * 100;
  const digits = v === 0 || v === 100 ? 0 : v < 0.01 ? 4 : v < 1 ? 3 : 2;
  return `${v.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

export function formatNum(x: number | null | undefined, lang: Lang, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString(lang, { maximumFractionDigits: digits });
}

export function formatDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang);
}
