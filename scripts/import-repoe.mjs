#!/usr/bin/env node
// Importador de dados do Path of Exile 2 a partir do export público RePoE-fork
// (https://repoe-fork.github.io/poe2/), que é extraído dos arquivos do cliente do jogo.
//
// Uso:
//   node scripts/import-repoe.mjs --download   # baixa os arquivos brutos e gera o dataset
//   node scripts/import-repoe.mjs              # gera o dataset a partir de data-raw/repoe-poe2
//   node scripts/import-repoe.mjs --raw <dir> --out <dir>
//
// Saída: public/data/poe2/{meta,bases,mods,stats}.json
//
// IMPORTANTE: no PoE2 os "spawn_weights" do cliente são apenas 0/1 (permitido / não permitido).
// Os pesos relativos reais NÃO estão nos arquivos do jogo. O dataset gerado registra isso em
// meta.weightsAvailable = false e o app trata pesos como dado ausente (ver docs/REGRAS.md).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { POE2DB_ESSENCE_URL, linkEssences, parseEssencePage } from './essences.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://repoe-fork.github.io/poe2';
const RAW_FILES = {
  mods: 'mods.min.json',
  bases: 'base_items.min.json',
  itemClasses: 'item_classes.min.json',
  stats: 'stat_translations/stat_descriptions.min.json',
};

export const EQUIPMENT_CLASSES = [
  'Amulet', 'Ring', 'Belt', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield', 'Buckler', 'Focus', 'Quiver',
  'One Hand Sword', 'Two Hand Sword', 'One Hand Axe', 'Two Hand Axe', 'One Hand Mace', 'Two Hand Mace',
  'Spear', 'Claw', 'Dagger', 'Flail', 'Warstaff', 'Wand', 'Staff', 'Sceptre', 'Bow', 'Crossbow', 'Talisman',
];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** Remove a marcação de palavras-chave do jogo: "[Tag|Texto]" -> "Texto", "[Texto]" -> "Texto". */
export function cleanText(s) {
  if (!s) return s;
  return s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
}

