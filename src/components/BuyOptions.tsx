import { useCtx } from '../App';
import type { BuyOption } from '../engine/buy';
import type { TargetSpec } from '../engine/target';
import { useT } from '../i18n';
import { ModLabel } from './ui';

/** Recomendação: base mágica com os mods que valem a pena já ter para construir o item. */
export function BuyOptionCard({ target, option }: { target: TargetSpec; option: BuyOption }) {
  const ctx = useCtx();
  const { t } = useT();
  const base = ctx.basesById.get(target.baseId)!;
  return (
    <div className="buy-option">
      <p className="small">
        <strong>{t('buy.what', { base: base.name })}</strong>
      </p>
      <ul className="modlist">
        {option.modIds.map((id, i) => {
          const def = ctx.modsById.get(id)!;
          const min = option.minValues[i];
          return (
            <li key={id}>
              <span>
                <ModLabel ctx={ctx} mod={def} baseId={target.baseId} showName={false} />{' '}
                <span className="muted small">{min != null ? t('buy.minValue', { v: min }) : t('buy.orBetter')}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
