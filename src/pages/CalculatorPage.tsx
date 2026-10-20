import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCtx } from '../App';
import { ActionPicker, ItemEditor } from '../components/pickers';
import { Card, FamilyText, ModLabel, Prob, TargetSummary, WeightsBanner } from '../components/ui';
import { type ActionSpec, actionLabel } from '../engine/actions';
import { getBasePool } from '../engine/context';
import { type ItemState, newItem, validateItem } from '../engine/item';
import { type SequenceResult, analyzeNextAction, divineSuccessChance, familyTierChance, geometric } from '../engine/probability';
import type { TargetSpec } from '../engine/target';
import { formatNum, formatPct, useT } from '../i18n';
import { familyText } from '../engine/text';
import { useStore } from '../store/store';
import { runJob } from '../worker/client';

/** Escolhe o alvo: construtor ou um projeto salvo. */
export function useTargetChoice() {
  const draft = useStore((s) => s.draft);
  const projects = useStore((s) => s.projects);
  const [source, setSource] = useState<string>('draft');
  const project = projects.find((p) => p.id === source);
  const target: TargetSpec | null = project?.target ?? draft.target;
  return { source, setSource, project, projects, target };
}

export function TargetChooser({ choice }: { choice: ReturnType<typeof useTargetChoice> }) {
  const { t } = useT();
  return (
    <label>
      {t('tut.target')}{' '}
      <select value={choice.source} onChange={(e) => choice.setSource(e.target.value)}>
        <option value="draft">{t('nav.builder')}</option>
        {choice.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {t('common.project')}: {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SequenceEditor({ seq, onChange, baseId }: { seq: ActionSpec[]; onChange: (s: ActionSpec[]) => void; baseId?: string }) {
  const ctx = useCtx();
  const { t, lang } = useT();
  const [next, setNext] = useState<ActionSpec>({ currency: 'transmute' });
  return (
    <div>
      <ActionPicker ctx={ctx} value={next} onChange={setNext} baseId={baseId} />
      <div className="row wrap">
        <button onClick={() => onChange([...seq, next])}>+ {t('calc.addToSequence')}</button>
        <button className="ghost" disabled={!seq.length} onClick={() => onChange([])}>
          {t('calc.clearSequence')}
        </button>
      </div>
      <ol className="seq">
        {seq.map((s, i) => (
          <li key={i}>
            {actionLabel(ctx, s, lang)}{' '}
            <button className="ghost danger" onClick={() => onChange(seq.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
              ✕
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CalculatorPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const choice = useTargetChoice();
  const target = choice.target;
  const [item, setItem] = useState<ItemState | null>(null);
  const [spec, setSpec] = useState<ActionSpec>({ currency: 'transmute' });
  const [seq, setSeq] = useState<ActionSpec[]>([{ currency: 'transmute' }, { currency: 'augment' }, { currency: 'regal' }]);
  const [seqRes, setSeqRes] = useState<SequenceResult | null | 'tooLarge'>(null);
  const [busy, setBusy] = useState(false);
  const [family, setFamily] = useState<string>('');
  const [maxTier, setMaxTier] = useState(1);

  const current: ItemState | null = useMemo(
    () => (target && ctx.basesById.has(target.baseId) ? (item && item.baseId === target.baseId ? item : choice.project?.item ?? newItem(target.baseId, target.ilvl)) : null),
    [ctx, target, item, choice.project],
  );
  const valid = current ? validateItem(ctx, current).length === 0 : false;
  const analysis = useMemo(() => (current && target && valid ? analyzeNextAction(ctx, current, spec, target) : null), [ctx, current, spec, target, valid]);
  const pool = current ? getBasePool(ctx, current.baseId) : null;
  const fam = family || target?.requirements[0]?.family || '';
  const ftc = useMemo(() => (current && valid && fam ? familyTierChance(ctx, current, spec, fam, maxTier) : null), [ctx, current, spec, fam, maxTier, valid]);

  if (!target || !current) {
    return (
      <div className="page">
        <h1>{t('calc.title')}</h1>
        <p className="empty">
          {t('common.noDraft')} <Link to="/">{t('common.goBuilder')}</Link>
        </p>
      </div>
    );
  }

  async function runSeq() {
    setBusy(true);
    try {
      const r = await runJob(ctx, { kind: 'sequence', start: current!, specs: seq, target: target! });
      setSeqRes(r ?? 'tooLarge');
    } finally {
      setBusy(false);
    }
  }

  const seqGeo = seqRes && seqRes !== 'tooLarge' && seqRes.success.value != null ? geometric(seqRes.success.value) : null;
  const hasValueReq = target.requirements.some((r) => r.minValue != null);

  return (
    <div className="page">
      <h1>{t('calc.title')}</h1>
      <p className="lead">{t('calc.intro')}</p>
      <WeightsBanner />
      <div className="grid two">
        <Card title={t('tut.target')} actions={<TargetChooser choice={choice} />}>
          <TargetSummary ctx={ctx} target={target} />
        </Card>
        <Card title={t('calc.start')}>
          <ItemEditor ctx={ctx} item={current} onChange={setItem} />
        </Card>
      </div>

      <Card title={t('calc.next')}>
        <ActionPicker ctx={ctx} value={spec} onChange={setSpec} baseId={current.baseId} />
        {analysis && !analysis.check.ok && <div className="banner warn small">{t(analysis.check.key, analysis.check.params)}</div>}
        {analysis && analysis.check.ok && (
          <div className="grid two">
            <div>
              <dl className="kv">
                <dt>{t('calc.successChance')}</dt>
                <dd>
                  <Prob r={analysis.success} big />
                </dd>
                <dt>{t('tut.chance.completable')}</dt>
                <dd>
                  <Prob r={analysis.stillCompletable} />
                </dd>
              </dl>
              <h4>{t('calc.perReq')}</h4>
              <ul>
                {target.requirements.map((r, i) => (
                  <li key={r.id}>
                    <FamilyText ctx={ctx} family={r.family} /> T{r.minTier}+: <Prob r={analysis.perRequirement[i]} />
                  </li>
                ))}
              </ul>
              {hasValueReq && (
                <p>
                  {t('calc.valueChance')}: <Prob r={divineSuccessChance(ctx, target, current)} />
                </p>
              )}
            </div>
            <div>
              <h4>{t('calc.outcomes')}</h4>
              {analysis.tooLarge ? (
                <p className="muted">{t('prob.tooLarge')}</p>
              ) : analysis.provenance.confidence === 'unavailable' ? (
                <p className="muted">{t('prob.needWeights')}</p>
              ) : (
                <ul className="outcomes">
                  {analysis.outcomes.slice(0, 12).map((o, i) => {
                    const added = o.item.mods.filter((m) => !current.mods.some((c) => c.modId === m.modId));
                    return (
                      <li key={i}>
                        <span className="pct">{formatPct(o.p, lang)}</span>
                        {added.length === 0 ? (
                          <span className="muted">{t(`common.${o.item.rarity}`)}: {o.item.mods.length} mods</span>
                        ) : (
                          added.map((m) => <ModLabel key={m.modId} ctx={ctx} mod={ctx.modsById.get(m.modId)!} baseId={current.baseId} showName={false} />)
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title={t('calc.tierChance')}>
        <div className="row wrap">
          <label>
            {t('calc.family')}{' '}
            <select value={fam} onChange={(e) => setFamily(e.target.value)}>
              {pool &&
                [...pool.byFamily.keys()].sort().map((f) => (
                  <option key={f} value={f}>
                    {f.startsWith('prefix') ? 'P' : 'S'} — {familyText(ctx, f, lang)}{f.endsWith('@abyss') ? ' ⛧' : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('calc.maxTier')}{' '}
            <select value={maxTier} onChange={(e) => setMaxTier(Number(e.target.value))}>
              {(pool?.byFamily.get(fam) ?? []).map((e) => (
                <option key={e.tier} value={e.tier}>
                  T{e.tier} ({t('common.level')} {e.mod.level})
                </option>
              ))}
            </select>
          </label>
        </div>
        {ftc && (
          <dl className="kv">
            <dt>{t('calc.pFamily')}</dt>
            <dd>
              <Prob r={ftc.family} />
            </dd>
            <dt>{t('calc.pTier')}</dt>
            <dd>
              <Prob r={ftc.tier} />
            </dd>
            <dt>{t('calc.pTierGivenFamily')}</dt>
            <dd>
              <Prob r={ftc.tierGivenFamily} />
            </dd>
          </dl>
        )}
      </Card>

      <Card title={t('calc.sequence')}>
        <SequenceEditor seq={seq} baseId={current.baseId} onChange={(s) => { setSeq(s); setSeqRes(null); }} />
        <button className="primary" disabled={busy || !seq.length || !valid} onClick={runSeq}>
          {busy ? t('common.running') : t('calc.runSequence')}
        </button>
        {seqRes === 'tooLarge' && <div className="banner warn small">{t('prob.tooLarge')}</div>}
        {seqRes && seqRes !== 'tooLarge' && (
          <div className="grid two">
            <dl className="kv">
              <dt>{t('calc.successChance')}</dt>
              <dd>
                <Prob r={seqRes.success} big />
              </dd>
              <dt>{t('calc.expectedAttempts')}</dt>
              <dd>{seqGeo ? `${formatNum(seqGeo.expected, lang, 1)} ${t('calc.attemptsUnit')}` : '—'}</dd>
              <dt>{t('calc.attempts50')}</dt>
              <dd>{seqGeo?.p50 ?? '—'}</dd>
              <dt>{t('calc.attempts90')}</dt>
              <dd>{seqGeo?.p90 ?? '—'}</dd>
            </dl>
            <div>
              <p className="small muted">{t('calc.states', { n: seqRes.states })}</p>
              {seqRes.blocked > 0 && <p className="small warn-text">{t('calc.blocked', { p: formatPct(seqRes.blocked, lang) })}</p>}
              <ul>
                {target.requirements.map((r, i) => (
                  <li key={r.id}>
                    <FamilyText ctx={ctx} family={r.family} /> T{r.minTier}+: <Prob r={seqRes.perRequirement[i]} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
