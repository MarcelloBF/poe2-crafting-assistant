import { useEffect, useState } from 'react';
import { useCtx } from '../App';
import { Card, materialName } from '../components/ui';
import { DEFAULT_RULES, type EssenceDef } from '../data/rules';
import { isStale, parseNinjaExchange, STALE_HOURS } from '../engine/cost';
import { uid } from '../engine/project';
import { parseWeightTable } from '../engine/weightsImport';
import { formatDate, formatNum, useT } from '../i18n';
import { exportBackup, importBackup, mergeMarketPrices, resetAll, setPrice, setState, updateSettings, useStore } from '../store/store';
import { useClassName } from './BuilderPage';
import { useConfirm } from '../components/confirm';
import { EssenceTable } from '../components/EssenceTable';
import { useVisibleClasses } from '../store/dataset';

function readFile(f: File): Promise<string> {
  return f.text();
}

export function SettingsPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const className = useClassName();
  const settings = useStore((s) => s.settings);
  const confirmDialog = useConfirm();
  const table = useStore((s) => s.weightTable);
  const overrides = useStore((s) => s.ruleOverrides);
  const essences = useStore((s) => s.essences);
  const book = useStore((s) => s.prices[s.settings.league] ?? null);
  const visibleClasses = useVisibleClasses(ctx.data);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [leagues, setLeagues] = useState<string[]>(['Standard', 'Hardcore']);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ name: '', value: '' });
  const [ess, setEss] = useState<{ nameEn: string; mode: EssenceDef['mode']; itemClasses: string[]; modId: string; source: string }>({ nameEn: '', mode: 'magicToRare', itemClasses: [], modId: '', source: '' });

  useEffect(() => {
    fetch('./ninja/poe2/api/economy/leagues')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : Promise.reject()))
      .then((ls: { id: string }[]) => ls.map((l) => l.id))
      // Sem proxy (site estático): usa a lista gravada junto com a cópia publicada dos preços.
      .catch(() => fetch('./data/prices/index.json').then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { leagues: string[] }) => j.leagues))
      .then((ids: string[]) => setLeagues([...new Set([...ids, 'Standard', 'Hardcore'])]))
      .catch(() => undefined);
    if (location.hash.includes('#weights')) document.getElementById('weights')?.scrollIntoView();
  }, []);

  const say = (k: string, v: string) => setMsg((m) => ({ ...m, [k]: v }));

  async function fetchPrices() {
    setBusy(true);
    try {
      await fetchLivePrices();
    } catch (e) {
      // Sem acesso direto ao poe.ninja (CORS no site estático): cópia publicada pelo GitHub Actions.
      try {
        const r = await fetch(`./data/prices/${settings.league.replace(/[^\w-]+/g, '_')}.json`);
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw e;
        const j = await r.json();
        mergeMarketPrices(j.league, j.entries, { fetchedAt: j.fetchedAt, source: j.source ?? 'file', divineInExalted: j.divineInExalted });
        say('prices', t('set.fetchPrices.okSnapshot', { n: Object.keys(j.entries).length, date: formatDate(j.fetchedAt, lang) }));
      } catch {
        say('prices', t('set.fetchPrices.fail', { error: String((e as Error).message) }));
      }
    } finally {
      setBusy(false);
    }
  }

  /** Consulta o poe.ninja pelo caminho ./ninja (proxy do Vite em desenvolvimento, ou do executável). */
  async function fetchLivePrices() {
    const fetchedAt = new Date().toISOString();
    const all: Record<string, ReturnType<typeof parseNinjaExchange>['entries'][string]> = {};
    let div: number | undefined;
    for (const type of ['Currency', 'Essences', 'Ritual', 'Abyss']) {
      const r = await fetch(`./ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(settings.league)}&type=${type}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get('content-type') ?? '';
      if (!ct.includes('json')) throw new Error('proxy indisponível');
      const p = parseNinjaExchange(await r.json(), fetchedAt);
      Object.assign(all, p.entries);
      div ??= p.divineInExalted;
    }
    mergeMarketPrices(settings.league, all, { fetchedAt, source: 'poe.ninja', divineInExalted: div });
    say('prices', t('set.fetchPrices.ok', { n: Object.keys(all).length }));
  }

  const rules = DEFAULT_RULES;
  const priceRows = Object.entries(book?.entries ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="page">
      <h1>{t('set.title')}</h1>

      <Card title={t('set.language')}>
        <select value={settings.lang} onChange={(e) => updateSettings({ lang: e.target.value as 'pt-BR' | 'en' })}>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </select>
      </Card>

      <section id="weights">
        <Card title={t('set.weights')}>
          <p className="small">{t('set.weights.help')}</p>
          <div className="radio-list">
            {(['none', 'uniform', 'tierDecay'] as const).map((k) => (
              <label key={k} className="check">
                <input
                  type="radio"
                  name="hyp"
                  checked={settings.hypothesis.kind === k}
                  onChange={() => updateSettings({ hypothesis: k === 'tierDecay' ? { kind: 'tierDecay', factor: 0.7 } : { kind: k } })}
                />
                {t(`set.hyp.${k}`)}
              </label>
            ))}
            {settings.hypothesis.kind === 'tierDecay' && (
              <label>
                {t('set.hyp.factor')}{' '}
                <input
                  type="number"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={settings.hypothesis.factor}
                  onChange={(e) => updateSettings({ hypothesis: { kind: 'tierDecay', factor: Math.min(1, Math.max(0.05, Number(e.target.value) || 0.7)) } })}
                  style={{ width: '6em' }}
                />
              </label>
            )}
          </div>
          <h3>{t('set.weightTable')}</h3>
          <p className="small muted">{t('set.weightTable.help')}</p>
          {table ? (
            <p>
              {t('set.weightTable.loaded', { n: Object.keys(table.weights).length, source: table.source, conf: t(`conf.${table.confidence}`), date: formatDate(table.importedAt, lang) })}{' '}
              <button className="ghost danger" onClick={() => setState({ weightTable: null })}>
                {t('set.weightTable.remove')}
              </button>
            </p>
          ) : (
            <p className="muted">{t('set.weightTable.none')}</p>
          )}
          <input
            type="file"
            accept=".json,.csv,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = parseWeightTable(await readFile(f), new Set(ctx.data.mods.map((m) => m.id)), f.name);
              if (!r.table) say('weights', t('set.weightTable.invalid', { error: r.error ?? '' }));
              else {
                setState({ weightTable: r.table });
                say('weights', r.unknownIds.length ? t('set.weightTable.unknownIds', { n: r.unknownIds.length }) : '');
              }
              e.target.value = '';
            }}
          />
          {msg.weights && <div className="banner warn small">{msg.weights}</div>}
        </Card>
      </section>

      <Card title={t('set.rules')}>
        <p className="small muted">{t('set.rules.help')}</p>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('set.rules.currency')}</th>
                <th>{t('set.rules.minLevel')}</th>
                <th>{t('set.rules.conf')}</th>
                <th>{t('set.rules.source')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(rules.currencies).map((c) => {
                const overridden = c.id in overrides;
                const val = overridden ? overrides[c.id] : c.minModLevel;
                return (
                  <tr key={c.id}>
                    <td>{lang === 'pt-BR' ? `${c.namePt} (${c.nameEn})` : c.nameEn}</td>
                    <td>
                      {c.grade === 'normal' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={val ?? ''}
                          placeholder={t('common.unknown')}
                          onChange={(e) =>
                            setState((s) => ({ ruleOverrides: { ...s.ruleOverrides, [c.id]: e.target.value === '' ? null : Number(e.target.value) } }))
                          }
                          style={{ width: '5em' }}
                        />
                      )}
                      {overridden && (
                        <button
                          className="ghost small"
                          onClick={() =>
                            setState((s) => {
                              const r = { ...s.ruleOverrides };
                              delete r[c.id];
                              return { ruleOverrides: r };
                            })
                          }
                        >
                          {t('common.reset')}
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={`badge rc-${overridden ? 'override' : c.confidence}`}>{t(overridden ? 'set.conf.override' : `set.conf.${c.confidence}`)}</span>
                    </td>
                    <td className="small muted">{c.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3>{t('set.omens')}</h3>
        <ul className="small">
          {Object.values(rules.omens).map((o) => (
            <li key={o.id}>
              {lang === 'pt-BR' ? `${o.namePt} (${o.nameEn})` : o.nameEn} — <span className={`badge rc-${o.confidence}`}>{t(`set.conf.${o.confidence}`)}</span> <span className="muted">{o.source}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('set.essences')}>
        <EssenceTable />
        <details>
          <summary>{t('set.essences.custom')}</summary>
          <p className="small muted">{t('set.essences.help')}</p>
          {essences.length === 0 ? (
            <p className="muted">{t('set.essences.empty')}</p>
          ) : (
            <ul>
              {essences.map((e) => (
                <li key={e.id}>
                  <strong>{e.nameEn}</strong> — {t(`set.essences.mode.${e.mode}`)} — {e.effects.map((ef) => `${ef.itemClasses.map(className).join(', ')}: ${ef.modIds.map((id) => ctx.modsById.get(id)?.text ?? id).join(' / ')}`).join(' • ')}{' '}
                  <span className="muted">({e.source})</span>{' '}
                  <button className="ghost danger" onClick={() => setState((s) => ({ essences: s.essences.filter((x) => x.id !== e.id) }))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-grid">
            <label>
              {t('set.essences.name')} <input value={ess.nameEn} onChange={(e) => setEss({ ...ess, nameEn: e.target.value })} placeholder="Greater Essence of the Body" />
            </label>
            <label>
              {t('set.essences.mode')}{' '}
              <select value={ess.mode} onChange={(e) => setEss({ ...ess, mode: e.target.value as EssenceDef['mode'] })}>
                {(['normalToMagic', 'magicToRare', 'rareReplace'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`set.essences.mode.${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('set.essences.mod')} <input value={ess.modId} onChange={(e) => setEss({ ...ess, modId: e.target.value.trim() })} placeholder="IncreasedLife8" />
              {ess.modId && <small className="muted"> {ctx.modsById.get(ess.modId)?.text ?? t('set.essences.badMod')}</small>}
            </label>
            <label>
              {t('set.essences.source')} <input value={ess.source} onChange={(e) => setEss({ ...ess, source: e.target.value })} />
            </label>
            <fieldset className="classes">
              <legend>{t('set.essences.classes')}</legend>
              {[...visibleClasses].sort().map((c) => (
                <label key={c} className="check small">
                  <input
                    type="checkbox"
                    checked={ess.itemClasses.includes(c)}
                    onChange={(e) => setEss({ ...ess, itemClasses: e.target.checked ? [...ess.itemClasses, c] : ess.itemClasses.filter((x) => x !== c) })}
                  />
                  {className(c)}
                </label>
              ))}
            </fieldset>
          </div>
          <button
            disabled={!ess.nameEn || !ctx.modsById.has(ess.modId) || !ess.itemClasses.length || !ess.source}
            onClick={() => {
              const def: EssenceDef = {
                id: uid(),
                nameEn: ess.nameEn,
                tier: 'normal',
                mode: ess.mode,
                source: ess.source,
                effects: [{ category: 'manual', text: ctx.modsById.get(ess.modId)!.text, itemClasses: ess.itemClasses, modIds: [ess.modId] }],
              };
              setState((s) => ({ essences: [...s.essences, def] }));
              setEss({ nameEn: '', mode: 'magicToRare', itemClasses: [], modId: '', source: '' });
            }}
          >
            {t('set.essences.add')}
          </button>
        </details>
      </Card>
      <Card title={t('set.economy')}>
        <p className="small muted">{t('set.economy.help')}</p>
        <div className="row wrap">
          <label>
            {t('set.league')}{' '}
            <input list="leagues" value={settings.league} onChange={(e) => updateSettings({ league: e.target.value })} />
            <datalist id="leagues">
              {leagues.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <button disabled={busy} onClick={fetchPrices}>
            {busy ? t('common.running') : t('set.fetchPrices')}
          </button>
          <label className="button ghost file">
            {t('set.loadPriceFile')}
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const j = JSON.parse(await readFile(f));
                  if (!j.entries || !j.league) throw new Error('formato');
                  updateSettings({ league: j.league });
                  mergeMarketPrices(j.league, j.entries, { fetchedAt: j.fetchedAt, source: j.source ?? 'file', divineInExalted: j.divineInExalted });
                  say('prices', t('set.fetchPrices.ok', { n: Object.keys(j.entries).length }));
                } catch (err) {
                  say('prices', t('set.fetchPrices.fail', { error: String((err as Error).message) }));
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {msg.prices && <div className="banner info small">{msg.prices}</div>}
        <p className="small">
          {book?.fetchedAt ? t('set.prices.lastUpdate', { date: formatDate(book.fetchedAt, lang), source: book.source ?? '—' }) : t('set.prices.never')}
          {book?.divineInExalted ? ` • ${t('set.prices.divine', { n: formatNum(book.divineInExalted, lang, 1) })}` : ''}
        </p>
        <div className="row wrap">
          <input list="materials" placeholder={t('set.prices.item')} value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
          <datalist id="materials">
            {[...Object.values(ctx.rules.currencies).map((c) => c.nameEn), ...Object.values(ctx.rules.omens).map((o) => o.nameEn), ...essences.map((e) => e.nameEn)].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input type="number" min={0} step="any" placeholder={t('set.prices.value')} value={manual.value} onChange={(e) => setManual({ ...manual, value: e.target.value })} style={{ width: '8em' }} />
          <button
            disabled={!manual.name || manual.value === ''}
            onClick={() => {
              setPrice(settings.league, manual.name.trim(), { value: Number(manual.value), source: 'manual', updatedAt: new Date().toISOString() });
              setManual({ name: '', value: '' });
            }}
          >
            {t('set.prices.addManual')}
          </button>
        </div>
        {priceRows.length > 0 && (
          <div className="table-wrap scroll-y">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('set.prices.item')}</th>
                  <th>{t('set.prices.value')}</th>
                  <th>{t('set.prices.src')}</th>
                  <th>{t('set.prices.updated')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {priceRows.map(([name, e]) => (
                  <tr key={name}>
                    <td>{materialName(name, ctx, lang)}</td>
                    <td className="num">{formatNum(e.value, lang, 3)}</td>
                    <td>{e.source}</td>
                    <td className="small">
                      {formatDate(e.updatedAt, lang)} {isStale(e) && <span className="badge warn">{t('set.prices.stale', { h: STALE_HOURS })}</span>}
                    </td>
                    <td>
                      <button className="ghost danger" onClick={() => setPrice(settings.league, name, null)} aria-label={t('common.remove')}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('set.sim')}>
        <div className="row wrap">
          <label>
            {t('set.sim.runs')} <input type="number" min={100} max={200000} value={settings.simRuns} onChange={(e) => updateSettings({ simRuns: Math.max(100, Number(e.target.value) || 100) })} style={{ width: '7em' }} />
          </label>
          <label>
            {t('set.sim.cmpRuns')} <input type="number" min={100} max={50000} value={settings.compareRuns} onChange={(e) => updateSettings({ compareRuns: Math.max(100, Number(e.target.value) || 100) })} style={{ width: '7em' }} />
          </label>
        </div>
      </Card>

      <Card title={t('set.data')}>
        <ul className="small">
          <li>{t('set.data.version', { v: ctx.data.meta.gameVersion })}</li>
          <li>
            {t('set.data.source', { s: ctx.data.meta.source })} — <a href={ctx.data.meta.sourceUrl} target="_blank" rel="noreferrer">{ctx.data.meta.sourceUrl}</a>
          </li>
          <li>{t('set.data.imported', { d: formatDate(ctx.data.meta.importedAt, lang) })}</li>
          <li>{t('set.data.counts', { b: ctx.data.meta.counts.bases, m: ctx.data.meta.counts.mods, t: ctx.data.meta.counts.statTranslations })}</li>
          {ctx.data.meta.notes.map((n) => (
            <li key={n} className="muted">
              {n}
            </li>
          ))}
        </ul>
        <label className="check">
          <input type="checkbox" checked={settings.showUnreleased} onChange={(e) => updateSettings({ showUnreleased: e.target.checked })} />
          {t('set.showUnreleased', { classes: (ctx.data.meta.release?.unreleasedClasses ?? []).map(className).join(', ') })}
        </label>
        <p className="small muted">{t('set.showUnreleased.help')}</p>
        <p className="small">{t('set.data.update')}</p>
      </Card>

      <Card title={t('set.backup')}>
        <div className="row wrap">
          <button
            onClick={() => {
              const blob = new Blob([exportBackup()], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `poe2-crafting-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            {t('set.backup.export')}
          </button>
          <label className="button ghost file">
            {t('set.backup.import')}
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                say('backup', importBackup(await readFile(f)) ? t('set.backup.ok') : t('set.backup.invalid'));
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="danger"
            onClick={() => {
              confirmDialog({ title: t('set.reset'), message: t('set.reset.confirm'), confirmLabel: t('set.reset'), danger: true }).then((ok) => ok && resetAll());
            }}
          >
            {t('set.reset')}
          </button>
        </div>
        {msg.backup && <div className="banner info small">{msg.backup}</div>}
      </Card>
    </div>
  );
}
