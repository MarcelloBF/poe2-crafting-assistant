import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCtx } from '../App';
import { Card, ModLabel, TargetSummary, WeightsBanner } from '../components/ui';
import { type LineStatus, importToItem, importToTarget, parseItemText } from '../engine/itemImport';
import { createProject } from '../engine/project';
import { spawnFlag } from '../engine/context';
import { validateTarget } from '../engine/target';
import { useT } from '../i18n';
import { recognizeItemImage } from '../ocr/ocr';
import { setDraft, upsertProject } from '../store/store';
import { useClassName } from './BuilderPage';

const STATUS_CLASS: Record<LineStatus, string> = {
  ok: 'outcome-success',
  valueNotOnBase: 'outcome-unexpected',
  notOnBase: 'outcome-fail',
  unknown: 'outcome-fail',
  implicit: 'outcome-newBase',
  header: 'outcome-newBase',
};

export function ImportPage() {
  const ctx = useCtx();
  const { t } = useT();
  const className = useClassName();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ p: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseOverride, setBaseOverride] = useState<string>('');
  const [ilvlInput, setIlvlInput] = useState<number | null>(null);
  const [rarity, setRarity] = useState<'magic' | 'rare'>('rare');
  const [showHeaders, setShowHeaders] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runOcr = useCallback(
    async (blob: Blob) => {
      setError(null);
      setImage(URL.createObjectURL(blob));
      setOcr({ p: 0, status: 'start' });
      try {
        const txt = await recognizeItemImage(blob, (p, status) => setOcr({ p, status }));
        setText(txt.trim());
        setBaseOverride('');
        setIlvlInput(null);
      } catch (e) {
        setError(t('imp.ocrFail', { error: String((e as Error).message) }));
      } finally {
        setOcr(null);
      }
    },
    [t],
  );

  // Colar (Ctrl+V) imagem ou texto em qualquer lugar da página.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = [...(e.clipboardData?.items ?? [])];
      const img = items.find((i) => i.type.startsWith('image/'));
      if (img) {
        const f = img.getAsFile();
        if (f) {
          e.preventDefault();
          runOcr(f);
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [runOcr]);

  const res = useMemo(() => (text.trim() ? parseItemText(ctx, text, baseOverride || undefined) : null), [ctx, text, baseOverride]);
  const ilvl = ilvlInput ?? res?.ilvl ?? 82;
  const target = res?.base ? importToTarget(ctx, res, ilvl, rarity) : null;
  const targetErrors = target ? validateTarget(ctx, target).filter((i) => i.severity === 'error') : [];
  const visibleLines = res?.lines.filter((l) => showHeaders || l.status !== 'header') ?? [];
  const usable = !!target && target.requirements.length > 0 && targetErrors.length === 0;

  function toDraft() {
    if (!target || !res?.base) return;
    setDraft({ target, itemClass: res.base.itemClass, name: res.base.name, editingProjectId: null });
  }

  return (
    <div className="page">
      <h1>{t('imp.title')}</h1>
      <p className="lead">{t('imp.intro')}</p>
      <div className="grid two">
        <Card title={t('imp.image')}>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f && f.type.startsWith('image/')) runOcr(f);
            }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            {image ? <img src={image} alt={t('imp.image')} /> : <p>{t('imp.drop')}</p>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runOcr(f);
              e.target.value = '';
            }}
          />
          {ocr && (
            <div className="progress">
              <div className="bar" style={{ width: `${Math.round(ocr.p * 100)}%` }} />
              <span>
                {t('imp.reading')} {Math.round(ocr.p * 100)}%
              </span>
            </div>
          )}
          <p className="small muted">{t('imp.ocrNote')}</p>
          {error && <div className="banner error small">{error}</div>}
        </Card>
        <Card title={t('imp.text')}>
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('imp.textPlaceholder')} spellCheck={false} />
          <p className="small muted">{t('imp.textHelp')}</p>
        </Card>
      </div>

      {res && (
        <>
          <Card title={t('imp.result')}>
            <div className="row wrap">
              <label>
                {t('common.base')}{' '}
                <select value={res.base?.id ?? ''} onChange={(e) => setBaseOverride(e.target.value)}>
                  {!res.base && <option value="">{t('imp.chooseBase')}</option>}
                  {[...ctx.data.bases]
                    .filter((b) => b.inGame !== false)
                    .sort((a, b) => a.itemClass.localeCompare(b.itemClass) || a.name.localeCompare(b.name))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {className(b.itemClass)} — {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t('common.ilvl')} <input type="number" min={1} max={100} value={ilvl} onChange={(e) => setIlvlInput(Number(e.target.value) || 1)} style={{ width: '5em' }} />
              </label>
              {!res.ilvl && <span className="small muted">{t('imp.ilvlAssumed')}</span>}
              <label>
                {t('builder.targetRarity')}{' '}
                <select value={rarity} onChange={(e) => setRarity(e.target.value as 'magic' | 'rare')}>
                  <option value="magic">{t('common.magic')}</option>
                  <option value="rare">{t('common.rare')}</option>
                </select>
              </label>
              <label className="check small">
                <input type="checkbox" checked={showHeaders} onChange={(e) => setShowHeaders(e.target.checked)} /> {t('imp.showHeaders')}
              </label>
            </div>
            {res.warnings.length > 0 && (
              <div className="banner warn small">
                <ul>
                  {res.warnings.map((w) => (
                    <li key={w}>{t(w, { base: res.base?.name ?? '?' })}</li>
                  ))}
                </ul>
                {res.suggestedClasses.length > 0 && <p>{t('imp.suggested', { classes: res.suggestedClasses.map(className).join(', ') })}</p>}
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('imp.col.line')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('imp.col.mod')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((l, i) => {
                    const m = l.status === 'valueNotOnBase' ? l.matches.find((x) => x.onBase) : l.matches[0];
                    return (
                      <tr key={i}>
                        <td className="small">{l.raw}</td>
                        <td>
                          <span className={`badge ${STATUS_CLASS[l.status]}`}>{t(`imp.status.${l.status}`)}</span>
                        </td>
                        <td className="small">
                          {m && <ModLabel ctx={ctx} mod={m.mod} baseId={m.onBase ? res.base?.id : undefined} />}
                          {l.status === 'notOnBase' &&
                            m &&
                            (() => {
                              const classes = [
                                ...new Set(
                                  ctx.data.bases
                                    .filter((b) => b.inGame !== false && l.matches.some((x) => (x.exact || !l.values.length) && spawnFlag(x.mod, b) > 0))
                                    .map((b) => b.itemClass),
                                ),
                              ];
                              return <div className="muted">{classes.length ? t('imp.onlyOn', { classes: classes.map(className).join(', ') }) : t('imp.onlyOnNone')}</div>;
                            })()}
                          {l.status === 'valueNotOnBase' && <div className="muted">{t('imp.valueHint')}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('imp.plan')}>
            <WeightsBanner />
            {target && target.requirements.length > 0 ? (
              <>
                <p className="small">{t('imp.planIntro')}</p>
                <TargetSummary ctx={ctx} target={target} />
                {targetErrors.length > 0 && (
                  <ul className="issues">
                    {targetErrors.map((i, k) => (
                      <li key={k} className="error">
                        {t(i.key, i.params)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="empty">{t('imp.nothingUsable')}</p>
            )}
            <div className="row wrap">
              <button
                className="primary"
                disabled={!usable}
                onClick={() => {
                  toDraft();
                  nav('/comparator?auto=1');
                }}
              >
                {t('imp.btn.plan')}
              </button>
              <button
                disabled={!usable}
                onClick={() => {
                  const it = importToItem(res, ilvl, res.rarity && res.rarity !== 'normal' ? res.rarity : 'rare');
                  if (!it || !target) return;
                  const p = createProject(`${res.base!.name} (${t('imp.imported')})`, target);
                  p.item = it;
                  upsertProject(p);
                  nav(`/comparator?project=${p.id}&auto=1`);
                }}
                title={t('imp.btn.continueHint')}
              >
                {t('imp.btn.continue')}
              </button>
              <button
                disabled={!target}
                onClick={() => {
                  toDraft();
                  nav('/');
                }}
              >
                {t('imp.btn.builder')}
              </button>
            </div>
            <p className="small muted">{t('imp.planNote')}</p>
          </Card>
        </>
      )}
    </div>
  );
}
