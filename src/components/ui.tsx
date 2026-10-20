import { type ReactNode, useState } from 'react';
import type { WeightHypothesis, WeightTable } from '../engine/context';
import type { ModDef, Provenance } from '../data/types';
import { type CraftContext, familyKey, getBasePool } from '../engine/context';
import type { PriceBook } from '../engine/cost';
import type { ProbResult } from '../engine/probability';
import { BASE_MATERIAL, BUY_MATERIAL } from '../engine/simulate';
import type { Strategy } from '../engine/strategies';
import { type TargetIssue, type TargetSpec, familyLabel } from '../engine/target';
import { type Lang, familyText, modText } from '../engine/text';
import { essenceById } from '../engine/actions';
import { formatNum, formatPct, useT } from '../i18n';
import { getState, updateSettings, useStore } from '../store/store';
import { Link } from 'react-router-dom';

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function ConfidenceBadge({ prov, compact }: { prov: Provenance; compact?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const c = prov.confidence;
  return (
    <span className="conf-wrap">
      <button type="button" className={`badge conf-${c}`} title={t(`conf.${c}.help`)} onClick={() => setOpen(!open)}>
        {t(`conf.${c}`)}
        {prov.assumptions.length > 0 && !compact ? ' ⓘ' : ''}
      </button>
      {open && prov.assumptions.length > 0 && (
        <ul className="assumptions">
          {prov.assumptions.map((a) => (
            <li key={a}>{t(a)}</li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function Prob({ r, big }: { r: ProbResult; big?: boolean }) {
  const { t, lang } = useT();
  return (
    <span className={`prob ${big ? 'big' : ''}`}>
      <strong>{r.value == null ? '—' : formatPct(r.value, lang)}</strong>
      {r.ci && (
        <small className="muted"> {t('sim.ci', { lo: formatPct(r.ci[0], lang), hi: formatPct(r.ci[1], lang) })}</small>
      )}
      <ConfidenceBadge prov={r.provenance} />
      {r.method !== 'none' && <small className="muted method">{t(`method.${r.method}`)}</small>}
      {r.noteKey && <small className="muted"> {t(r.noteKey)}</small>}
    </span>
  );
}

export function SideTag({ gen }: { gen: 'prefix' | 'suffix' }) {
  const { t } = useT();
  return <span className={`side side-${gen}`}>{gen === 'prefix' ? t('common.prefix') : t('common.suffix')}</span>;
}

export function ModLabel({ ctx, mod, values, baseId, fractured, showName = true }: { ctx: CraftContext; mod: ModDef; values?: number[]; baseId?: string; fractured?: boolean; showName?: boolean }) {
  const { t, lang } = useT();
  const txt = modText(ctx, mod, lang, values);
  const entry = baseId ? getBasePool(ctx, baseId).byMod.get(mod.id) : undefined;
  return (
    <span className={`modlabel ${fractured ? 'fractured' : ''}`}>
      <SideTag gen={mod.gen} />
      {entry && <span className="tier">T{entry.tier}</span>}
      <span className="modtext">{txt.text}</span>
      {!txt.translated && (
        <span className="badge en" title={t('common.enTagTitle')}>
          {t('common.enTag')}
        </span>
      )}
      {showName && mod.name && <span className="muted modname">“{mod.name}”</span>}
      {fractured && <span className="badge frac">{t('item.fractured')}</span>}
      {mod.desecrated && (
        <span className="badge abyss" title={t('mod.abyss')}>
          ⛧ {mod.lord ? t(`lord.${mod.lord}`) : t('mod.abyss')}
        </span>
      )}
    </span>
  );
}

export function FamilyText({ ctx, family }: { ctx: CraftContext; family: string }) {
  const { lang } = useT();
  return <>{familyText(ctx, family, lang) || familyLabel(ctx, family)}</>;
}

/** Mensagem de validação com nomes de modificador no idioma do jogador. */
export function issueText(ctx: CraftContext, t: (k: string, p?: Record<string, string | number>) => string, lang: Lang, issue: TargetIssue): string {
  const params = { ...(issue.params ?? {}) };
  for (const [k, fam] of Object.entries(issue.families ?? {})) params[k] = familyText(ctx, fam, lang);
  return t(issue.key, params);
}

export function WeightsBanner() {
  const { t } = useT();
  const hyp = useStore((s) => s.settings.hypothesis);
  const table = useStore((s) => s.weightTable);
  if (hyp.kind !== 'none' || table) return <WeightsStatus />;
  return (
    <div className="banner warn">
      <strong>{t('weights.banner.title')}</strong>
      <p>{t('weights.banner.body')}</p>
      <div className="row wrap">
        <button onClick={() => updateSettings({ hypothesis: { kind: 'uniform' } })}>{t('weights.banner.useUniform')}</button>
        <button onClick={() => updateSettings({ hypothesis: { kind: 'tierDecay', factor: 0.7 } })}>{t('weights.banner.useDecay')}</button>
        <Link className="button ghost" to="/settings#weights">
          {t('weights.banner.import')}
        </Link>
      </div>
    </div>
  );
}

export function weightsDescription(t: (k: string, p?: Record<string, string | number>) => string, hyp: WeightHypothesis, table: WeightTable | null): string {
  const hypDesc = hyp.kind === 'uniform' ? t('weights.desc.uniform') : hyp.kind === 'tierDecay' ? t('weights.desc.tierDecay', { factor: hyp.factor }) : t('weights.desc.none');
  if (!table) return hypDesc;
  const extra = hyp.kind === 'none' ? '' : t('weights.desc.tableFallback', { hyp: hypDesc });
  return t('weights.desc.table', { source: table.source, n: Object.keys(table.weights).length, extra });
}

export function WeightsStatus() {
  const { t } = useT();
  const hyp = useStore((s) => s.settings.hypothesis);
  const table = useStore((s) => s.weightTable);
  return (
    <div className="banner info small">
      {t('weights.active', { desc: weightsDescription(t, hyp, table) })}{' '}
      <Link to="/settings#weights">{t('nav.settings')}</Link>
    </div>
  );
}

export function strategyLabel(ctx: CraftContext, s: Strategy, t: (k: string, p?: Record<string, string | number>) => string): string {
  let base = s.kind === 'essenceExalt' ? t('strat.essenceExalt', { essence: essenceById(ctx, s.params.essenceId)?.nameEn ?? '?' }) : t(`strat.${s.kind}`);
  if (s.params.buy) base = t('strat.buy', { mods: buyLabel(ctx, s.params.buy) });
  const opts: string[] = [];
  if (s.params.grade !== 'normal') opts.push(t(`strat.opt.grade.${s.params.grade}`));
  if (s.params.sideOmens && s.kind !== 'alchemyChaos') opts.push(t('strat.opt.omens'));
  if (s.kind !== 'alchemyChaos') opts.push(t(s.params.recovery === 'annul' ? 'strat.opt.annul' : 'strat.opt.restart'));
  if (s.params.desecrate === 'last') opts.push(t('strat.opt.desecrateLast'));
  if (s.params.echoes) opts.push(t('strat.opt.echoes'));
  if (s.params.bone === 'perfect') opts.push(t('strat.opt.bone.perfect'));
  return opts.length ? `${base} (${opts.join(', ')})` : base;
}

export function strategySteps(ctx: CraftContext, s: Strategy, tl: (k: string, p?: Record<string, string | number>) => string[], t: (k: string, p?: Record<string, string | number>) => string, needsAbyss = false): string[] {
  const omens = s.params.sideOmens ? ` (+ ${t('strat.opt.omens')})` : '';
  const recovery = t(`strat.recovery.${s.params.recovery}`);
  const grade = s.params.grade !== 'normal' ? ` (${t(`strat.opt.grade.${s.params.grade}`)})` : '';
  const e = essenceById(ctx, s.params.essenceId);
  const extra = needsAbyss || s.params.desecrate === 'last' || s.params.echoes || s.params.bone ? [t('strat.step.desecrate')] : [];
  const steps = tl(`strat.steps.${s.kind}`, {
    omens: omens + grade,
    coronation: s.params.sideOmens ? ` (+ ${t('strat.opt.omens')})` : '',
    recovery,
    grade,
    max: s.params.maxActions,
    mode: e ? t(`set.essences.mode.${e.mode}`) : '?',
  });
  // Compra: os dois primeiros passos (transmutar e descartar) viram "comprar o item mágico".
  if (s.params.buy) return [t('strat.step.buy', { mods: buyLabel(ctx, s.params.buy) }), ...steps.slice(2), ...extra];
  return [...steps, ...extra];
}

/** Mods do item a comprar, no idioma atual (a chave da opção traz os ids dos mods). */
export function buyLabel(ctx: CraftContext, key: string): string {
  const lang = getState().settings.lang;
  return (key.split('|')[1]?.split('+') ?? [])
    .map((id) => ctx.modsById.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => familyText(ctx, familyKey(m), lang))
    .join(' + ');
}

export function materialName(name: string, ctx: CraftContext, lang: string): string {
  if (name === BASE_MATERIAL) return lang === 'pt-BR' ? 'Base nova' : 'New base';
  if (name === BUY_MATERIAL) return lang === 'pt-BR' ? 'Base mágica (com os mods recomendados)' : 'Magic base (with recommended mods)';
  if (lang !== 'pt-BR') return name;
  const c = Object.values(ctx.rules.currencies).find((x) => x.nameEn === name);
  if (c) return `${c.namePt} (${name})`;
  const o = Object.values(ctx.rules.omens).find((x) => x.nameEn === name);
  if (o) return `${o.namePt} (${name})`;
  return name;
}

export function MaterialsTable({ ctx, usage, book, baseCost, buyCost = null }: { ctx: CraftContext; usage: Record<string, number>; book: PriceBook | null; baseCost: number | null; buyCost?: number | null }) {
  const { t, lang } = useT();
  const rows = Object.entries(usage).filter(([, q]) => q > 0);
  return (
    <table className="table compact">
      <tbody>
        {rows.map(([name, q]) => {
          const price = name === BASE_MATERIAL ? baseCost : name === BUY_MATERIAL ? buyCost : book?.entries[name]?.value ?? null;
          return (
            <tr key={name}>
              <td>{materialName(name, ctx, lang)}</td>
              <td className="num">{formatNum(q, lang)}</td>
              <td className="num muted">{price == null ? t('common.notSet') : `${formatNum(price * q, lang)} ${t('common.exalted')}`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function TargetSummary({ ctx, target }: { ctx: CraftContext; target: TargetSpec }) {
  const { t } = useT();
  const base = ctx.basesById.get(target.baseId);
  return (
    <div className="target-summary">
      <div>
        <strong>{base?.name}</strong> • {t('common.ilvl')} {target.ilvl} • {t(`common.${target.rarity}`)}
      </div>
      <ul>
        {target.requirements.map((r) => (
          <li key={r.id}>
            <span className={`side side-${r.family.split(':')[0]}`}>{r.family.startsWith('prefix') ? 'P' : 'S'}</span> <FamilyText ctx={ctx} family={r.family} /> — T{r.minTier}+
            {r.minValue != null ? ` (≥ ${r.minValue})` : ''} {r.required ? <span className="badge req">{t('common.required')}</span> : <span className="badge opt">{t('common.optional')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
