import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCtx } from '../App';
import { FamilyPicker } from '../components/pickers';
import { Card, FamilyText, SideTag, issueText } from '../components/ui';
import { TargetTooltip } from '../components/ItemTooltip';
import { implicitText } from '../engine/text';
import { useVisibleClasses } from '../store/dataset';
import { getBasePool, familyGen } from '../engine/context';
import { createProject, uid } from '../engine/project';
import { limitsFor } from '../engine/item';
import { type Requirement, type TargetSpec, validateTarget } from '../engine/target';
import { useT } from '../i18n';
import { setDraft, updateSettings, upsertProject, useStore } from '../store/store';

export const CLASS_PT: Record<string, string> = {
  Amulet: 'Amuleto', Ring: 'Anel', Belt: 'Cinto', Helmet: 'Capacete', 'Body Armour': 'Armadura de corpo', Gloves: 'Luvas', Boots: 'Botas',
  Shield: 'Escudo', Buckler: 'Broquel', Focus: 'Foco', Quiver: 'Aljava', 'One Hand Sword': 'Espada de uma mão', 'Two Hand Sword': 'Espada de duas mãos',
  'One Hand Axe': 'Machado de uma mão', 'Two Hand Axe': 'Machado de duas mãos', 'One Hand Mace': 'Maça de uma mão', 'Two Hand Mace': 'Maça de duas mãos',
  Spear: 'Lança', Claw: 'Garra', Dagger: 'Adaga', Flail: 'Mangual', Warstaff: 'Bordão', Wand: 'Varinha', Staff: 'Cajado', Sceptre: 'Cetro',
  Bow: 'Arco', Crossbow: 'Besta', Talisman: 'Talismã',
};

/** Nome exibido no jogo em inglês quando difere do nome interno da classe. */
const CLASS_EN: Record<string, string> = { Warstaff: 'Quarterstaff' };

export const CLASS_GROUPS: { key: string; classes: string[] }[] = [
  { key: 'jewellery', classes: ['Amulet', 'Ring', 'Belt'] },
  { key: 'armour', classes: ['Helmet', 'Body Armour', 'Gloves', 'Boots'] },
  { key: 'offhand', classes: ['Shield', 'Buckler', 'Focus', 'Quiver'] },
  { key: 'weapon', classes: [] },
];

export function useClassName() {
  const { lang } = useT();
  return (c: string) => (lang === 'pt-BR' ? CLASS_PT[c] ?? c : CLASS_EN[c] ?? c);
}

/** Atributos de defesa da base (pelas tags do jogo: str_armour, dex_int_armour…). */
function baseAttributes(tags: string[]): string[] {
  const t = tags.find((x) => /^(str|dex|int)(_(str|dex|int))*_armour$/.test(x) || /^(str|dex|int)(_(dex|int))*_shield$/.test(x));
  return t ? t.split('_').filter((x) => ['str', 'dex', 'int'].includes(x)) : [];
}

function propRange(v: unknown): string | null {
  if (v && typeof v === 'object' && 'min' in v && 'max' in v) {
    const r = v as { min: number; max: number };
    return r.min === r.max ? String(r.min) : `${r.min}-${r.max}`;
  }
  return null;
}

