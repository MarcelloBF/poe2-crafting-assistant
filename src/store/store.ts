import { useSyncExternalStore } from 'react';
import { DEFAULT_RULES, type EssenceDef, type GameRules } from '../data/rules';
import type { WeightHypothesis, WeightTable } from '../engine/context';
import type { PriceBook, PriceEntry } from '../engine/cost';
import type { Project } from '../engine/project';
import type { TargetSpec } from '../engine/target';
import type { Lang } from '../engine/text';

export interface Settings {
  lang: Lang;
  hypothesis: WeightHypothesis;
  simRuns: number;
  compareRuns: number;
  league: string;
  /** Mostrar classes que existem nos arquivos do jogo mas ainda não foram lançadas. */
  showUnreleased: boolean;
  guideDismissed: boolean;
}

export interface Draft {
  target: TargetSpec | null;
  itemClass: string;
  name: string;
  /** Projeto sendo editado no construtor (null = novo). */
  editingProjectId: string | null;
}

export interface AppState {
  settings: Settings;
  projects: Project[];
  draft: Draft;
  /** Livro de preços por liga. */
  prices: Record<string, PriceBook>;
  weightTable: WeightTable | null;
  essences: EssenceDef[];
  /** Sobrescritas do jogador para o nível mínimo das moedas (id -> nível ou null). */
  ruleOverrides: Record<string, number | null>;
  /** Preço de compra de item semelhante, por projeto. */
  buyPrices: Record<string, number>;
}

const KEY = 'poe2ca.v1';

export const DEFAULT_SETTINGS: Settings = {
  lang: 'pt-BR',
  hypothesis: { kind: 'none' },
  simRuns: 5000,
  compareRuns: 2000,
  league: 'Standard',
  showUnreleased: false,
  guideDismissed: false,
};

function defaults(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    projects: [],
    draft: { target: null, itemClass: 'Ring', name: '', editingProjectId: null },
    prices: {},
    weightTable: null,
    essences: [],
    ruleOverrides: {},
    buyPrices: {},
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const d = defaults();
    // Essências cadastradas no formato antigo (um mod só) são descartadas: a tabela do jogo agora vem no dataset.
    const essences = Array.isArray(parsed.essences) ? parsed.essences.filter((e: { effects?: unknown }) => Array.isArray(e.effects)) : [];
    return { ...d, ...parsed, essences, settings: { ...d.settings, ...parsed.settings }, draft: { ...d.draft, ...parsed.draft } };
  } catch {
    return defaults();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Armazenamento indisponível (modo privado/cota): o app segue funcionando nesta sessão.
  }
}

export function getState(): AppState {
  return state;
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const patch = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---- Ações ----

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

export function setDraft(patch: Partial<Draft>) {
  setState((s) => ({ draft: { ...s.draft, ...patch } }));
}

export function upsertProject(p: Project) {
  setState((s) => {
    const i = s.projects.findIndex((x) => x.id === p.id);
    const projects = [...s.projects];
    if (i >= 0) projects[i] = p;
    else projects.unshift(p);
    return { projects };
  });
}

export function deleteProject(id: string) {
  setState((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
}

export function setPrice(league: string, name: string, entry: PriceEntry | null) {
  setState((s) => {
    const book: PriceBook = s.prices[league] ?? { league, unit: 'exalted', entries: {} };
    const entries = { ...book.entries };
    if (entry) entries[name] = entry;
    else delete entries[name];
    return { prices: { ...s.prices, [league]: { ...book, entries } } };
  });
}

/** Mescla preços de mercado sem sobrescrever preços manuais. */
export function mergeMarketPrices(league: string, entries: Record<string, PriceEntry>, meta: { fetchedAt: string; source: string; divineInExalted?: number }) {
  setState((s) => {
    const book: PriceBook = s.prices[league] ?? { league, unit: 'exalted', entries: {} };
    const merged = { ...book.entries };
    for (const [k, v] of Object.entries(entries)) if (merged[k]?.source !== 'manual') merged[k] = v;
    return { prices: { ...s.prices, [league]: { ...book, entries: merged, fetchedAt: meta.fetchedAt, source: meta.source, divineInExalted: meta.divineInExalted ?? book.divineInExalted } } };
  });
}

export function effectiveRules(s: AppState): GameRules {
  const rules: GameRules = structuredClone(DEFAULT_RULES);
  for (const [id, lvl] of Object.entries(s.ruleOverrides)) if (rules.currencies[id]) rules.currencies[id].minModLevel = lvl;
  return rules;
}

export function exportBackup(): string {
  return JSON.stringify({ app: 'poe2-crafting-assistant', version: 1, exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importBackup(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (parsed?.app !== 'poe2-crafting-assistant' || !parsed.state) return false;
    const d = defaults();
    setState({ ...d, ...parsed.state, settings: { ...d.settings, ...parsed.state.settings } });
    return true;
  } catch {
    return false;
  }
}

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorado */
  }
  state = defaults();
  listeners.forEach((l) => l());
}