async function download(rawDir) {
  fs.mkdirSync(rawDir, { recursive: true });
  const headers = { 'User-Agent': 'poe2-crafting-assistant data importer' };
  for (const f of Object.values(RAW_FILES)) {
    const url = `${SOURCE_URL}/${f}`;
    process.stdout.write(`baixando ${url} ... `);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Valida que é JSON antes de gravar (dados de terceiros são tratados como não confiáveis).
    JSON.parse(buf.toString('utf8'));
    fs.writeFileSync(path.join(rawDir, f.replace(/\//g, '__')), buf);
    console.log(`${buf.length} bytes`);
  }
  const res = await fetch(`${SOURCE_URL}/`, { headers });
  const html = await res.text();
  const m = html.match(/PoE2 version ([0-9][0-9.]*[0-9])/i);
  fs.writeFileSync(path.join(rawDir, 'version.txt'), m ? m[1] : 'desconhecida');
  // Tabela de essências (não existe no export RePoE): página pública do poe2db.
  const essDir = path.join(ROOT, 'data-raw', 'poe2db');
  fs.mkdirSync(essDir, { recursive: true });
  process.stdout.write(`baixando ${POE2DB_ESSENCE_URL} ... `);
  const er = await fetch(POE2DB_ESSENCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 poe2-crafting-assistant data importer' } });
  if (er.ok) {
    const page = await er.text();
    fs.writeFileSync(path.join(essDir, 'essence.html'), page);
    console.log(`${page.length} bytes`);
  } else console.log(`falhou (HTTP ${er.status}); essências não serão atualizadas`);
}

function readRaw(rawDir, key) {
  const p = path.join(rawDir, RAW_FILES[key].replace(/\//g, '__'));
  const buf = fs.readFileSync(p);
  return { json: JSON.parse(buf.toString('utf8')), sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/** Converte o export bruto em dataset compacto. Função pura para permitir testes. */
export function buildDataset({ mods, bases, stats, essencePage = null }, { gameVersion = 'desconhecida', importedAt = new Date().toISOString(), hashes = {}, release = { unreleasedClasses: [], excludedTags: [] } } = {}) {
  const outBases = [];
  const implicitIds = new Set();
  const excludedTags = new Set(release.excludedTags || []);
  const excludedIds = (release.excludedIdPatterns || []).map((p) => new RegExp(p));
  for (const [id, b] of Object.entries(bases)) {
    if (b.domain !== 'item' || b.release_state !== 'released') continue;
    if (!EQUIPMENT_CLASSES.includes(b.item_class)) continue;
    // Itens que não são bases obtíveis (gerados por habilidade, únicos especiais) e bases genéricas de exemplo.
    if ((b.tags || []).some((t) => excludedTags.has(t))) continue;
    if (!b.name || b.name === b.item_class) continue;
    if (excludedIds.some((re) => re.test(id))) continue;
    for (const imp of b.implicits || []) implicitIds.add(imp);
    outBases.push({
      id,
      name: b.name,
      // Classe presente nos arquivos do cliente mas ainda não lançada no jogo (lista curada).
      inGame: !(release.unreleasedClasses || []).includes(b.item_class),
      itemClass: b.item_class,
      tags: b.tags || [],
      dropLevel: b.drop_level ?? 1,
      implicits: b.implicits || [],
      requirements: b.requirements || null,
      properties: b.properties || {},
    });
  }
  outBases.sort((a, b) => a.itemClass.localeCompare(b.itemClass) || a.dropLevel - b.dropLevel || a.name.localeCompare(b.name));

  // Essências (opcional): página do poe2db com a tabela de essências.
  let essences = [];
  let essenceModIds = new Set();
  if (essencePage) {
    const linked = linkEssences(parseEssencePage(essencePage), mods, outBases, cleanText);
    essences = linked.essences;
    essenceModIds = linked.usedModIds;
  }

  // Um mod "gera" numa base se a primeira tag da lista do mod presente na base tiver flag > 0.
  const spawnsOnSomeBase = (m) =>
    outBases.some((b) => {
      for (const w of m.spawn_weights) if (b.tags.includes(w.tag)) return w.weight > 0;
      return false;
    });
  const LORDS = { ulaman_mod: 'ulaman', amanamu_mod: 'amanamu', kurgal_mod: 'kurgal' };

  const outMods = [];
  const usedStats = new Set();
  const implicits = {};
  for (const [id, m] of Object.entries(mods)) {
    if (implicitIds.has(id)) {
      implicits[id] = { id, text: cleanText(m.text || ''), stats: m.stats.map((s) => ({ id: s.id, min: s.min, max: s.max })) };
      m.stats.forEach((s) => usedStats.add(s.id));
    }
    if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue;
    let desecrated = false;
    let essenceOnly = false;
    if (m.domain === 'desecrated') {
      // Mods profanados (Abyss): só os que geram em equipamento (joias/outras mecânicas ficam de fora).
      if (!spawnsOnSomeBase(m)) continue;
      desecrated = true;
    } else if (m.domain === 'item') {
      const spawnable = m.spawn_weights.some((w) => w.weight > 0);
      if (!spawnable && !m.is_essence_only && !essenceModIds.has(id)) continue;
      essenceOnly = !!m.is_essence_only || (!spawnable && essenceModIds.has(id));
    } else continue;
    const lordTag = m.spawn_weights.find((w) => w.weight > 0 && LORDS[w.tag]);
    outMods.push({
      id,
      name: m.name,
      gen: m.generation_type,
      type: m.type,
      groups: m.groups,
      level: m.required_level,
      // Flags de geração do cliente (0/1). NÃO são pesos relativos.
      spawn: m.spawn_weights.map((w) => [w.tag, w.weight]),
      stats: m.stats.map((s) => ({ id: s.id, min: s.min, max: s.max })),
      text: cleanText(m.text || ''),
      tags: m.implicit_tags || [],
      essenceOnly,
      ...(desecrated ? { desecrated: true, lord: lordTag ? LORDS[lordTag.tag] : null } : {}),
    });
    m.stats.forEach((s) => usedStats.add(s.id));
  }
  outMods.sort((a, b) => a.type.localeCompare(b.type) || a.level - b.level || a.id.localeCompare(b.id));

  const outStats = [];
  for (const entry of stats) {
    if (!entry.ids || !entry.ids.some((i) => usedStats.has(i))) continue;
    const langs = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k === 'ids' || k === 'trade_stats' || !Array.isArray(v)) continue;
      langs[k] = v.map((t) => ({
        cond: t.condition,
        format: t.format,
        handlers: t.index_handlers,
        string: cleanText(t.string),
      }));
    }
    // Ids do site de trade (explicit/desecrated/…) para montar buscas de compra.
    const trade = {};
    for (const ts of entry.trade_stats || []) if (ts.type && ts.id && !trade[ts.type]) trade[ts.type] = ts.id;
    outStats.push({ ids: entry.ids, langs, ...(Object.keys(trade).length ? { trade } : {}) });
  }

  const meta = {
    schema: 1,
    game: 'Path of Exile 2',
    gameVersion,
    source: 'RePoE-fork (export dos arquivos do cliente do PoE2)',
    sourceUrl: SOURCE_URL,
    importedAt,
    hashes,
    counts: {
      bases: outBases.length,
      mods: outMods.length,
      desecratedMods: outMods.filter((m) => m.desecrated).length,
      essences: essences.length,
      essenceEffectsLinked: essences.reduce((s, e) => s + e.effects.filter((x) => x.modId).length, 0),
      essenceEffects: essences.reduce((s, e) => s + e.effects.length, 0),
      implicits: Object.keys(implicits).length,
      statTranslations: outStats.length,
    },
    essenceSource: essencePage ? { name: 'poe2db (tabela de essências gerada dos arquivos do jogo)', url: POE2DB_ESSENCE_URL } : null,
    weightsAvailable: false,
    release: {
      unreleasedClasses: release.unreleasedClasses || [],
      reviewedAt: release.reviewedAt ?? null,
      source: release.source ?? null,
    },
    notes: [
      'spawn_weights do cliente PoE2 são 0/1: indicam elegibilidade, não peso relativo.',
      'Pesos relativos devem vir de uma fonte externa importada pelo usuário ou de uma hipótese explicitamente marcada como estimativa.',
      'Textos de modificadores disponíveis apenas em inglês nesta fonte.',
    ],
  };
  return { meta, bases: outBases, mods: outMods, implicits, stats: outStats, essences };
}

async function main() {
  const rawDir = path.resolve(arg('--raw', path.join(ROOT, 'data-raw', 'repoe-poe2')));
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'public', 'data', 'poe2')));
  if (process.argv.includes('--download')) await download(rawDir);
  const mods = readRaw(rawDir, 'mods');
  const bases = readRaw(rawDir, 'bases');
  const stats = readRaw(rawDir, 'stats');
  const vFile = path.join(rawDir, 'version.txt');
  const gameVersion = fs.existsSync(vFile) ? fs.readFileSync(vFile, 'utf8').trim() : 'desconhecida';
  const releaseFile = path.join(ROOT, 'data-config', 'poe2-release.json');
  const release = fs.existsSync(releaseFile) ? JSON.parse(fs.readFileSync(releaseFile, 'utf8')) : undefined;
  const essFile = path.join(ROOT, 'data-raw', 'poe2db', 'essence.html');
  const essencePage = fs.existsSync(essFile) ? fs.readFileSync(essFile, 'utf8') : null;
  if (!essencePage) console.warn('aviso: data-raw/poe2db/essence.html ausente — essências não serão importadas (use --download).');
  const ds = buildDataset(
    { mods: mods.json, bases: bases.json, stats: stats.json, essencePage },
    { gameVersion, hashes: { mods: mods.sha256, bases: bases.sha256, stats: stats.sha256 }, release },
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(ds.meta, null, 2));
  fs.writeFileSync(path.join(outDir, 'bases.json'), JSON.stringify(ds.bases));
  fs.writeFileSync(path.join(outDir, 'mods.json'), JSON.stringify({ mods: ds.mods, implicits: ds.implicits }));
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(ds.stats));
  fs.writeFileSync(path.join(outDir, 'essences.json'), JSON.stringify(ds.essences, null, 1));
  console.log(`dataset gerado em ${outDir}`, ds.meta.counts, `versão do jogo: ${gameVersion}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
