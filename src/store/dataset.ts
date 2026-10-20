import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data/types';
import { type CraftContext, type WeightSettings, createContext } from '../engine/context';
import { setPtTemplates } from '../engine/text';
import { MOD_TEMPLATES_PT_BR } from '../i18n/modTemplatesPtBr';
import { effectiveRules, useStore } from './store';

setPtTemplates(MOD_TEMPLATES_PT_BR);

let cache: Promise<Dataset> | null = null;

export function loadDataset(): Promise<Dataset> {
  if (!cache) {
    const get = (f: string) =>
      fetch(`./data/poe2/${f}`).then((r) => {
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        return r.json();
      });
    const optional = (f: string) => get(f).catch(() => []);
    cache = Promise.all([get('meta.json'), get('bases.json'), get('mods.json'), get('stats.json'), optional('essences.json')]).then(([meta, bases, mods, stats, essences]) => ({
      meta,
      bases,
      mods: mods.mods,
      implicits: mods.implicits,
      stats,
      essences,
    }));
    cache.catch(() => (cache = null));
  }
  return cache;
}

export function useDataset(): { data: Dataset | null; error: string | null } {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadDataset().then(setData, (e) => setError(String(e?.message ?? e)));
  }, []);
  return { data, error };
}

/** Classes de equipamento visíveis (oculta classes ainda não lançadas, salvo opção do jogador). */
export function useVisibleClasses(data: Dataset): string[] {
  const show = useStore((s) => s.settings.showUnreleased);
  return useMemo(() => [...new Set(data.bases.filter((b) => show || b.inGame !== false).map((b) => b.itemClass))], [data, show]);
}

/** Contexto do motor derivado do dataset + configurações do jogador (pesos, regras, essências). */
export function useCraftContext(data: Dataset): CraftContext {
  const hypothesis = useStore((s) => s.settings.hypothesis);
  const table = useStore((s) => s.weightTable);
  const essences = useStore((s) => s.essences);
  const overrides = useStore((s) => s.ruleOverrides);
  return useMemo(() => {
    const weights: WeightSettings = { table, hypothesis };
    return createContext(data, effectiveRules({ ruleOverrides: overrides } as never), weights, essences);
  }, [data, hypothesis, table, essences, overrides]);
}
