import { useMemo, useState } from 'react';
import { useCtx } from '../App';
import { CATEGORIES, modCategories } from '../components/pickers';
import { Card, ConfidenceBadge, FamilyText, SideTag, WeightsBanner } from '../components/ui';
import type { ModDef } from '../data/types';
import { familyKey, getBasePool, spawnFlag } from '../engine/context';
import { eligiblePool } from '../engine/item';
import { modText } from '../engine/text';
import { formatPct, useT } from '../i18n';
import { useClassName } from './BuilderPage';
import { useVisibleClasses } from '../store/dataset';
import { useStore } from '../store/store';

export function ModsPage() {
  const ctx = useCtx();
  const { t, lang } = useT();
  const className = useClassName();
  const [cls, setCls] = useState('Ring');
  const [baseId, setBaseId] = useState('');
  const [side, setSide] = useState<'all' | 'prefix' | 'suffix'>('all');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [openFam, setOpenFam] = useState<string | null>(null);

  const visible = useVisibleClasses(ctx.data);
  const classes = useMemo(() => [...visible].sort((a, b) => className(a).localeCompare(className(b))), [visible, className]);
  const showUnreleased = useStore((s) => s.settings.showUnreleased);
  const basesOfClass = ctx.data.bases.filter((b) => b.itemClass === cls && (showUnreleased || b.inGame !== false));

  // Categorias compatíveis por modificador (uma base qualquer da categoria aceita o mod).
  const classesByMod = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const mod of ctx.data.mods) {
      const s = new Set<string>();
      for (const b of ctx.data.bases) if (!s.has(b.itemClass) && spawnFlag(mod, b) > 0) s.add(b.itemClass);
      m.set(mod.id, s);
    }
    return m;
  }, [ctx]);

  const effectiveBase = baseId && ctx.basesById.get(baseId)?.itemClass === cls ? baseId : basesOfClass[0]?.id;
  const families = useMemo(() => {
    const fams = new Map<string, ModDef[]>();
    for (const m of ctx.data.mods) {
      if (m.essenceOnly || !classesByMod.get(m.id)?.has(cls)) continue;
      if (effectiveBase && baseId && !getBasePool(ctx, effectiveBase).byMod.has(m.id)) continue;
      const k = familyKey(m);
      if (!fams.has(k)) fams.set(k, []);
      fams.get(k)!.push(m);
    }
    const ql = q.trim().toLowerCase();
    return [...fams.entries()]
      .filter(([k, mods]) => (side === 'all' || k.startsWith(side)) && (cat === 'all' || modCategories(mods[0]).includes(cat)))
      .filter(([, mods]) => !ql || mods.some((m) => (m.text + ' ' + m.name + ' ' + m.id + ' ' + modText(ctx, m, lang).text).toLowerCase().includes(ql)))
      .map(([k, mods]) => [k, [...mods].sort((a, b) => b.level - a.level)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [ctx, cls, side, cat, q, lang, classesByMod, effectiveBase, baseId]);

  // Chance de cada mod num Exaltado sobre um raro vazio, nível 100, na base escolhida.
  const chance = useMemo(() => {
    if (!effectiveBase) return null;
    const pool = eligiblePool(ctx, { baseId: effectiveBase, ilvl: 100, rarity: 'rare', mods: [] }, { rarity: 'rare' });
    const map = new Map(pool.entries.map((e) => [e.entry.mod.id, pool.provenance.confidence === 'unavailable' ? null : e.weight / pool.total]));
    return { map, provenance: pool.provenance };
  }, [ctx, effectiveBase]);

  const nMods = families.reduce((s, [, m]) => s + m.length, 0);
  const greater = ctx.rules.currencies['greater-exalt']?.minModLevel;

  return (
    <div className="page">
      <h1>{t('mods.title')}</h1>
      <p className="lead">{t('mods.intro')}</p>
      <p className="small muted">{t('mods.sourceLine', { source: ctx.data.meta.source, version: ctx.data.meta.gameVersion })}</p>
      <WeightsBanner />
      <Card>
        <div className="filters">
          <label>
            {t('mods.filterClass')}{' '}
            <select value={cls} onChange={(e) => { setCls(e.target.value); setBaseId(''); }}>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {className(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('mods.filterBase')}{' '}
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {basesOfClass.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} aria-label={t('mods.filterSide')}>
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
          <input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="muted small">
          {t('mods.count', { n: families.length, m: nMods })}
          {chance && (
            <>
              {' • '}
              {t('mods.col.chance')} ({ctx.basesById.get(effectiveBase!)?.name}): <ConfidenceBadge prov={chance.provenance} />
            </>
          )}
        </p>
        <ul className="famlist">
          {families.map(([fam, mods]) => (
            <li key={fam} className={openFam === fam ? 'open' : ''}>
              <button className="fam-head" onClick={() => setOpenFam(openFam === fam ? null : fam)}>
                <SideTag gen={mods[0].gen} />
                <span className="modtext">
                  <FamilyText ctx={ctx} family={fam} />
                </span>
                <span className="muted">
                  {t('picker.tiers', { n: mods.length })} • {modCategories(mods[0]).map((c) => t(`cat.${c}`)).join(', ')}
                </span>
              </button>
              {openFam === fam && (
                <div className="fam-body">
                  <div className="table-wrap">
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>{t('common.tier')}</th>
                          <th>{t('mods.col.name')}</th>
                          <th>{t('mods.col.text')}</th>
                          <th>{t('mods.col.level')}</th>
                          <th>{t('mods.col.chance')}</th>
                          <th>{t('mods.idLabel')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mods.map((m, i) => {
                          const txt = modText(ctx, m, lang);
                          const c = chance?.map.get(m.id);
                          return (
                            <tr key={m.id}>
                              <td>T{i + 1}</td>
                              <td>{m.name}</td>
                              <td>
                                {txt.text}
                                {!txt.translated && (
                                  <span className="badge en" title={t('common.enTagTitle')}>
                                    {t('common.enTag')}
                                  </span>
                                )}
                                {lang === 'pt-BR' && txt.translated && <div className="muted small">{m.text}</div>}
                              </td>
                              <td className="num">{m.level}</td>
                              <td className="num">{c === undefined ? '—' : c === null ? t('conf.unavailable') : formatPct(c, lang)}</td>
                              <td className="mono small">{m.id}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="small">
                    <strong>{t('mods.col.group')}:</strong> {mods[0].groups.join(', ')} • <strong>{t('mods.classes')}:</strong>{' '}
                    {[...(classesByMod.get(mods[0].id) ?? [])].filter((c) => visible.includes(c)).map(className).join(', ')}
                  </p>
                  <p className="small">
                    <strong>{t('mods.methods')}:</strong> {t('mods.methods.list', { greater: greater != null && mods[0].level >= greater ? t('mods.greaterNote') : '' })}
                  </p>
                  <p className="small muted">{t('mods.sourceLine', { source: ctx.data.meta.source, version: ctx.data.meta.gameVersion })}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
