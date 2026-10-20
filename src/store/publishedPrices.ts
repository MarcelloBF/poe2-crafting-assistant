import { getState, mergeMarketPrices, updateSettings } from './store';

const slug = (league: string) => league.replace(/[^\w-]+/g, '_');

/**
 * Carrega a cópia publicada dos preços do poe.ninja (public/data/prices, renovada pelo GitHub Actions)
 * quando a liga escolhida ainda não tem preços. Num primeiro acesso sem preços, troca a liga padrão
 * (Standard) pela liga de desafio atual. Preços já existentes, inclusive manuais, nunca são sobrescritos.
 */
export async function loadPublishedPrices(): Promise<void> {
  try {
    let { settings, prices } = getState();
    if (Object.keys(prices).length === 0 && settings.league === 'Standard') {
      const r = await fetch('./data/prices/index.json');
      const index = r.ok ? ((await r.json()) as { current?: string }) : null;
      if (index?.current) updateSettings({ league: index.current });
      ({ settings, prices } = getState());
    }
    if (prices[settings.league]) return;
    const r = await fetch(`./data/prices/${slug(settings.league)}.json`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
    const j = await r.json();
    if (!j.entries || j.league !== settings.league || getState().prices[settings.league]) return;
    mergeMarketPrices(j.league, j.entries, { fetchedAt: j.fetchedAt, source: j.source ?? 'file', divineInExalted: j.divineInExalted });
  } catch {
    // Sem cópia publicada (ex.: rodando sem build): o usuário ainda pode buscar ou informar preços.
  }
}
