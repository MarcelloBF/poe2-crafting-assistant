import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCtx } from '../App';
import { Card, issueText, ConfidenceBadge, MaterialsTable, ModLabel, WeightsBanner, materialName, strategyLabel, strategySteps } from '../components/ui';
import { TargetTooltip } from '../components/ItemTooltip';
import type { StrategyEvaluation } from '../engine/compare';
import { createProject } from '../engine/project';
import { buyOptions } from '../engine/buy';
import { BuyOptionCard } from '../components/BuyOptions';
import { validateTarget } from '../engine/target';
import { formatNum, formatPct, useT } from '../i18n';
import { updateSettings, upsertProject, useStore } from '../store/store';
import { runJob } from '../worker/client';
import type { CompareResult } from '../worker/protocol';

export function ComparatorPage() {
  const ctx = useCtx();
  const { t, tl, lang } = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get('project');
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const draft = useStore((s) => s.draft);
  const runsDefault = useStore((s) => s.settings.compareRuns);
  const book = useStore((s) => s.prices[s.settings.league] ?? null);
  const [runs, setRuns] = useState(runsDefault);
  const [fromCurrent, setFromCurrent] = useState(true);
  const [baseCost, setBaseCost] = useState<number | null>(project?.baseCost ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  // ?auto=1 (vindo da importação de item): compara automaticamente ao abrir.
  const runRef = useRef<(() => void) | undefined>(undefined);
  const autoRan = useRef(false);
  useEffect(() => {
    if (params.get('auto') === '1' && !autoRan.current) {
      autoRan.current = true;
      setTimeout(() => runRef.current?.(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Resultado calculado com outros pesos/regras deixa de valer.
  useEffect(() => setRes(null), [ctx]);

  const target = project?.target ?? draft.target;
  if (!target || !ctx.basesById.has(target.baseId)) {
    return (
      <div className="page">
        <h1>{t('cmp.title')}</h1>
        <p className="empty">
          {t('common.noDraft')} <Link to="/">{t('common.goBuilder')}</Link>
        </p>
      </div>
    );
  }
  const errors = validateTarget(ctx, target).filter((i) => i.severity === 'error');
  const buyOpts = errors.length ? [] : buyOptions(ctx, target);
  const useStart = project && fromCurrent && (project.item.rarity !== 'normal' || project.item.mods.length > 0) ? project.item : undefined;

  async function run() {
    setBusy(true);
    setError(null);
    setApplied(false);
    try {
      const r = await runJob(ctx, { kind: 'compare', target: target!, runs, book, baseCost, start: useStart });
      setRes(r);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  // Sem pesos nenhuma estratégia pode ser simulada: pede a escolha em vez de rodar e falhar.
  const noWeights = ctx.weights.hypothesis.kind === 'none' && !ctx.weights.table;
  runRef.current = errors.length || noWeights ? undefined : run;

  const byId = new Map(res?.comparison.evaluations.map((e) => [e.strategy.id, e]) ?? []);
  const fmtCost = (x: number | null, star = false) => (x == null ? '—' : `${formatNum(x, lang)} ${t('common.exalted')}${star ? '*' : ''}`);
  const anyBaseExcluded = res?.comparison.evaluations.some((e) => e.baseExcluded) ?? false;

  function applyStrategy(e: StrategyEvaluation) {
    if (project) {
      upsertProject({ ...project, strategy: e.strategy, baseCost, expectedTotal: e.expectedTotal, updatedAt: new Date().toISOString() });
      setApplied(true);
      nav(`/projects/${project.id}`);
    } else {
      const base = ctx.basesById.get(target!.baseId)!;
      const p = createProject(draft.name.trim() || base.name, target!, e.strategy, baseCost);
      p.expectedTotal = e.expectedTotal;
      upsertProject(p);
      nav(`/projects/${p.id}`);
    }
  }

  const profiles = res
    ? ([
        ['economical', res.comparison.economical],
        ['balanced', res.comparison.balanced],
        ['consistent', res.comparison.consistent],
      ] as const)
    : [];

  const PROFILE_ICON = { economical: '💰', balanced: '⚖', consistent: '🎯' } as const;
  const sorted = res ? [...res.comparison.evaluations].sort((a, b) => b.stats.pSuccess - a.stats.pSuccess) : [];
  const maxP = Math.max(1e-9, ...sorted.map((e) => e.stats.pSuccess));
  const picked = new Set(profiles.map(([, p]) => p.strategyId).filter(Boolean));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('cmp.title')}</h1>
          <p className="lead">{t('cmp.intro')}</p>
        </div>
      </div>
      <WeightsBanner />
      <div className="grid two">
        <div className="side-stack">
          <TargetTooltip target={target} footer={project ? <>{t('cmp.forProject')}: <strong>{project.name}</strong></> : t('cmp.newProject')} />
          {errors.length > 0 && (
            <ul className="issues">
              {errors.map((i, k) => (
                <li key={k} className="error">
                  {issueText(ctx, t, lang, i)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title={<>⚙ {t('common.run')}</>}>
          <div className="form-grid">
            <label>
              {t('cmp.runs')} <input type="number" min={100} max={50000} step={100} value={runs} onChange={(e) => setRuns(Math.max(100, Number(e.target.value) || 100))} style={{ width: '7em' }} />
            </label>
            <label>
              {t('tut.baseCost')}{' '}
              <input type="number" min={0} step="any" value={baseCost ?? ''} onChange={(e) => setBaseCost(e.target.value === '' ? null : Number(e.target.value))} style={{ width: '6em' }} />
            </label>
          </div>
          {project && (project.item.rarity !== 'normal' || project.item.mods.length > 0) && (
            <label className="check">
              <input type="checkbox" checked={fromCurrent} onChange={(e) => setFromCurrent(e.target.checked)} /> {t('cmp.fromCurrent')}
            </label>
          )}
          <div className="cta-row" style={{ marginTop: '0.6rem' }}>
            <button className="primary" disabled={busy || errors.length > 0 || noWeights} onClick={run}>
              {busy ? `⏳ ${t('common.running')}` : `⚖ ${t('cmp.run')}`}
            </button>
          </div>
          {noWeights && (
            <div className="banner warn small">
              {t('cmp.needWeights')}{' '}
              <button className="primary" onClick={() => updateSettings({ hypothesis: { kind: 'tierDecay', factor: 0.7 }, weightsChosen: true })}>
                {t('weights.banner.useDecay')}
              </button>
            </div>
          )}
          <p className="small muted">{t('sim.disclaimer')}</p>
          {error && <div className="banner error small">{error}</div>}
          {applied && <div className="banner ok small">{t('cmp.applied')}</div>}
        </Card>
      </div>

      {!useStart && buyOpts.length > 0 && (
        <Card title={<>💎 {t('buy.title')}</>}>
          <p className="small">{t('buy.intro')}</p>
          <div className="grid three">
            {buyOpts.map((o) => (
              <BuyOptionCard key={o.key} target={target} option={o} />
            ))}
          </div>
        </Card>
      )}

      {res && (
        <>
          {res.comparison.limitationKeys.length > 0 && (
            <div className="banner warn">
              <ul>
                {res.comparison.limitationKeys.map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="profile-cards">
            {profiles.map(([key, pick]) => {
              const e = pick.strategyId ? byId.get(pick.strategyId) : undefined;
              return (
                <section key={key} className={`profile-card ${key}`}>
                  <div className="pf-head">
                    <span className="pf-icon" aria-hidden>
                      {PROFILE_ICON[key]}
                    </span>
                    {t(`cmp.profile.${key}`)}
                  </div>
                  {e ? (
                    <>
                      <div className="pf-big">
                        {formatPct(e.stats.pSuccess, lang)}
                        <small>{t('cmp.perBase')}</small>
                      </div>
                      <div className="pf-name">{strategyLabel(ctx, e.strategy, t)}</div>
                      <dl className="pf-stats">
                        <dt>{t('cmp.col.attempts')}</dt>
                        <dd>{formatNum(e.attempts?.expected ?? null, lang, 1)}</dd>
                        <dt>{t('cmp.col.total')}</dt>
                        <dd>{fmtCost(e.expectedTotal, e.baseExcluded)}</dd>
                      </dl>
                      <button className={key === 'balanced' ? 'primary' : ''} onClick={() => applyStrategy(e)}>
                        {project ? t('cmp.useStrategy') : t('cmp.createProject')}
                      </button>
                    </>
                  ) : (
                    <p className="muted">—</p>
                  )}
                  <p className="small muted criterion">{t(pick.criterionKey)}</p>
                  {pick.noteKey && <p className="small warn-text">{t(pick.noteKey)}</p>}
                </section>
              );
            })}
          </div>

          <Card title={<>📊 {t('cmp.details')}</>}>
            <p className="small muted">{t('cmp.clickRow')}</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('cmp.col.strategy')}</th>
                    <th>{t('cmp.col.p')}</th>
                    <th>{t('cmp.col.attempts')}</th>
                    <th>{t('cmp.col.actions')}</th>
                    <th>{t('cmp.col.costRun')}</th>
                    <th>{t('cmp.col.total')}</th>
                    <th>{t('cmp.col.conf')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((e) => (
                    <tr
                      key={e.strategy.id}
                      className={`${open === e.strategy.id ? 'selected' : ''} ${picked.has(e.strategy.id) ? 'best' : ''}`}
                      onClick={() => setOpen(open === e.strategy.id ? null : e.strategy.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{strategyLabel(ctx, e.strategy, t)}</td>
                      <td className="num chance-cell">
                        {e.stats.error ? t('conf.unavailable') : formatPct(e.stats.pSuccess, lang)}
                        {!e.stats.error && (
                          <>
                            <small className="muted">
                              {' '}
                              [{formatPct(e.stats.ci[0], lang)}–{formatPct(e.stats.ci[1], lang)}]
                            </small>
                            <div className="chance-bar">
                              <div style={{ width: `${(100 * e.stats.pSuccess) / maxP}%` }} />
                            </div>
                          </>
                        )}
                      </td>
                      <td className="num">{formatNum(e.attempts?.expected ?? null, lang, 1)}</td>
                      <td className="num">{formatNum(e.stats.meanActions, lang, 1)}</td>
                      <td className="num">{fmtCost(e.costPerRun.total, e.baseExcluded)}</td>
                      <td className="num">{fmtCost(e.expectedTotal, e.baseExcluded)}</td>
                      <td>
                        <ConfidenceBadge prov={e.stats.provenance} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {anyBaseExcluded && <p className="small muted">{t('cmp.baseExcluded')}</p>}
            {open && byId.get(open) && <StrategyDetails e={byId.get(open)!} baseCost={baseCost} onUse={applyStrategy} project={!!project} />}
          </Card>

          {res.excluded.length > 0 && (
            <details className="card collapsible">
              <summary>
                {t('cmp.excluded')} ({res.excluded.length})
              </summary>
              <ul>
                {res.excluded.map((x) => (
                  <li key={x.strategy.id}>
                    {strategyLabel(ctx, x.strategy, t)} — <span className="muted">{t(x.reason.reasonKey ?? '', x.reason.params)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <details className="card collapsible">
        <summary>{t('notModeled.title')}</summary>
        <ul className="small">
          {ctx.rules.notModeled.map((n) => (
            <li key={n.id}>
              <strong>{lang === 'pt-BR' ? n.namePt : n.nameEn}</strong>: {t(n.reasonKey)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );

  function StrategyDetails({ e, baseCost, onUse, project }: { e: StrategyEvaluation; baseCost: number | null; onUse: (e: StrategyEvaluation) => void; project: boolean }) {
    const risks = Object.entries(e.stats.endReasons)
      .filter(([k]) => k !== 'dec.success')
      .sort((a, b) => b[1] - a[1]);
    const alternatives = e.stats.finals.filter((f) => !f.success).slice(0, 5);
    return (
      <div className="details">
        <h3>{strategyLabel(ctx, e.strategy, t)}</h3>
        <div className="grid two">
          <div>
            <h4>{t('cmp.sequence')}</h4>
            <ol>
              {strategySteps(ctx, e.strategy, tl, t, target!.requirements.some((r) => r.required && r.family.endsWith('@abyss'))).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <h4>{t('cmp.materials')}</h4>
            <MaterialsTable ctx={ctx} usage={e.stats.usagePerRun} book={book} baseCost={baseCost} />
            {e.costPerRun.missing.length > 0 && <p className="small warn-text">{t('cmp.missingPrices', { items: e.costPerRun.missing.map((m) => materialName(m, ctx, lang)).join(', ') })}</p>}
            {e.costPerRun.stale.length > 0 && <p className="small warn-text">{t('cmp.stalePrices', { items: e.costPerRun.stale.join(', ') })}</p>}
            {e.percentiles && <p className="small">{t('cmp.p50p90', { p50: fmtCost(e.percentiles.p50), p90: fmtCost(e.percentiles.p90) })}</p>}
            {e.attempts && (
              <p className="small">
                {t('calc.attempts50')} {e.attempts.p50} • {t('calc.attempts90')} {e.attempts.p90}
              </p>
            )}
          </div>
          <div>
            <h4>{t('cmp.risks')}</h4>
            <ul>
              {risks.map(([k, n]) => (
                <li key={k}>
                  {formatPct(n / e.stats.runs, lang)} — {t(k, { n: ctx.rules.alchemyModCount })}
                </li>
              ))}
            </ul>
            <h4>{t('cmp.alternatives')}</h4>
            <ul className="finals">
              {alternatives.map((f) => (
                <li key={f.key}>
                  <span className="muted">{formatPct(f.count / e.stats.runs, lang)}</span> {t(`common.${f.item.rarity}`)}:
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
          </div>
        </div>
        <button className="primary" onClick={() => onUse(e)}>
          {project ? t('cmp.useStrategy') : t('cmp.createProject')}
        </button>
      </div>
    );
  }
}
