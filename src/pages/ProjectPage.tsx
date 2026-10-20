import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCtx } from '../App';
import { ItemEditor } from '../components/pickers';
import { Card, ConfidenceBadge, MaterialsTable, ModLabel, Prob, WeightsBanner, materialName, strategyLabel } from '../components/ui';
import { ItemTooltip, TargetTooltip } from '../components/ItemTooltip';
import { useClassName } from './BuilderPage';
import { type ActionSpec, actionLabel, essenceById } from '../engine/actions';
import { costOfUsage } from '../engine/cost';
import { type ItemState, cloneItem } from '../engine/item';
import { BUY_MATERIAL, type RunStats } from '../engine/simulate';
import { buyOptionByKey, matchesBuyOption } from '../engine/buy';
import { BuyOptionCard } from '../components/BuyOptions';
import { StepOptions } from '../components/StepOptions';
import { useConfirm } from '../components/confirm';
import { runJob } from '../worker/client';
import { type Project, materialsUsed, recordAttempt, recordManualState, startNewBase, tutorialState, undoAttempt } from '../engine/project';
import { acceptedEntries, evaluate } from '../engine/target';
import { familyText } from '../engine/text';
import { formatDate, formatNum, formatPct, useT } from '../i18n';
import { setState, upsertProject, useStore } from '../store/store';

function expectedRarity(ctx: ReturnType<typeof useCtx>, item: ItemState, spec: ActionSpec): ItemState['rarity'] {
  if (spec.currency === 'essence') {
    const e = essenceById(ctx, spec.essenceId);
    return e?.mode === 'normalToMagic' ? 'magic' : 'rare';
  }
  const kind = ctx.rules.currencies[spec.currency]?.kind;
  if (kind === 'transmute') return 'magic';
  if (kind === 'regal' || kind === 'alchemy') return 'rare';
  return item.rarity;
}