export function BuilderPage() {
  const ctx = useCtx();
  const { t, tl, lang } = useT();
  const className = useClassName();
  const nav = useNavigate();
  const guideDismissed = useStore((s) => s.settings.guideDismissed);
  const draft = useStore((s) => s.draft);
  const projects = useStore((s) => s.projects);
  const showUnreleased = useStore((s) => s.settings.showUnreleased);
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const editing = projects.find((p) => p.id === draft.editingProjectId) ?? null;

  const visible = useVisibleClasses(ctx.data);
  const groups = useMemo(() => {
    const known = new Set(CLASS_GROUPS.flatMap((g) => g.classes));
    return CLASS_GROUPS.map((g) => ({
      key: g.key,
      classes: (g.classes.length ? g.classes.filter((c) => visible.includes(c)) : visible.filter((c) => !known.has(c))).sort((a, b) => className(a).localeCompare(className(b))),
    })).filter((g) => g.classes.length);
  }, [visible, className]);
  const bases = ctx.data.bases.filter(
    (b) => b.itemClass === draft.itemClass && (showUnreleased || b.inGame !== false) && (!q || b.name.toLowerCase().includes(q.toLowerCase())),
  );
  const target = draft.target;
  const base = target ? ctx.basesById.get(target.baseId) : undefined;

  const setTarget = (patch: Partial<TargetSpec>) => {
    if (!target) return;
    setDraft({ target: { ...target, ...patch } });
  };
  const setReq = (id: string, patch: Partial<Requirement>) => setTarget({ requirements: target!.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const issues = target ? validateTarget(ctx, target) : [];
  const errors = issues.filter((i) => i.severity === 'error');
  const pool = target ? getBasePool(ctx, target.baseId) : null;
  const eligibleCount = pool && target ? pool.entries.filter((e) => e.mod.level <= target.ilvl).length : 0;
  const req = target?.requirements.filter((r) => r.required) ?? [];
  const lim = target ? limitsFor(ctx, target.rarity, target.baseId) : { prefix: 0, suffix: 0 };

  function save() {
    if (!target || errors.length) return;
    const name = draft.name.trim() || `${base?.name ?? ''} ${new Date().toLocaleDateString()}`;
    if (editing) {
      upsertProject({ ...editing, name, target, item: editing.attempts.length ? editing.item : { ...editing.item, baseId: target.baseId, ilvl: target.ilvl }, updatedAt: new Date().toISOString() });
      setDraft({ editingProjectId: null });
      nav(`/projects/${editing.id}`);
    } else {
      const p = createProject(name, target);
      upsertProject(p);
      nav(`/projects/${p.id}`);
    }
  }
  const nPrefix = req.filter((r) => familyGen(r.family) === 'prefix').length;
  const nSuffix = req.filter((r) => familyGen(r.family) === 'suffix').length;
  // Etapa atual do fluxo (para a barra de progresso no topo).
  const stage = !target ? 2 : target.requirements.length === 0 ? 4 : 5;
  const stages = ['builder.stage.class', 'builder.stage.base', 'builder.stage.level', 'builder.stage.mods', 'builder.stage.review'];
  const slots = (n: number, max: number, side: 'prefix' | 'suffix') => (
    <span className="slots">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`slot ${side} ${i < n ? 'on' : ''}`} />
      ))}
    </span>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('builder.title')}</h1>
          <p className="lead">{t('builder.intro')}</p>
        </div>
        {guideDismissed && (
          <button className="ghost" onClick={() => updateSettings({ guideDismissed: false })}>
            ❔ {t('guide.title')}
          </button>
        )}
      </div>

      <ol className="stepper">
        {stages.map((k, i) => (
          <li key={k} className={i + 1 < stage ? 'done' : i + 1 === stage ? 'current' : ''}>
            <span className="dot">{i + 1 < stage ? '✓' : i + 1}</span>
            {t(k)}
          </li>
        ))}
      </ol>

      {!guideDismissed && (
        <Card
          title={t('guide.title')}
          className="guide"
          actions={
            <button className="ghost" onClick={() => updateSettings({ guideDismissed: true })}>
              {t('common.close')}
            </button>
          }
        >
          <ol>
            {tl('guide.steps').map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Card>
      )}
      {editing && (
        <div className="banner info small">
          {t('builder.editing', { name: editing.name })}{' '}
          <button className="ghost" onClick={() => setDraft({ editingProjectId: null })}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      <div className={target && base ? 'builder-layout' : ''}>
        <div>
          <div className="grid two">
            <Card title={<><span className="step-badge">1</span>{t('builder.stage.class')}</>}>
              {groups.map((g) => (
                <div key={g.key} className="class-group">
                  <h4>{t(`builder.group.${g.key}`)}</h4>
                  <div className="chips">
                    {g.classes.map((c) => (
                      <button
                        key={c}
                        className={c === draft.itemClass ? 'chip active' : 'chip'}
                        onClick={() => {
                          setDraft({ itemClass: c });
                          setQ('');
                        }}
                      >
                        {className(c)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!showUnreleased && <p className="small muted">{t('builder.unreleasedHidden')}</p>}
            </Card>
            <Card title={<><span className="step-badge">2</span>{t('builder.stage.base')}</>}>
              <input placeholder={t('builder.searchBase')} value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="baselist">
                {bases.map((b) => (
                  <li key={b.id}>
                    <button
                      className={target?.baseId === b.id ? 'pick active' : 'pick'}
                      onClick={() =>
                        setDraft({
                          target: {
                            baseId: b.id,
                            ilvl: target?.ilvl ?? 82,
                            rarity: target?.rarity ?? 'rare',
                            // Mantém só requisitos que existem na nova base.
                            requirements: (target?.requirements ?? []).filter((r) => getBasePool(ctx, b.id).byFamily.has(r.family)),
                          },
                        })
                      }
                    >
                      <span>
                        <strong>{b.name}</strong>{' '}
                        {baseAttributes(b.tags).map((a) => (
                          <span key={a} className={`attr attr-${a}`}>
                            {t(`attr.${a}`)}
                          </span>
                        ))}
                        {b.inGame === false && <span className="badge warn">{t('builder.notInGame')}</span>}
                      </span>
                      <span className="muted small">
                        {t('builder.dropLevel', { n: b.dropLevel })}
                        {(['armour', 'evasion', 'energy_shield', 'ward'] as const).map((p) => {
                          const v = propRange(b.properties[p]);
                          return v ? ` • ${t(`prop.${p}`)} ${v}` : '';
                        })}
                        {b.implicits.length ? ' • ' + b.implicits.map((i) => implicitText(ctx, i, lang).text).join(' / ') : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {target && base && (
            <>
              <Card title={<><span className="step-badge">3</span>{t('builder.stage.level')}</>}>
                <div className="row wrap">
                  <label>
                    {t('common.ilvl')}{' '}
                    <input type="number" min={1} max={100} value={target.ilvl} onChange={(e) => setTarget({ ilvl: Math.round(Number(e.target.value)) || 1 })} style={{ width: '6em' }} />
                  </label>
                  <div className="segmented" role="tablist" aria-label={t('builder.targetRarity')}>
                    {(['magic', 'rare'] as const).map((r) => (
                      <button key={r} role="tab" aria-selected={target.rarity === r} className={target.rarity === r ? 'active' : ''} onClick={() => setTarget({ rarity: r })}>
                        {t(`common.${r}`)}
                      </button>
                    ))}
                  </div>
                  <span className="muted small">{t('builder.availableMods', { n: eligibleCount, ilvl: target.ilvl })}</span>
                </div>
                {base.requirements?.level ? <p className="small muted">{t('builder.requirements', { level: base.requirements.level })}</p> : null}
              </Card>

              <Card
                title={<><span className="step-badge">4</span>{t('builder.stage.mods')}</>}
                actions={
                  <button onClick={() => setPicking(true)} className="primary">
                    + {t('builder.addMod')}
                  </button>
                }
              >
                <div className="slot-meter">
                  <span>
                    {t('common.prefixes')} {nPrefix}/{lim.prefix}
                    {slots(nPrefix, lim.prefix, 'prefix')}
                  </span>
                  <span>
                    {t('common.suffixes')} {nSuffix}/{lim.suffix}
                    {slots(nSuffix, lim.suffix, 'suffix')}
                  </span>
                </div>
                {target.requirements.length === 0 ? (
                  <div className="empty-state compact">
                    <p>{t('builder.noMods')}</p>
                    <button className="primary" onClick={() => setPicking(true)}>
                      + {t('builder.addMod')}
                    </button>
                  </div>
                ) : (
                  <div className="req-list">
                    {target.requirements.map((r) => {
                      const fam = pool!.byFamily.get(r.family) ?? [];
                      return (
                        <div key={r.id} className={`req-card ${r.required ? '' : 'optional'}`}>
                          <SideTag gen={familyGen(r.family)} />
                          <span className="req-text">
                            <FamilyText ctx={ctx} family={r.family} />
                            {r.family.endsWith('@abyss') && <span className="badge abyss">⛧ {t('mod.abyss')}</span>}
                          </span>
                          <button className="ghost danger" onClick={() => setTarget({ requirements: target.requirements.filter((x) => x.id !== r.id) })} aria-label={t('common.remove')} title={t('common.remove')}>
                            ✕
                          </button>
                          <div className="req-controls">
                            <label>
                              {t('common.tier')}{' '}
                              <select value={r.minTier} onChange={(e) => setReq(r.id, { minTier: Number(e.target.value) })}>
                                {fam.map((e) => (
                                  <option key={e.mod.id} value={e.tier} disabled={e.mod.level > target.ilvl}>
                                    {t('builder.tierOption', {
                                      tier: e.tier,
                                      level: e.mod.level,
                                      range: e.mod.stats[0] ? (e.mod.stats[0].min === e.mod.stats[0].max ? String(e.mod.stats[0].min) : `${e.mod.stats[0].min}-${e.mod.stats[0].max}`) : '',
                                    })}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {t('common.minValue')}{' '}
                              <input type="number" className="value-input" value={r.minValue ?? ''} onChange={(e) => setReq(r.id, { minValue: e.target.value === '' ? null : Number(e.target.value) })} />
                            </label>
                            <label className="check">
                              <input type="checkbox" checked={r.required} onChange={(e) => setReq(r.id, { required: e.target.checked })} /> {t('common.required')}
                            </label>
                            <label>
                              {t('common.priority')}{' '}
                              <select value={r.priority} onChange={(e) => setReq(r.id, { priority: Number(e.target.value) })}>
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                                <option value={3}>3</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>

        {target && base && (
          <aside className="builder-aside">
            <TargetTooltip target={target} />
            <Card title={<><span className="step-badge">5</span>{t('builder.stage.review')}</>}>
              {issues.length === 0 ? (
                <div className="banner ok small">✓ {t('builder.valid')}</div>
              ) : (
                <ul className="issues">
                  {issues.map((i, k) => (
                    <li key={k} className={i.severity}>
                      {issueText(ctx, t, lang, i)}
                    </li>
                  ))}
                </ul>
              )}
              <label className="block">
                {t('builder.projectName')} <input value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder={base.name} />
              </label>
              <div className="cta-row">
                <button className="primary" disabled={errors.length > 0 || target.requirements.length === 0} onClick={() => nav('/comparator')}>
                  ⚖ {t('builder.analyze')}
                </button>
                <button disabled={errors.length > 0 || target.requirements.length === 0} onClick={save}>
                  💾 {editing ? t('builder.updateProject') : t('builder.saveProject')}
                </button>
              </div>
            </Card>
          </aside>
        )}
      </div>

      {picking && target && (
        <FamilyPicker
          ctx={ctx}
          baseId={target.baseId}
          ilvl={target.ilvl}
          exclude={target.requirements.map((r) => r.family)}
          onClose={() => setPicking(false)}
          onPick={(family) => {
            const fam = pool!.byFamily.get(family) ?? [];
            // Padrão: aceitar os 3 melhores tiers possíveis no nível do item (o jogador ajusta).
            const best = fam.find((e) => e.mod.level <= target.ilvl) ?? fam[fam.length - 1];
            const minTier = Math.min((best?.tier ?? 1) + 2, fam.length);
            setTarget({ requirements: [...target.requirements, { id: uid(), family, minTier, required: true, priority: 1, minValue: null }] });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
