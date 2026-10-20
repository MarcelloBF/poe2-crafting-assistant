import { type ActionSpec, actionDistribution, actionMaterials, checkAction } from './actions';
import type { CraftContext } from './context';
import { type ItemState, type ItemValidationIssue, cloneItem, itemKey, newItem, validateItem } from './item';
import { type NextActionAnalysis, analyzeNextAction } from './probability';
import { BASE_MATERIAL, BUY_MATERIAL } from './simulate';
import { type Decision, type Strategy, decide } from './strategies';
import { type TargetSpec, evaluate } from './target';

export type AttemptOutcome = 'success' | 'progress' | 'fail' | 'unexpected' | 'newBase' | 'manual' | 'bought';

export interface Attempt {
  id: string;
  at: string;
  spec: ActionSpec | null;
  before: ItemState;
  after: ItemState;
  outcome: AttemptOutcome;
  /** Ação recomendada pelo app no momento (para auditoria). */
  recommended?: string;
  materials: string[];
  note?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  target: TargetSpec;
  strategy: Strategy | null;
  /** Custo de uma base nova, em exalted (null = não informado). */
  baseCost: number | null;
  item: ItemState;
  attempts: Attempt[];
  status: 'active' | 'done' | 'abandoned';
  notes: string;
  /** Custo total esperado da estratégia escolhida no comparador (ex), se havia preços. */
  expectedTotal?: number | null;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function createProject(name: string, target: TargetSpec, strategy: Strategy | null = null, baseCost: number | null = null): Project {
  const now = new Date().toISOString();
  return { id: uid(), name, createdAt: now, updatedAt: now, target, strategy, baseCost, item: newItem(target.baseId, target.ilvl), attempts: [], status: 'active', notes: '' };
}

export function duplicateProject(p: Project): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(p), id: uid(), name: `${p.name} (cópia)`, createdAt: now, updatedAt: now, attempts: [], item: newItem(p.target.baseId, p.target.ilvl), status: 'active' };
}

export interface TutorialState {
  decision: Decision | null;
  analysis: NextActionAnalysis | null;
  /** Etapa atual (1-based): 1 base, 2 nível, 3+ ações. */
  stepNumber: number;
}

export function tutorialState(ctx: CraftContext, p: Project): TutorialState {
  if (!p.strategy) return { decision: null, analysis: null, stepNumber: 1 };
  const sinceBase = actionsSinceNewBase(p);
  const decision = decide(ctx, p.strategy, p.target, p.item, sinceBase);
  const analysis = decision.kind === 'action' ? analyzeNextAction(ctx, p.item, decision.spec, p.target) : null;
  return { decision, analysis, stepNumber: 3 + p.attempts.length };
}

export function actionsSinceNewBase(p: Project): number {
  let n = 0;
  for (let i = p.attempts.length - 1; i >= 0; i--) {
    if (p.attempts[i].outcome === 'newBase') break;
    n++;
  }
  return n;
}

export interface RecordResult {
  project: Project | null;
  issues: ItemValidationIssue[];
  /** O resultado informado não está entre os resultados possíveis da ação, segundo as regras. */
  unexpected: boolean;
}

/**
 * Registra o resultado REAL informado pelo jogador. O app nunca presume sucesso:
 * o item resultante precisa ser informado (raridade + modificadores).
 */
export function recordAttempt(
  ctx: CraftContext,
  p: Project,
  spec: ActionSpec,
  after: ItemState,
  opts: { markFail?: boolean; markUnexpected?: boolean; note?: string; recommended?: string } = {},
): RecordResult {
  const issues = validateItem(ctx, after);
  if (issues.length) return { project: null, issues, unexpected: false };
  let unexpected = !!opts.markUnexpected;
  if (!checkAction(ctx, p.item, spec).ok) unexpected = true;
  else {
    const d = actionDistribution(ctx, p.item, spec, 50_000);
    if (d && d.outcomes.length && !d.outcomes.some((o) => itemKey(o.item) === itemKey(after))) unexpected = true;
  }
  const ev = evaluate(ctx, p.target, after);
  const outcome: AttemptOutcome = opts.markFail ? 'fail' : unexpected ? 'unexpected' : ev.allRequired ? 'success' : 'progress';
  const attempt: Attempt = {
    id: uid(),
    at: new Date().toISOString(),
    spec,
    before: cloneItem(p.item),
    after: cloneItem(after),
    outcome,
    recommended: opts.recommended,
    materials: actionMaterials(ctx, spec),
    note: opts.note,
  };
  const next: Project = { ...p, item: cloneItem(after), attempts: [...p.attempts, attempt], updatedAt: attempt.at, status: ev.allRequired ? 'done' : p.status };
  return { project: next, issues: [], unexpected };
}

/** Registra o estado real do item sem associá-lo a uma ação (correção manual pelo jogador). */
export function recordManualState(ctx: CraftContext, p: Project, after: ItemState, note?: string, materials: string[] = []): RecordResult {
  const issues = validateItem(ctx, after);
  if (issues.length) return { project: null, issues, unexpected: false };
  const at = new Date().toISOString();
  const done = evaluate(ctx, p.target, after).allRequired;
  const attempt: Attempt = { id: uid(), at, spec: null, before: cloneItem(p.item), after: cloneItem(after), outcome: materials.includes(BUY_MATERIAL) ? 'bought' : 'manual', materials, note };
  return { project: { ...p, item: cloneItem(after), attempts: [...p.attempts, attempt], updatedAt: at, status: done ? 'done' : p.status }, issues: [], unexpected: false };
}

/** Descarta o item atual e começa numa base nova. */
export function startNewBase(p: Project, note?: string): Project {
  const at = new Date().toISOString();
  const fresh = newItem(p.target.baseId, p.target.ilvl);
  // Na estratégia de compra a "base nova" é o próximo item comprado (registrado quando o jogador o informa).
  const attempt: Attempt = { id: uid(), at, spec: null, before: cloneItem(p.item), after: fresh, outcome: 'newBase', materials: p.strategy?.params.buy ? [] : [BASE_MATERIAL], note };
  return { ...p, item: fresh, attempts: [...p.attempts, attempt], updatedAt: at, status: 'active' };
}

/** Volta uma etapa: remove a última tentativa e restaura o item anterior. */
export function undoAttempt(p: Project): Project {
  const last = p.attempts[p.attempts.length - 1];
  if (!last) return p;
  return { ...p, item: cloneItem(last.before), attempts: p.attempts.slice(0, -1), updatedAt: new Date().toISOString(), status: 'active' };
}

export function materialsUsed(p: Project): Record<string, number> {
  const out: Record<string, number> = {};
  // A primeira base também conta como material (na estratégia de compra, conta o item comprado).
  if (!p.strategy?.params.buy) out[BASE_MATERIAL] = 1;
  for (const a of p.attempts) for (const m of a.materials) out[m] = (out[m] ?? 0) + 1;
  return out;
}
