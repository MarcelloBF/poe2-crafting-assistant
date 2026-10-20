import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCtx } from '../App';
import { Card, Empty } from '../components/ui';
import { actionLabel } from '../engine/actions';
import type { ItemState } from '../engine/item';
import { formatDate, useT } from '../i18n';
import { useStore } from '../store/store';

const OUTCOMES = ['success', 'progress', 'fail', 'unexpected', 'newBase', 'manual', 'bought'] as const;

export function HistoryPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const projects = useStore((s) => s.projects);
  const [pid, setPid] = useState('all');
  const [outcome, setOutcome] = useState('all');

  const rows = projects
    .filter((p) => pid === 'all' || p.id === pid)
    .flatMap((p) => p.attempts.map((a) => ({ p, a })))
    .filter(({ a }) => outcome === 'all' || a.outcome === outcome)
    .sort((x, y) => y.a.at.localeCompare(x.a.at));
  const count = (o: string) => rows.filter((r) => r.a.outcome === o).length;
  const short = (it: ItemState) => `${t(`common.${it.rarity}`)}: ${it.mods.map((m) => ctx.modsById.get(m.modId)?.name || m.modId).join(', ') || '—'}`;

  return (
    <div className="page">
      <h1>{t('hist.title')}</h1>
      <Card>
        <div className="filters">
          <label>
            {t('hist.filterProject')}{' '}
            <select value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="all">{t('common.all')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('hist.filterOutcome')}{' '}
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="all">{t('common.all')}</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(`tut.outcome.${o}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">{t('hist.summary', { n: rows.length, s: count('success'), f: count('fail'), u: count('unexpected') })}</p>
        {rows.length === 0 ? (
          <Empty>{t('hist.empty')}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.project')}</th>
                  <th>{t('hist.action')}</th>
                  <th>{t('common.result')}</th>
                  <th>{t('hist.before')}</th>
                  <th>{t('hist.after')}</th>
                  <th>{t('common.note')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, a }) => (
                  <tr key={a.id}>
                    <td className="small">{formatDate(a.at, lang)}</td>
                    <td>
                      <Link to={`/projects/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{a.spec ? actionLabel(ctx, a.spec, lang) : a.outcome === 'bought' ? t('buy.stepTitle') : t(`tut.outcome.${a.outcome}`)}</td>
                    <td>
                      <span className={`badge outcome-${a.outcome}`}>{t(`tut.outcome.${a.outcome}`)}</span>
                    </td>
                    <td className="small">{short(a.before)}</td>
                    <td className="small">{short(a.after)}</td>
                    <td className="small">{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
