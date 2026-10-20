import { useMemo, useState } from 'react';
import { useCtx } from '../App';
import { type ActionSpec, actionLabel } from '../engine/actions';
import type { PriceBook } from '../engine/cost';
import type { ItemState } from '../engine/item';
import { stepOptions, usefulOptions } from '../engine/stepOptions';
import type { TargetSpec } from '../engine/target';
import { formatNum, formatPct, useT } from '../i18n';

/** Nome curto (só no idioma escolhido) para caber na tabela. */
function shortLabel(ctx: ReturnType<typeof useCtx>, s: ActionSpec, lang: string): string {
  if (s.currency === 'essence') return actionLabel(ctx, s, lang as 'pt-BR' | 'en');
  const r = ctx.rules.currencies[s.currency];
  const name = r ? (lang === 'pt-BR' ? r.namePt : r.nameEn) : s.currency;
  const omens = (s.omens ?? []).map((id) => ctx.rules.omens[id]).filter(Boolean).map((o) => (lang === 'pt-BR' ? o.namePt : o.nameEn));
  return [name, ...omens].join(' + ');
}

const specKey = (s: ActionSpec) => `${s.currency}|${s.essenceId ?? ''}|${[...(s.omens ?? [])].sort().join(',')}`;

/**
 * Quadro "Opções para esta etapa": a ação recomendada e as variações com presságios e versões
 * Greater/Perfect, com a chance de melhorar o item e o custo de cada uma, mais o que cada item faz.
 */
export function StepOptions({ item, target, spec, book, selected, onSelect }: { item: ItemState; target: TargetSpec; spec: ActionSpec; book: PriceBook | null; selected: ActionSpec | null; onSelect: (s: ActionSpec | null) => void }) {
  const ctx = useCtx();
  const { t, lang } = useT();
  const all = useMemo(() => stepOptions(ctx, item, target, spec, book), [ctx, item, target, spec, book]);
  const useful = useMemo(() => usefulOptions(all), [all]);
  const [showAll, setShowAll] = useState(false);
  const options = showAll ? all : useful;
  if (all.length < 2) return null;
  const bestImproves = Math.max(...options.map((o) => o.improves ?? 0));
  const priced = options.filter((o) => o.cost != null && o.improves);
  const bestValue = priced.length ? priced.reduce((a, b) => (a.cost! / a.improves! <= b.cost! / b.improves! ? a : b)) : null;
  const chosenKey = selected ? specKey(selected) : specKey(spec);

  // Explicação de cada presságio e versão que aparece na tabela.
  const omenIds = [...new Set(options.flatMap((o) => o.spec.omens ?? []))];
  const graded = [...new Set(options.map((o) => o.spec.currency))]
    .map((id) => ctx.rules.currencies[id])
    .filter((r) => r && r.grade !== 'normal' && r.minModLevel);

  return (
    <details className="step-options" open>
      <summary>
        <strong>🔮 {t('opt.title')}</strong> <span className="small muted">{t('opt.subtitle')}</span>
      </summary>
      <div className="table-wrap">
        <table className="table compact opt-table">
          <thead>
            <tr>
              <th>{t('opt.col.action')}</th>
              <th>{t('opt.col.improves')}</th>
              <th>{t('opt.col.keeps')}</th>
              <th>{t('opt.col.cost')}</th>
              <th>{t('opt.col.costPer')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {options.map((o) => {
              const k = specKey(o.spec);
              const tags = [o.recommended && t('opt.tag.recommended'), o.improves != null && o.improves === bestImproves && bestImproves > 0 && t('opt.tag.bestChance'), bestValue === o && t('opt.tag.bestValue')].filter(Boolean);
              return (
                <tr key={k} className={k === chosenKey ? 'selected' : ''}>
                  <td className="opt-action">
                    {shortLabel(ctx, o.spec, lang)}
                    {tags.length > 0 && <div className="small accent">{tags.join(' • ')}</div>}
                  </td>
                  <td className="num">
                    {o.improves == null ? '—' : formatPct(o.improves, lang)}
                    {o.sampled && <small className="muted" title={t('opt.sampledHint')}> ≈</small>}
                  </td>
                  <td className="num">{o.keepsPossible == null ? '—' : formatPct(o.keepsPossible, lang)}</td>
                  <td className="num" title={o.missingPrices.length ? t('opt.missingPrice', { items: o.missingPrices.join(', ') }) : undefined}>
                    {o.cost == null ? '—' : `${formatNum(o.cost, lang)} ex`}
                  </td>
                  <td className="num">{o.cost != null && o.improves ? `${formatNum(o.cost / o.improves, lang)} ex` : '—'}</td>
                  <td>
                    <button className={k === chosenKey ? 'primary small' : 'ghost small'} onClick={() => onSelect(o.recommended ? null : o.spec)}>
                      {k === chosenKey ? t('opt.using') : t('opt.use')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {useful.length < all.length && (
        <button className="ghost small" onClick={() => setShowAll(!showAll)}>
          {showAll ? t('opt.showUseful') : t('opt.showAll', { n: all.length - useful.length })}
        </button>
      )}
      <p className="small muted">{t('opt.help')}</p>
      {(omenIds.length > 0 || graded.length > 0) && (
        <ul className="small opt-legend">
          {graded.map((r) => (
            <li key={r!.id}>
              <strong>{lang === 'pt-BR' ? r!.namePt : r!.nameEn}</strong>: {t('opt.grade', { level: r!.minModLevel! })}
            </li>
          ))}
          {omenIds.map((id) => {
            const o = ctx.rules.omens[id];
            return o ? (
              <li key={id}>
                <strong>{lang === 'pt-BR' ? o.namePt : o.nameEn}</strong>: {t(`omen.effect.${o.effect.kind}`, 'side' in o.effect ? { side: t(`opt.side.${o.effect.side}`) } : {})}
              </li>
            ) : null;
          })}
        </ul>
      )}
    </details>
  );
}
