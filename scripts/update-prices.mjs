#!/usr/bin/env node
// Atualiza preços de mercado a partir da API pública de economia do poe.ninja (PoE2).
// Documentação: https://poe.ninja/docs/api — respeita o cache (~1 h no PoE2) e envia User-Agent descritivo.
//
// Uso:
//   node scripts/update-prices.mjs                    # liga de desafio atual + Standard
//   node scripts/update-prices.mjs --league "Standard"
//
// Saída: public/data/prices/<liga>.json  (carregável em Configurações > Economia)
// Os preços são convertidos para Exalted Orbs e registram a fonte e o horário da coleta.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://poe.ninja/poe2/api/economy';
const TYPES = ['Currency', 'Essences', 'Ritual', 'Abyss'];
const headers = { 'User-Agent': 'poe2-crafting-assistant price updater (+https://github.com/MarcelloBF/poe2-crafting-assistant)' };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function parseExchange(json, fetchedAt) {
  const entries = {};
  const names = new Map((json?.items ?? []).map((i) => [i.id, i.name]));
  const exPerPrimary = json?.core?.rates?.exalted;
  if (!exPerPrimary) return { entries };
  for (const line of json?.lines ?? []) {
    const name = names.get(line.id);
    if (!name || typeof line.primaryValue !== 'number') continue;
    entries[name] = { value: line.primaryValue * exPerPrimary, source: 'poe.ninja', updatedAt: fetchedAt };
  }
  if (json.core.primary === 'divine') entries['Divine Orb'] = { value: exPerPrimary, source: 'poe.ninja', updatedAt: fetchedAt };
  return { entries, divineInExalted: json.core.primary === 'divine' ? exPerPrimary : undefined };
}

async function updateLeague(league, leagues) {
  const fetchedAt = new Date().toISOString();
  const all = {};
  let divineInExalted;
  for (const type of TYPES) {
    const url = `${API}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const parsed = parseExchange(await res.json(), fetchedAt);
    Object.assign(all, parsed.entries);
    divineInExalted ??= parsed.divineInExalted;
  }
  const out = { league, unit: 'exalted', source: 'poe.ninja (API pública de economia PoE2)', fetchedAt, divineInExalted, leagues: leagues.map((l) => l.id), entries: all };
  const dir = path.join(ROOT, 'public', 'data', 'prices');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${league.replace(/[^\w-]+/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${Object.keys(all).length} preços gravados em ${file} (liga ${league}, ${fetchedAt})`);
}

async function main() {
  const leagues = await (await fetch(`${API}/leagues`, { headers })).json();
  // Sem --league: liga de desafio atual + Standard (o site publicado usa estas cópias).
  const wanted = arg('--league') ? [arg('--league')] : [...new Set([leagues[0]?.id, 'Standard'].filter(Boolean))];
  if (!wanted.length) throw new Error('nenhuma liga encontrada');
  for (const league of wanted) await updateLeague(league, leagues);
  const index = { current: wanted[0], leagues: leagues.map((l) => l.id), updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'prices', 'index.json'), JSON.stringify(index, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
