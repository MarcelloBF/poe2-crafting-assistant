import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCtx } from '../App';
import { ItemEditor } from '../components/pickers';
import { Card, ConfidenceBadge, MaterialsTable, ModLabel, TargetSummary, WeightsBanner, strategyLabel } from '../components/ui';
import type { ActionSpec } from '../engine/actions';
import { costOfUsage } from '../engine/cost';
import { type ItemState, newItem, validateItem } from '../engine/item';
import type { SequenceResult } from '../engine/probability';
import { type RunStats, divergenceZ } from '../engine/simulate';
import { candidateStrategies } from '../engine/strategies';
import { formatNum, formatPct, useT } from '../i18n';
import { useStore } from '../store/store';
import { runJob } from '../worker/client';
import { SequenceEditor, TargetChooser, useTargetChoice } from './CalculatorPage';

export function SimulatorPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const choice = useTargetChoice();
  const target = choice.target;
  const runsDefault = useStore((s) => s.settings.simRuns);
  const book = useStore((s) => s.prices[s.settings.league] ?? null);
  const [mode, setMode] = useState<'strategy' | 'sequence'>('strategy');
  const [runs, setRuns] = useState(runsDefault);
  const [seed, setSeed] = useState(42);
  const [strategyId, setStrategyId] = useState('');
  const [customStart, setCustomStart] = useState(false);
  const [start, setStart] = useState<ItemState | null>(null);
  const [seq, setSeq] = useState<ActionSpec[]>([{ currency: 'transmute' }, { currency: 'augment' }, { currency: 'regal' }, { currency: 'exalt' }]);
  const [baseCost, setBaseCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [exact, setExact] = useState<SequenceResult | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const cands = useMemo(() => (target && ctx.basesById.has(target.baseId) ? candidateStrategies(ctx, target).strategies : []), [ctx, target]);
  if (!target || !ctx.basesById.has(target.baseId)) {
    return (
      <div className="page">
        <h1>{t('sim.title')}</h1>
        <p className="empty">
          {t('common.noDraft')} <Link to="/">{t('common.goBuilder')}</Link>
        </p>
      </div>
    );
  }
  const strategy = cands.find((s) => s.id === strategyId) ?? cands[0];
  const startItem = start && start.baseId === target.baseId ? start : newItem(target.baseId, target.ilvl);
  const startValid = validateItem(ctx, startItem).length === 0;

  async function run() {
    setBusy(true);
    setError(null);
    setExact(undefined);
    try {
      if (mode === 'strategy') {
        if (!strategy) return;
        setStats(await runJob(ctx, { kind: 'simStrategy', strategy, target: target!, runs, seed, start: customStart ? startItem : undefined }));
      } else {
        const [s, e] = await Promise.all([
          runJob(ctx, { kind: 'simSequence', start: startItem, specs: seq, target: target!, runs, seed }),
          runJob(ctx, { kind: 'sequence', start: startItem, specs: seq, target: target! }),
        ]);
        setStats(s);
        setExact(e);
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const exactP = exact && exact.success.value != null ? exact.success.value : null;
  const z = stats && exactP != null ? divergenceZ(exactP, stats.successes, stats.runs) : null;
  const cost = stats ? costOfUsage(stats.usagePerRun, book, baseCost) : null;

  return (
    <div className="page">
      <h1>{t('sim.title')}</h1>
      <p className="lead">{t('sim.intro')}</p>
      <WeightsBanner />
      <div className="grid two">
        <Card title={t('tut.target')} actions={<TargetChooser choice={choice} />}>
          <TargetSummary ctx={ctx} target={target} />
        </Card>
        <Card title={t('common.run')}>
          <div className="row wrap">
            <label>
              {t('sim.mode')}{' '}
              <select value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setStats(null); }}>
                <option value="strategy">{t('sim.mode.strategy')}</option>
                <option value="sequence">{t('sim.mode.sequence')}</option>
              </select>
            </label>
            <label>
              {t('sim.runs')} <input type="number" min={100} max={200000} step={100} value={runs} onChange={(e) => setRuns(Math.max(100, Math.min(200000, Number(e.target.value) || 100)))} style={{ width: '7em' }} />
            </label>
            <label>
              {t('sim.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} style={{ width: '6em' }} />
            </label>
            <label>
              {t('tut.baseCost')} <input type="number" min={0} step="any" value={baseCost ?? ''} onChange={(e) => setBaseCost(e.target.value === '' ? null : Number(e.target.value))} style={{ width: '6em' }} />
            </label>
          </div>
          {mode === 'strategy' && (
            <label className="block">
              {t('sim.strategy')}{' '}
              <select value={strategy?.id ?? ''} onChange={(e) => setStrategyId(e.target.value)}>
                {cands.map((s) => (
                  <option key={s.id} value={s.id}>
                    {strategyLabel(ctx, s, t)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="small muted">{t('sim.disclaimer')}</p>
        </Card>
      </div>

      <Card title={t('calc.start')}>
        {mode === 'strategy' && (
          <label className="check">
            <input type="checkbox" checked={!customStart} onChange={(e) => setCustomStart(!e.target.checked)} /> {t('sim.startFromDraft')}
          </label>
        )}
        {(mode === 'sequence' || customStart) && <ItemEditor ctx={ctx} item={startItem} onChange={setStart} />}
        {mode === 'sequence' && (
          <>
            <h4>{t('calc.sequence')}</h4>
            <SequenceEditor seq={seq} onChange={setSeq} baseId={target.baseId} />
          </>
        )}
        <button className="primary" disabled={busy || !startValid || (mode === 'sequence' && !seq.length)} onClick={run}>
          {busy ? t('common.running') : t('common.run')}
        </button>
        {error && <div className="banner error small">{error}</div>}
      </Card>

      {stats && stats.error === 'weights' && <div className="banner error">{t('prob.needWeights')}</div>}
      {stats && !stats.error && (
        <>
          <Card title={t('sim.results')}>
            <div className="grid two">
              <dl className="kv">
                <dt>{t('sim.successRate')}</dt>
                <dd>
                  <strong className="big">{formatPct(stats.pSuccess, lang)}</strong> <small className="muted">{t('sim.ci', { lo: formatPct(stats.ci[0], lang), hi: formatPct(stats.ci[1], lang) })}</small>{' '}
                  <ConfidenceBadge prov={stats.provenance} />
                </dd>
                <dt>{t('sim.meanActions')}</dt>
                <dd>{formatNum(stats.meanActions, lang, 2)}</dd>
                <dt>{t('sim.observedCost')}</dt>
                <dd>
                  {cost?.total != null ? `${formatNum(cost.total, lang)} ${t('common.exalted')}` : `${formatNum(cost?.partial ?? 0, lang)} ${t('common.exalted')} *`}
                </dd>
                <dt>{t('common.method')}</dt>
                <dd>{t('method.montecarlo')} ({stats.runs})</dd>
              </dl>
              <div>
                <h4>{t('sim.usage')}</h4>
                <MaterialsTable ctx={ctx} usage={stats.usagePerRun} book={book} baseCost={baseCost} />
              </div>
            </div>
            <h4>{t('sim.endReasons')}</h4>
            <div className="bars">
              {Object.entries(stats.endReasons)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <div key={k} className="bar-row">
                    <div className="bar" style={{ width: `${(100 * n) / stats.runs}%` }} />
                    <span>
                      {formatPct(n / stats.runs, lang)} — {t(k, { n: ctx.rules.alchemyModCount })}
                    </span>
                  </div>
                ))}
            </div>
          </Card>

          {mode === 'sequence' && (
            <Card title={t('sim.compareExact')}>
              {exactP == null ? (
                <p className="muted">{exact === null ? t('prob.tooLarge') : t('sim.noExact')}</p>
              ) : (
                <>
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>{t('sim.exact')}</th>
                        <th>{t('sim.observed')}</th>
                        <th>{t('sim.z')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{formatPct(exactP, lang)}</td>
                        <td>{formatPct(stats.pSuccess, lang)}</td>
                        <td>{formatNum(z, lang, 2)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {z != null && Math.abs(z) > 4 ? <div className="banner error">{t('sim.divergent')}</div> : <div className="banner ok small">{t('sim.agree')}</div>}
                </>
              )}
            </Card>
          )}
          {mode === 'strategy' && (
            <Card title={t('sim.compareExact')}>
              <p className="muted small">{t('sim.noExact')}</p>
            </Card>
          )}

          <Card title={t('sim.finals')}>
            <ul className="finals">
              {stats.finals.map((f) => (
                <li key={f.key}>
                  <span className={`badge ${f.success ? 'outcome-success' : 'outcome-fail'}`}>{formatPct(f.count / stats.runs, lang)}</span> {t(`common.${f.item.rarity}`)}
                  <ul className="modlist">
                    {f.item.mods.map((m) => {
                      const def = ctx.modsById.get(m.modId);
                      return def ? (
                        <li key={m.modId}>
                          <ModLabel ctx={ctx} mod={def} baseId={f.item.baseId} showName={false} />
                        </li>
                      ) : null;
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
