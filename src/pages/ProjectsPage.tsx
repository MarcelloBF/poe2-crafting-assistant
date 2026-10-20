import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCtx } from '../App';
import { useConfirm } from '../components/confirm';
import { FamilyText, strategyLabel } from '../components/ui';
import { familyGen } from '../engine/context';
import { costOfUsage } from '../engine/cost';
import { type Project, duplicateProject, materialsUsed } from '../engine/project';
import { evaluate } from '../engine/target';
import { formatNum, useT } from '../i18n';
import { deleteProject, setDraft, upsertProject, useStore } from '../store/store';
import { useClassName } from './BuilderPage';

type Filter = 'all' | Project['status'];

function relativeTime(iso: string, lang: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function ProjectsPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const nav = useNavigate();
  const className = useClassName();
  const confirm = useConfirm();
  const projects = useStore((s) => s.projects);
  const prices = useStore((s) => s.prices[s.settings.league] ?? null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const counts = { all: projects.length, active: 0, done: 0, abandoned: 0 } as Record<Filter, number>;
  projects.forEach((p) => counts[p.status]++);
  const ql = q.trim().toLowerCase();
  const shown = [...projects]
    .filter((p) => (filter === 'all' || p.status === filter) && (!ql || p.name.toLowerCase().includes(ql) || (ctx.basesById.get(p.target.baseId)?.name ?? '').toLowerCase().includes(ql)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function remove(p: Project) {
    const ok = await confirm({ title: t('projects.deleteTitle'), message: t('common.confirmDelete', { name: p.name }), confirmLabel: t('common.delete'), danger: true });
    if (ok) deleteProject(p.id);
  }

  function newProject() {
    setDraft({ editingProjectId: null, name: '' });
    nav('/');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('projects.title')}</h1>
          <p className="lead">{t('projects.subtitle')}</p>
        </div>
        <button className="primary" onClick={newProject}>
          + {t('projects.new')}
        </button>
      </div>

      {projects.length > 0 && (
        <div className="toolbar-row">
          <div className="segmented" role="tablist">
            {(['all', 'active', 'done', 'abandoned'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? t('common.all') : t(`projects.status.${f}`)} <span className="count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <input className="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden>
            ⚒
          </div>
          <h2>{t('projects.emptyTitle')}</h2>
          <p>{t('projects.empty')}</p>
          <div className="row wrap center">
            <button className="primary" onClick={newProject}>
              {t('common.goBuilder')}
            </button>
            <Link className="button" to="/import">
              📷 {t('nav.import')}
            </Link>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <p className="empty">{t('picker.empty')}</p>
      ) : (
        <div className="project-grid">
          {shown.map((p) => {
            const base = ctx.basesById.get(p.target.baseId);
            const ev = base ? evaluate(ctx, p.target, p.item) : null;
            const req = p.target.requirements.filter((r) => r.required);
            const metCount = ev ? p.target.requirements.filter((r, i) => r.required && ev.met[i]).length : 0;
            const pct = req.length ? Math.round((100 * metCount) / req.length) : 0;
            const cost = costOfUsage(materialsUsed(p), prices, p.baseCost);
            return (
              <article key={p.id} className={`project-card status-${p.status}`}>
                <header className="pc-head">
                  <div className="pc-title">
                    <span className="pc-class">{base ? className(base.itemClass) : '?'}</span>
                    <h2 title={p.name}>{p.name}</h2>
                    <span className="pc-base">
                      {base?.name ?? p.target.baseId} • {t('common.ilvl')} {p.target.ilvl} • {t(`common.${p.target.rarity}`)}
                    </span>
                  </div>
                  <span className={`pill status-${p.status}`}>{t(`projects.status.${p.status}`)}</span>
                </header>

                <div className="pc-progress" title={t('projects.progress', { met: metCount, total: req.length })}>
                  <div className="pc-bar">
                    <div className="pc-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="pc-pct">
                    {metCount}/{req.length}
                  </span>
                </div>

                <ul className="pc-mods">
                  {p.target.requirements.map((r, i) => {
                    const met = !!ev?.met[i];
                    return (
                      <li key={r.id} className={met ? 'met' : ''}>
                        <span className="pc-check" aria-hidden>
                          {met ? '✓' : '○'}
                        </span>
                        <span className={`side side-${familyGen(r.family)}`}>{familyGen(r.family) === 'prefix' ? 'P' : 'S'}</span>
                        <span className="pc-mod-text">
                          <FamilyText ctx={ctx} family={r.family} />
                        </span>
                        <span className="tier">T{r.minTier}+</span>
                        {!r.required && <span className="badge opt">{t('common.optional')}</span>}
                      </li>
                    );
                  })}
                </ul>

                <p className="pc-strategy">
                  <span className="muted">{t('projects.strategy')}:</span> {p.strategy ? strategyLabel(ctx, p.strategy, t) : <em className="muted">{t('projects.noStrategy')}</em>}
                </p>

                <dl className="pc-stats">
                  <div>
                    <dt>{t('projects.attemptsLabel')}</dt>
                    <dd>{p.attempts.length}</dd>
                  </div>
                  <div>
                    <dt>{t('projects.cost')}</dt>
                    <dd>
                      {formatNum(cost.partial, lang)} {t('common.exalted')}
                      {cost.missing.length ? '*' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('projects.updatedLabel')}</dt>
                    <dd title={new Date(p.updatedAt).toLocaleString(lang)}>{relativeTime(p.updatedAt, lang)}</dd>
                  </div>
                </dl>

                <footer className="pc-actions">
                  <button className="primary" onClick={() => nav(`/projects/${p.id}`)}>
                    ▶ {t('common.resume')}
                  </button>
                  <div className="pc-secondary">
                    <button
                      className="ghost"
                      title={t('common.edit')}
                      onClick={() => {
                        setDraft({ target: structuredClone(p.target), itemClass: base?.itemClass ?? 'Ring', name: p.name, editingProjectId: p.id });
                        nav('/');
                      }}
                    >
                      ✎ {t('common.edit')}
                    </button>
                    <button className="ghost" title={t('common.duplicate')} onClick={() => upsertProject({ ...duplicateProject(p), name: `${p.name} (${t('common.copy')})` })}>
                      ⧉ {t('common.duplicate')}
                    </button>
                    <button className="ghost danger" title={t('common.delete')} onClick={() => remove(p)}>
                      🗑 {t('common.delete')}
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
