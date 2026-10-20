import type { ReactNode } from 'react';
import { useCtx } from '../App';
import { familyGen, getBasePool } from '../engine/context';
import type { ItemState } from '../engine/item';
import type { TargetSpec } from '../engine/target';
import { implicitText, modText } from '../engine/text';
import { useT } from '../i18n';
import { useClassName } from '../pages/BuilderPage';
import { FamilyText } from './ui';

/** Moldura no estilo da dica de item do jogo (cor do nome pela raridade). */
function Frame({ rarity, title, subtitle, children, footer }: { rarity: string; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={`item-tooltip rarity-${rarity}`}>
      <div className="it-header">
        <div className="it-name">{title}</div>
        {subtitle && <div className="it-sub">{subtitle}</div>}
      </div>
      <div className="it-body">{children}</div>
      {footer && <div className="it-footer">{footer}</div>}
    </div>
  );
}

/** Item real (atual do projeto): implícitos e modificadores com tier. */
export function ItemTooltip({ item, footer }: { item: ItemState; footer?: ReactNode }) {
  const ctx = useCtx();
  const { t, lang } = useT();
  const className = useClassName();
  const base = ctx.basesById.get(item.baseId);
  const pool = getBasePool(ctx, item.baseId);
  const mods = [...item.mods].sort((a, b) => (ctx.modsById.get(a.modId)?.gen === 'prefix' ? 0 : 1) - (ctx.modsById.get(b.modId)?.gen === 'prefix' ? 0 : 1));
  return (
    <Frame
      rarity={item.rarity}
      title={base?.name ?? item.baseId}
      subtitle={`${base ? className(base.itemClass) : ''} • ${t(`common.${item.rarity}`)} • ${t('common.ilvl')} ${item.ilvl}`}
      footer={footer}
    >
      {base && base.implicits.length > 0 && (
        <>
          {base.implicits.map((i) => (
            <div key={i} className="it-line implicit">
              {implicitText(ctx, i, lang).text}
            </div>
          ))}
          <div className="it-sep" />
        </>
      )}
      {mods.length === 0 ? (
        <div className="it-line muted">{t('item.empty')}</div>
      ) : (
        mods.map((m) => {
          const def = ctx.modsById.get(m.modId);
          if (!def) return null;
          const e = pool.byMod.get(m.modId);
          return (
            <div key={m.modId} className={`it-line mod ${def.desecrated || m.desecrated ? 'desecrated' : ''} ${m.fractured ? 'fractured' : ''}`}>
              <span className="it-text">{modText(ctx, def, lang, m.values).text}</span>
              <span className="it-tag">
                {def.gen === 'prefix' ? 'P' : 'S'}
                {e ? e.tier : ''}
              </span>
            </div>
          );
        })
      )}
    </Frame>
  );
}

/** Objetivo: famílias desejadas com o pior tier aceito. */
export function TargetTooltip({ target, met, footer }: { target: TargetSpec; met?: boolean[]; footer?: ReactNode }) {
  const ctx = useCtx();
  const { t, lang } = useT();
  const className = useClassName();
  const base = ctx.basesById.get(target.baseId);
  const order = target.requirements.map((r, i) => ({ r, i })).sort((a, b) => (familyGen(a.r.family) === 'prefix' ? 0 : 1) - (familyGen(b.r.family) === 'prefix' ? 0 : 1));
  return (
    <Frame
      rarity={target.rarity}
      title={base?.name ?? target.baseId}
      subtitle={`${base ? className(base.itemClass) : ''} • ${t(`common.${target.rarity}`)} • ${t('common.ilvl')} ${target.ilvl}`}
      footer={footer}
    >
      {base && base.implicits.length > 0 && (
        <>
          {base.implicits.map((i) => (
            <div key={i} className="it-line implicit">
              {implicitText(ctx, i, lang).text}
            </div>
          ))}
          <div className="it-sep" />
        </>
      )}
      {order.length === 0 ? (
        <div className="it-line muted">{t('builder.noMods')}</div>
      ) : (
        order.map(({ r, i }) => (
          <div key={r.id} className={`it-line mod ${r.family.endsWith('@abyss') ? 'desecrated' : ''} ${met ? (met[i] ? 'met' : 'missing') : ''} ${r.required ? '' : 'optional'}`}>
            {met && <span className="it-check">{met[i] ? '✓' : '○'}</span>}
            <span className="it-text">
              <FamilyText ctx={ctx} family={r.family} />
              {r.minValue != null && <span className="muted"> (≥ {r.minValue})</span>}
            </span>
            <span className="it-tag">
              {familyGen(r.family) === 'prefix' ? 'P' : 'S'} T{r.minTier}+
            </span>
          </div>
        ))
      )}
    </Frame>
  );
}