export function ProjectPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const nav = useNavigate();
  const { id } = useParams();
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const prices = useStore((s) => s.prices[s.settings.league] ?? null);
  const buyPrice = useStore((s) => (id ? s.buyPrices[id] : undefined));
  const [report, setReport] = useState<ItemState | null>(null);
  const [message, setMessage] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null);
  const [note, setNote] = useState('');
  const confirmDialog = useConfirm();
  const className = useClassName();
  const [showAllHistory, setShowAllHistory] = useState(false);
  /** Variação escolhida no quadro de opções (null = a ação recomendada). */
  const [altSpec, setAltSpec] = useState<ActionSpec | null>(null);

  const ts = project ? tutorialState(ctx, project) : null;
  const decision = ts?.decision ?? null;

  useEffect(() => {
    if (!project) return;
    let base = cloneItem(project.item);
    if (decision?.kind === 'action') base.rarity = expectedRarity(ctx, project.item, decision.spec);
    if (decision?.kind === 'buy') base = cloneItem(buyOptionByKey(ctx, project.target, decision.optionKey)?.item ?? base);
    setReport(base);
    setMessage(null);
    setAltSpec(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.attempts.length, project?.strategy?.id]);

  // Ações grandes demais para a enumeração exata (ex.: Alquimia) recebem uma estimativa por simulação.
  const [simEst, setSimEst] = useState<RunStats | null>(null);
  useEffect(() => {
    setSimEst(null);
    if (!project || !ts?.analysis?.tooLarge || decision?.kind !== 'action') return;
    let alive = true;
    runJob(ctx, { kind: 'simSequence', start: project.item, specs: [decision.spec], target: project.target, runs: 4000, seed: 7 })
      .then((r) => alive && setSimEst(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.attempts.length, project?.strategy?.id, ctx]);

  if (!project || !ts || !report) {
    return (
      <div className="page">
        <p className="empty">
          404 — <Link to="/projects">{t('nav.projects')}</Link>
        </p>
      </div>
    );
  }
  if (!ctx.basesById.has(project.target.baseId)) return <div className="page banner error">{t('val.unknownBase')}</div>;

  const save = (p: Project) => upsertProject(p);
  const used = materialsUsed(project);
  const cost = costOfUsage(used, prices, project.baseCost);
  const base = ctx.basesById.get(project.target.baseId)!;
  const needLevel = Math.max(1, ...project.target.requirements.filter((r) => r.required).map((r) => Math.min(...acceptedEntries(ctx, project.target, r).map((e) => e.mod.level))));
  const targets = project.target.requirements.map((r) => `${familyText(ctx, r.family, lang)} (T${r.minTier}+)`).join('; ');

  function submit(opts: { markFail?: boolean; markUnexpected?: boolean }) {
    if (!project || !report || decision?.kind !== 'action') return;
    const r = recordAttempt(ctx, project, altSpec ?? decision.spec, report, { ...opts, note: note || undefined, recommended: actionLabel(ctx, decision.spec, 'en') });
    if (!r.project) {
      setMessage({ kind: 'error', text: r.issues.map((i) => t(i.key, i.params)).join(' ') });
      return;
    }
    save(r.project);
    setNote('');
    setMessage(r.unexpected ? { kind: 'warn', text: t('tut.unexpectedWarn') } : null);
  }

  function registerManual() {
    if (!project || !report) return;
    const r = recordManualState(ctx, project, report, note || undefined);
    if (!r.project) {
      setMessage({ kind: 'error', text: r.issues.map((i) => t(i.key, i.params)).join(' ') });
      return;
    }
    save(r.project);
    setNote('');
  }

  const ev = evaluate(ctx, project.target, project.item);
  const reqIdx = project.target.requirements.map((r, i) => ({ r, i })).filter(({ r }) => r.required);
  const metCount = reqIdx.filter(({ i }) => ev.met[i]).length;
  const pct = reqIdx.length ? Math.round((100 * metCount) / reqIdx.length) : 0;
  const HISTORY_VISIBLE = 5;
  const hiddenCount = showAllHistory ? 0 : Math.max(0, project.attempts.length - HISTORY_VISIBLE);
  const visibleAttempts = project.attempts.slice(hiddenCount);
  const tone = (v: number | null | undefined, invert = false) => {
    if (v == null) return '';
    const x = invert ? 1 - v : v;
    return x >= 0.5 ? 'good' : x >= 0.15 ? 'ok' : 'bad';
  };
  const successProb =
    ts.analysis && ts.analysis.tooLarge && simEst && !simEst.error
      ? { value: simEst.pSuccess, ci: simEst.ci, provenance: simEst.provenance, method: 'montecarlo' as const }
      : ts.analysis?.success;
  const recoveryProb = ts.analysis
    ? { ...ts.analysis.stillCompletable, value: ts.analysis.stillCompletable.value == null ? null : 1 - ts.analysis.stillCompletable.value }
    : null;
  const actionIcon = (spec: ActionSpec) => {
    if (spec.currency === 'essence') return '💠';
    const kind = ctx.rules.currencies[spec.currency]?.kind;
    return ({ transmute: '✦', augment: '➕', regal: '👑', exalt: '⬆', chaos: '🌀', alchemy: '⚗', annul: '✂', divine: '✨', fracture: '🔒', desecrate: '💀' } as Record<string, string>)[kind ?? ''] ?? '◆';
  };

  return (
    <div className="page">
      <section className="project-hero">
        <div>
          <div className="pc-class">{className(base.itemClass)}</div>
          <h1>{project.name}</h1>
          <div className="ph-meta">
            {base.name} • {t('common.ilvl')} {project.target.ilvl} • {t(`common.${project.target.rarity}`)}
            <br />
            {t('projects.strategy')}: {project.strategy ? strategyLabel(ctx, project.strategy, t) : <em>{t('projects.noStrategy')}</em>}
          </div>
        </div>
        <span className={`pill status-${project.status}`}>{t(`projects.status.${project.status}`)}</span>
        <div className="pc-progress" title={t('projects.progress', { met: metCount, total: reqIdx.length })}>
          <div className="pc-bar">
            <div className="pc-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pc-pct">
            {metCount}/{reqIdx.length} {t('tut.modsDone')}
          </span>
        </div>
      </section>
      <WeightsBanner />

      <div className="tutorial-layout">
        <Card title={<>🧭 {t('tut.title')}</>}>
          <ol className="timeline">
            <li className="done">
              <span className="tl-dot">✓</span>
              <div className="tl-label">{t('tut.step', { n: 1 })}</div>
              <div className="tl-title">{t('tut.step1.title')}</div>
              <p className="small muted">{t(project.strategy?.params.buy ? 'tut.step1.bodyBuy' : 'tut.step1.body', { base: base.name, ilvl: project.target.ilvl })}</p>
            </li>
            <li className="done">
              <span className="tl-dot">✓</span>
              <div className="tl-label">{t('tut.step', { n: 2 })}</div>
              <div className="tl-title">{t('tut.step2.title')}</div>
              <p className="small muted">{t('tut.step2.body', { need: needLevel, targets })}</p>
            </li>
            {hiddenCount > 0 && (
              <li className="done">
                <button className="ghost small history-toggle" onClick={() => setShowAllHistory(true)}>
                  ⋯ {t('tut.showOlder', { n: hiddenCount })}
                </button>
              </li>
            )}
            {visibleAttempts.map((a, k) => {
              const i = hiddenCount + k;
              return (
                <li key={a.id} className={`done outcome-${a.outcome}`}>
                  <span className="tl-dot">{a.outcome === 'fail' || a.outcome === 'unexpected' ? '!' : '✓'}</span>
                  <div className="tl-label">{t('tut.step', { n: i + 3 })}</div>
                  <div className="tl-title">
                    {a.spec ? actionLabel(ctx, a.spec, lang) : a.outcome === 'bought' ? t('buy.stepTitle') : a.outcome === 'manual' ? t('tut.btn.register') : t('tut.btn.newBase')}{' '}
                    <span className={`badge outcome-${a.outcome}`}>{t(`tut.outcome.${a.outcome}`)}</span>
                  </div>
                  <div className="small muted">
                    {formatDate(a.at, lang)} • {t(`common.${a.after.rarity}`)}: {a.after.mods.map((m) => ctx.modsById.get(m.modId)?.name || m.modId).join(', ') || '—'}
                    {a.note ? ` • ${a.note}` : ''}
                  </div>
                </li>
              );
            })}
            <li className="current">
              <span className="tl-dot">{ts.stepNumber}</span>
              <div className="tl-label">{t('tut.step', { n: ts.stepNumber })} • {t('tut.current')}</div>
              <div className="current-card">
                {project.status === 'abandoned' && <p>{t('tut.ended')}</p>}
                {!project.strategy && (
                  <p>
                    {t('tut.noStrategy')} <Link to={`/comparator?project=${project.id}`}>{t('nav.comparator')}</Link>
                  </p>
                )}
                {project.status !== 'abandoned' && decision?.kind === 'success' && <div className="banner ok">🏆 {t('tut.done')}</div>}
                {project.status !== 'abandoned' &&
                  decision?.kind === 'buy' &&
                  (() => {
                    const opt = buyOptionByKey(ctx, project.target, decision.optionKey);
                    return (
                      <div className="buy-step">
                        <div className="action-banner">
                          <span className="ab-icon">🛒</span>
                          <h3 className="action-title">{t('buy.stepTitle')}</h3>
                        </div>
                        <p>{t(decision.reasonKey)}</p>
                        {opt ? <BuyOptionCard target={project.target} option={opt} /> : <p className="banner error small">{t('buy.optionGone')}</p>}
                    <div className="report">
                          <h4>{t('buy.report')}</h4>
                          <p className="small muted">{t('tut.reportHelp')}</p>
                          <ItemEditor ctx={ctx} item={report} onChange={setReport} />
                          {opt && report.mods.length > 0 && !matchesBuyOption(ctx, project.target, opt, report) && <div className="banner warn small">{t('buy.mismatch')}</div>}
                          {message && <div className={`banner ${message.kind} small`}>{message.text}</div>}
                          <div className="row wrap">
                            <button
                              className="primary"
                              onClick={() => {
                                const r = recordManualState(ctx, project, report, note || undefined, [BUY_MATERIAL]);
                                if (!r.project) setMessage({ kind: 'error', text: r.issues.map((i) => t(i.key, i.params)).join(' ') });
                                else save(r.project);
                              }}
                            >
                              ✓ {t('buy.recordBought')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                {project.status !== 'abandoned' && decision?.kind === 'restart' && (
                  <div className="banner warn">
                    <strong>↺ {t('tut.restart')}</strong> {t(decision.reasonKey)}
                    <div className="row">
                      <button className="primary" onClick={() => save(startNewBase(project, note || undefined))}>
                        {t('tut.btn.newBase')}
                      </button>
                    </div>
                  </div>
                )}
                {project.status !== 'abandoned' && decision?.kind === 'fail' && (
                  <div className="banner error">
                    <strong>{t('tut.failNoRecover')}</strong> {t(decision.reasonKey)}
                  </div>
                )}
                {project.status !== 'abandoned' && decision?.kind === 'action' && (
                  <>
                    <div className="action-banner">
                      <span className="ab-icon">{actionIcon(decision.spec)}</span>
                      <h3 className="action-title">{actionLabel(ctx, decision.spec, lang)}</h3>
                    </div>
                    <p className="small">
                      <strong>{t('tut.why')}:</strong> {t(decision.reasonKey, { n: ctx.rules.alchemyModCount })}
                    </p>
                    {decision.spec.prefer && decision.spec.prefer.length > 0 && (
                      <div className="banner info small">
                        <strong>{t('tut.chooseAtWell')}</strong>
                        <ul className="modlist">
                          {decision.spec.prefer.slice(0, 8).map((pid) => {
                            const def = ctx.modsById.get(pid);
                            return def ? (
                              <li key={pid}>
                                <ModLabel ctx={ctx} mod={def} baseId={project.target.baseId} />
                              </li>
                            ) : null;
                          })}
                        </ul>
                      </div>
                    )}
                    {ts.analysis && successProb && recoveryProb && (
                      <>
                        <div className="chance-tiles">
                          {[
                            { label: t('tut.chance.success'), r: successProb, tone: tone(successProb.value) },
                            { label: t('tut.chance.completable'), r: ts.analysis.stillCompletable, tone: tone(ts.analysis.stillCompletable.value) },
                            { label: t('tut.chance.recovery'), r: recoveryProb, tone: tone(recoveryProb.value, true) },
                          ].map((x) => (
                            <div key={x.label} className={`chance-tile ${x.tone}`}>
                              <div className="ct-label">{x.label}</div>
                              <div className="ct-value">{x.r.value == null ? '—' : formatPct(x.r.value, lang)}</div>
                              <div className="ct-foot">
                                <ConfidenceBadge prov={x.r.provenance} compact />
                                {x.r.method !== 'none' && <small className="muted">{t(`method.${x.r.method}`)}</small>}
                              </div>
                            </div>
                          ))}
                        </div>
                        {ts.analysis.tooLarge && !simEst && <p className="small muted">{t('prob.tooLarge')}</p>}
                        <details>
                          <summary className="small">{t('tut.perReq')}</summary>
                          <ul className="small">
                            {project.target.requirements.map((r, i) => (
                              <li key={r.id}>
                                {familyText(ctx, r.family, lang)} T{r.minTier}+: <Prob r={ts.analysis!.perRequirement[i]} />
                              </li>
                            ))}
                          </ul>
                        </details>
                      </>
                    )}
                    <StepOptions item={project.item} target={project.target} spec={decision.spec} book={prices} selected={altSpec} onSelect={setAltSpec} />
                    <div className="report">
                      <h4>📝 {t('tut.report')}</h4>
                      <p className="small muted">{t('tut.reportHelp')}</p>
                      <ItemEditor ctx={ctx} item={report} onChange={setReport} />
                      <label className="block">
                        {t('common.note')} <input value={note} onChange={(e) => setNote(e.target.value)} />
                      </label>
                      {message && <div className={`banner ${message.kind} small`}>{message.text}</div>}
                      <div className="row wrap">
                        <button className="primary" onClick={() => submit({})}>
                          ✓ {t('tut.btn.confirm')}
                        </button>
                        <button onClick={registerManual} title={t('tut.registerHint')}>
                          {t('tut.btn.register')}
                        </button>
                        <button className="warn" onClick={() => submit({ markFail: true })}>
                          ✗ {t('tut.btn.fail')}
                        </button>
                        <button className="warn" onClick={() => submit({ markUnexpected: true })}>
                          ? {t('tut.btn.unexpected')}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </li>
          </ol>
          <div className="tool-strip">
            <button disabled={project.attempts.length === 0} onClick={() => save(undoAttempt(project))}>
              ↶ {t('tut.btn.back')}
            </button>
            <button onClick={() => save(startNewBase(project))}>↺ {t('tut.btn.newBase')}</button>
            <button onClick={() => nav(`/comparator?project=${project.id}`)} title={t('tut.recalcHint')}>
              ⟳ {t('tut.btn.recalc')}
            </button>
            {project.status !== 'abandoned' ? (
              <button
                className="danger"
                onClick={() => {
                  confirmDialog({ title: t('tut.btn.end'), message: t('tut.endConfirm'), confirmLabel: t('tut.btn.end'), danger: true }).then(
                    (ok) => ok && save({ ...project, status: 'abandoned', updatedAt: new Date().toISOString() }),
                  );
                }}
              >
                ⏹ {t('tut.btn.end')}
              </button>
            ) : (
              <button onClick={() => save({ ...project, status: 'active' })}>▶ {t('tut.btn.reopen')}</button>
            )}
          </div>
        </Card>

        <aside className="side-stack">
          <ItemTooltip item={project.item} footer={<span className="muted">{t('tut.currentItem')}</span>} />
          <TargetTooltip
            target={project.target}
            met={ev.met}
            footer={
              <div className="row wrap" style={{ margin: 0, justifyContent: 'space-between' }}>
                <span className="muted">{t('tut.target')}</span>
                <button className="ghost small" onClick={() => nav(`/comparator?project=${project.id}`)}>
                  ⟳ {project.strategy ? t('tut.btn.recalc') : t('projects.chooseStrategy')}
                </button>
              </div>
            }
          />
          <Card title={<>🧾 {t('tut.materials')}</>}>
            <MaterialsTable ctx={ctx} usage={used} book={prices} baseCost={project.baseCost} />
            <p>
              <strong>{t('projects.cost')}:</strong> {formatNum(cost.partial, lang)} {t('common.exalted')}
              {cost.missing.length > 0 && <span className="muted small"> — {t('cmp.missingPrices', { items: cost.missing.map((m) => materialName(m, ctx, lang)).join(', ') })}</span>}
            </p>
            <div className="form-grid">
              <label>
                {t('tut.baseCost')}{' '}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={project.baseCost ?? ''}
                  onChange={(e) => save({ ...project, baseCost: e.target.value === '' ? null : Number(e.target.value) })}
                  style={{ width: '7em' }}
                />
              </label>
              <label>
                {t('tut.buyPrice')}{' '}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={buyPrice ?? ''}
                  onChange={(e) =>
                    setState((s) => {
                      const buyPrices = { ...s.buyPrices };
                      if (e.target.value === '') delete buyPrices[project.id];
                      else buyPrices[project.id] = Number(e.target.value);
                      return { buyPrices };
                    })
                  }
                  style={{ width: '7em' }}
                />
              </label>
            </div>
            {buyPrice != null && project.expectedTotal != null && (
              <p className="banner info small">{t('tut.buyCompare', { buy: formatNum(buyPrice, lang), craft: formatNum(project.expectedTotal, lang) })}</p>
            )}
          </Card>
          <Card title={<>🗒 {t('common.note')}</>}>
            <textarea rows={5} value={project.notes} onChange={(e) => save({ ...project, notes: e.target.value })} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
