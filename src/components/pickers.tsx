import { useMemo, useState } from 'react';
import type { ModDef } from '../data/types';
import { type ActionSpec, essenceEffectFor } from '../engine/actions';
import { type CraftContext, type PoolEntry, getBasePool } from '../engine/context';
import { type ItemState, type Rarity, openSides, takenGroups, validateItem } from '../engine/item';
import { modText } from '../engine/text';
import { useT } from '../i18n';
import { FamilyText, ModLabel } from './ui';

export const CATEGORIES = ['life', 'mana', 'defences', 'energy_shield', 'resistance', 'attribute', 'damage', 'attack', 'caster', 'speed', 'critical', 'minion', 'spirit', 'gem', 'abyss', 'other'] as const;

export function modCategories(m: ModDef): string[] {
  const out: string[] = CATEGORIES.filter((c) => m.tags.includes(c));
  if (/Spirit/i.test(m.type)) out.push('spirit');
  if (m.desecrated) out.unshift('abyss');
  return out.length ? out : ['other'];
}

interface PickerProps {
  ctx: CraftContext;
  baseId: string;
  ilvl: number;
  onClose: () => void;
}

/** Escolha de família de modificador (construtor de item). */
export function FamilyPicker({ ctx, baseId, ilvl, onClose, onPick, exclude }: PickerProps & { onPick: (family: string) => void; exclude: string[] }) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [side, setSide] = useState<'all' | 'prefix' | 'suffix'>('all');
  const [cat, setCat] = useState('all');
  const [onlyEligible, setOnlyEligible] = useState(true);
  const pool = getBasePool(ctx, baseId);
  const families = useMemo(() => {
    const out: { family: string; entries: PoolEntry[]; text: string; best: PoolEntry | undefined }[] = [];
    for (const [family, entries] of pool.byFamily) {
      const best = entries.find((e) => e.mod.level <= ilvl);
      const text = entries.map((e) => modText(ctx, e.mod, lang).text + ' ' + e.mod.text + ' ' + e.mod.name).join(' ').toLowerCase();
      out.push({ family, entries, text, best });
    }
    return out.sort((a, b) => a.family.localeCompare(b.family));
  }, [pool, ilvl, ctx, lang]);
  const ql = q.trim().toLowerCase();
  const shown = families.filter(
    (f) =>
      !exclude.includes(f.family) &&
      (side === 'all' || f.family.startsWith(side)) &&
      (cat === 'all' || modCategories(f.entries[0].mod).includes(cat)) &&
      (!onlyEligible || f.best) &&
      (!ql || f.text.includes(ql)),
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('picker.title')}>
        <header className="card-head">
          <h2>{t('picker.title')}</h2>
          <button className="ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <div className="filters">
          <input autoFocus placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} aria-label={t('picker.side')}>
            <option value="all">{t('common.all')}</option>
            <option value="prefix">{t('common.prefixes')}</option>
            <option value="suffix">{t('common.suffixes')}</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('picker.category')}>
            <option value="all">{t('picker.category')}: {t('common.all')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`cat.${c}`)}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} /> {t('picker.onlyEligible')}
          </label>
        </div>
        <ul className="picklist">
          {shown.length === 0 && <li className="empty">{t('picker.empty')}</li>}
          {shown.map((f) => (
            <li key={f.family}>
              <button className="pick" onClick={() => onPick(f.family)}>
                <span className={`side side-${f.family.split(':')[0]}`}>{f.family.startsWith('prefix') ? t('common.prefix') : t('common.suffix')}</span>
                <span className="modtext">
                  <FamilyText ctx={ctx} family={f.family} />
                  {f.entries[0].mod.desecrated && (
                    <span className="badge abyss">⛧ {f.entries[0].mod.lord ? t(`lord.${f.entries[0].mod.lord}`) : t('mod.abyss')}</span>
                  )}
                  {f.entries[0].kind === 'essence' && <span className="badge">{t('calc.essence')}</span>}
                </span>
                <span className="muted">
                  {t('picker.tiers', { n: f.entries.length })}
                  {f.best ? ` • T${f.best.tier} @ ilvl ${ilvl}` : ` • ${t('common.level')} ≥ ${f.entries[f.entries.length - 1].mod.level}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Escolha de modificador específico possível no item (editor de item / registro de resultado). */
export function ModPicker({ ctx, item, rarity, onClose, onPick }: { ctx: CraftContext; item: ItemState; rarity: Rarity; onClose: () => void; onPick: (modId: string) => void }) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const pool = getBasePool(ctx, item.baseId);
  const open = openSides(ctx, item, rarity);
  const groups = takenGroups(ctx, item);
  const ql = q.trim().toLowerCase();
  const list = pool.entries.filter(
    (e) =>
      e.mod.level <= item.ilvl &&
      open.includes(e.mod.gen) &&
      !e.mod.groups.some((g) => groups.has(g)) &&
      (!ql || (modText(ctx, e.mod, lang).text + ' ' + e.mod.text + ' ' + e.mod.name + ' ' + e.mod.id).toLowerCase().includes(ql)),
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('picker.title')}>
        <header className="card-head">
          <h2>{t('picker.title')}</h2>
          <button className="ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <div className="filters">
          <input autoFocus placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="picklist">
          {list.length === 0 && <li className="empty">{t('picker.empty')}</li>}
          {list.slice(0, 300).map((e) => (
            <li key={e.mod.id}>
              <button className="pick" onClick={() => onPick(e.mod.id)}>
                <ModLabel ctx={ctx} mod={e.mod} baseId={item.baseId} />
                <span className="muted">
                  {t('common.level')} {e.mod.level}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Editor de item: raridade + modificadores reais (com valores opcionais). */
export function ItemEditor({ ctx, item, onChange, showIssues = true }: { ctx: CraftContext; item: ItemState; onChange: (it: ItemState) => void; showIssues?: boolean }) {
  const { t } = useT();
  const [picking, setPicking] = useState(false);
  const issues = validateItem(ctx, item);
  return (
    <div className="item-editor">
      <div className="row wrap">
        <label>
          {t('item.rarity')}{' '}
          <select
            value={item.rarity}
            onChange={(e) => {
              const rarity = e.target.value as Rarity;
              onChange({ ...item, rarity, mods: rarity === 'normal' ? [] : item.mods });
            }}
          >
            <option value="normal">{t('common.normal')}</option>
            <option value="magic">{t('common.magic')}</option>
            <option value="rare">{t('common.rare')}</option>
          </select>
        </label>
        <label>
          {t('common.ilvl')}{' '}
          <input type="number" min={1} max={100} value={item.ilvl} onChange={(e) => onChange({ ...item, ilvl: Number(e.target.value) || 1 })} style={{ width: '5em' }} />
        </label>
        <button disabled={item.rarity === 'normal' || openSides(ctx, item).length === 0} onClick={() => setPicking(true)}>
          + {t('item.addMod')}
        </button>
      </div>
      {item.mods.length === 0 ? (
        <p className="muted">{t('item.empty')}</p>
      ) : (
        <ul className="modlist">
          {item.mods.map((m, i) => {
            const def = ctx.modsById.get(m.modId);
            if (!def) return <li key={i}>{m.modId}</li>;
            return (
              <li key={m.modId}>
                <ModLabel ctx={ctx} mod={def} baseId={item.baseId} fractured={m.fractured} values={m.values} />
                <span className="row">
                  <input
                    type="number"
                    className="value-input"
                    placeholder={t('item.value')}
                    title={`${def.stats[0]?.min ?? ''}–${def.stats[0]?.max ?? ''}`}
                    value={m.values?.[0] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value);
                      const mods = item.mods.map((x, j) => (j === i ? { ...x, values: v === undefined ? undefined : [v, ...(x.values?.slice(1) ?? def.stats.slice(1).map((s) => s.max))] } : x));
                      onChange({ ...item, mods });
                    }}
                  />
                  {!def.desecrated && item.rarity === 'rare' && (
                    <label className="check small">
                      <input type="checkbox" checked={!!m.desecrated} onChange={(e) => onChange({ ...item, mods: item.mods.map((x, j) => (j === i ? { ...x, desecrated: e.target.checked || undefined } : x)) })} />
                      {t('item.desecrated')}
                    </label>
                  )}
                  <label className="check small">
                    <input type="checkbox" checked={!!m.fractured} onChange={(e) => onChange({ ...item, mods: item.mods.map((x, j) => (j === i ? { ...x, fractured: e.target.checked } : x)) })} />
                    {t('item.fractured')}
                  </label>
                  <button className="ghost danger" onClick={() => onChange({ ...item, mods: item.mods.filter((_, j) => j !== i) })} aria-label={t('common.remove')}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {showIssues && issues.length > 0 && (
        <div className="banner error small">
          {t('item.issues')}
          <ul>
            {issues.map((i, k) => (
              <li key={k}>{t(i.key, i.params)}</li>
            ))}
          </ul>
        </div>
      )}
      {picking && (
        <ModPicker
          ctx={ctx}
          item={item}
          rarity={item.rarity}
          onClose={() => setPicking(false)}
          onPick={(modId) => {
            onChange({ ...item, mods: [...item.mods, { modId }] });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** Seleção de ação (moeda + presságios ou essência). */
export function ActionPicker({ ctx, value, onChange, baseId }: { ctx: CraftContext; value: ActionSpec; onChange: (s: ActionSpec) => void; baseId?: string }) {
  const { t, lang } = useT();
  const currencies = Object.values(ctx.rules.currencies);
  const essences = baseId ? ctx.essences.filter((e) => essenceEffectFor(ctx, e, baseId)) : ctx.essences;
  const cur = ctx.rules.currencies[value.currency];
  const omens = Object.values(ctx.rules.omens).filter((o) => cur && o.appliesTo === cur.kind);
  return (
    <div className="row wrap">
      <label>
        {t('calc.currency')}{' '}
        <select value={value.currency} onChange={(e) => onChange({ currency: e.target.value, essenceId: e.target.value === 'essence' ? essences[0]?.id : undefined })}>
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>
              {lang === 'pt-BR' ? `${c.namePt} (${c.nameEn})` : c.nameEn}
              {c.minModLevel === null ? ' ⚠' : ''}
            </option>
          ))}
          {essences.length > 0 && <option value="essence">{t('calc.essence')}</option>}
        </select>
      </label>
      {value.currency === 'essence' && (
        <select value={value.essenceId} onChange={(e) => onChange({ ...value, essenceId: e.target.value })}>
          {essences.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nameEn}
            </option>
          ))}
        </select>
      )}
      {omens.length > 0 && (
        <fieldset className="omens">
          <legend>{t('calc.omens')}</legend>
          {omens.map((o) => (
            <label key={o.id} className="check small">
              <input
                type="checkbox"
                checked={value.omens?.includes(o.id) ?? false}
                onChange={(e) => {
                  const set = new Set(value.omens ?? []);
                  if (e.target.checked) set.add(o.id);
                  else set.delete(o.id);
                  onChange({ ...value, omens: [...set] });
                }}
              />
              {lang === 'pt-BR' ? o.namePt : o.nameEn}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
