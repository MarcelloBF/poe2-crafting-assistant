import { useState } from 'react';
import { useCtx } from '../App';
import { modText } from '../engine/text';
import { useT } from '../i18n';
import { useClassName } from '../pages/BuilderPage';
import { useVisibleClasses } from '../store/dataset';

/** Tabela de essências do jogo (dataset), com o mod garantido por categoria de item. */
export function EssenceTable() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const className = useClassName();
  const classes = useVisibleClasses(ctx.data);
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('all');
  const list = ctx.data.essences ?? [];
  const ql = q.trim().toLowerCase();
  const shown = list.filter(
    (e) =>
      (!ql || e.nameEn.toLowerCase().includes(ql) || e.effects.some((ef) => ef.text.toLowerCase().includes(ql))) &&
      (cls === 'all' || e.effects.some((ef) => ef.itemClasses.includes(cls))),
  );
  const src = ctx.data.meta.essenceSource;
  return (
    <div>
      <p className="small muted">
        {t('set.essences.dataset', { n: list.length })}{' '}
        {src && (
          <a href={src.url} target="_blank" rel="noreferrer">
            {src.name}
          </a>
        )}
      </p>
      <div className="filters">
        <input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="all">{t('common.all')}</option>
          {[...classes].sort((a, b) => className(a).localeCompare(className(b))).map((c) => (
            <option key={c} value={c}>
              {className(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap scroll-y">
        <table className="table compact">
          <thead>
            <tr>
              <th>{t('set.essences.name')}</th>
              <th>{t('set.essences.mode')}</th>
              <th>{t('set.essences.effects')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td>{e.nameEn}</td>
                <td className="small">{t(`set.essences.mode.${e.mode}`)}</td>
                <td className="small">
                  {e.effects
                    .filter((ef) => cls === 'all' || ef.itemClasses.includes(cls))
                    .map((ef, i) => (
                      <div key={i}>
                        <span className="muted">{ef.itemClasses.filter((c) => classes.includes(c)).map(className).join(', ') || ef.category}:</span>{' '}
                        {ef.modIds.length ? (
                          ef.modIds.map((id) => {
                            const m = ctx.modsById.get(id);
                            return m ? modText(ctx, m, lang).text : id;
                          }).join(lang === 'pt-BR' ? ' ou ' : ' or ')
                        ) : (
                          <>
                            {ef.text} <span className="badge warn">{t('set.essences.notModeled')}</span>
                          </>
                        )}
                      </div>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
