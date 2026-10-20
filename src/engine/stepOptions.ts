import { type Grade, currencyFor } from '../data/rules';
import { type ActionSpec, actionMaterials, applyAction, checkAction } from './actions';
import type { CraftContext } from './context';
import type { PriceBook } from './cost';
import type { ItemState } from './item';
import { analyzeNextAction } from './probability';
import { mulberry32 } from './rng';
import { type TargetSpec, completableByAdding, evaluate, junkMods } from './target';

/** Uma forma de fazer a etapa atual: a ação recomendada ou uma variação (outro presságio / outra versão). */
export interface StepOption {
  spec: ActionSpec;
  recommended: boolean;
  /** Chance de a ação melhorar o item: mais requisitos cumpridos, ou o mesmo número com menos mods inúteis. */
  improves: number | null;
  /** Chance de o objetivo continuar alcançável (sem precisar de Anulação). */
  keepsPossible: number | null;
  /** Custo de uma aplicação (exalted), ou null se faltar preço de algum item. */
  cost: number | null;
  missingPrices: string[];
  tooLarge: boolean;
  /** Estimado por simulação (ação grande demais para o cálculo exato, ex.: Alquimia). */
  sampled: boolean;
}

/** Amostras por opção quando o cálculo exato é grande demais. */
const SAMPLES = 1500;

/** Presságios que fazem sentido testar para cada tipo de moeda (combinações válidas no jogo). */
const OMEN_SETS: Record<string, string[][]> = {
  regal: [[], ['sinistral-coronation'], ['dextral-coronation']],
  exalt: [[], ['sinistral-exaltation'], ['dextral-exaltation'], ['greater-exaltation'], ['greater-exaltation', 'sinistral-exaltation'], ['greater-exaltation', 'dextral-exaltation']],
  chaos: [[], ['whittling'], ['sinistral-erasure'], ['dextral-erasure']],
  annul: [[], ['sinistral-annulment'], ['dextral-annulment'], ['light'], ['greater-annulment']],
  alchemy: [[], ['sinistral-alchemy'], ['dextral-alchemy']],
  essence: [[], ['sinistral-crystallisation'], ['dextral-crystallisation']],
};
const GRADED = new Set(['transmute', 'augment', 'regal', 'exalt', 'chaos']);
const GRADES: Grade[] = ['normal', 'greater', 'perfect'];

function priceOf(book: PriceBook | null, names: string[]): { cost: number | null; missing: string[] } {
  const missing = names.filter((n) => book?.entries[n]?.value == null);
  if (missing.length) return { cost: null, missing };
  return { cost: names.reduce((a, n) => a + book!.entries[n].value, 0), missing };
}

function variants(ctx: CraftContext, spec: ActionSpec): ActionSpec[] {
  if (spec.currency === 'essence') return OMEN_SETS.essence.map((omens) => ({ ...spec, omens }));
  const r = ctx.rules.currencies[spec.currency];
  // Profanação e moedas sem variações relevantes: só a ação recomendada.
  if (!r || r.kind === 'desecrate' || r.kind === 'divine' || r.kind === 'fracture') return [spec];
  const currencies = GRADED.has(r.kind)
    ? GRADES.map((g) => currencyFor(ctx.rules, r.kind, g)).filter((c) => c && c.minModLevel != null).map((c) => c!.id)
    : [spec.currency];
  const omenSets = OMEN_SETS[r.kind] ?? [[]];
  return currencies.flatMap((currency) => omenSets.map((omens) => ({ currency, omens })));
}

const sameSpec = (a: ActionSpec, b: ActionSpec) =>
  a.currency === b.currency && a.essenceId === b.essenceId && [...(a.omens ?? [])].sort().join() === [...(b.omens ?? [])].sort().join();

/**
 * Compara a ação recomendada com as variações aplicáveis ao item atual (presságios e versões Greater/Perfect),
 * pelo cálculo exato do resultado de uma aplicação.
 */
export function stepOptions(ctx: CraftContext, item: ItemState, t: TargetSpec, recommended: ActionSpec, book: PriceBook | null): StepOption[] {
  const before = evaluate(ctx, t, item);
  const metBefore = before.met.filter((m, i) => (m || before.valueShort[i]) && t.requirements[i].required).length;
  const junkBefore = junkMods(ctx, t, item).length;
  const out: StepOption[] = [];
  const list = variants(ctx, recommended);
  if (!list.some((v) => sameSpec(v, recommended))) list.unshift(recommended);
  for (const v of list) {
    const spec = { ...v, essenceId: recommended.essenceId, prefer: recommended.prefer };
    if (!checkAction(ctx, item, spec).ok) continue;
    const a = analyzeNextAction(ctx, item, spec, t);
    const better = (after: ItemState) => {
      const ev = evaluate(ctx, t, after);
      const met = ev.met.filter((m, i) => (m || ev.valueShort[i]) && t.requirements[i].required).length;
      return met > metBefore || (met === metBefore && junkMods(ctx, t, after).length < junkBefore);
    };
    let improves: number | null = null;
    let keepsPossible = a.stillCompletable.value;
    let sampled = false;
    if (!a.tooLarge && a.outcomes.length) {
      improves = 0;
      for (const o of a.outcomes) if (better(o.item)) improves += o.p;
    } else if (a.tooLarge) {
      // Mesma semente para todas as opções: as diferenças vêm da ação, não do acaso.
      const rng = mulberry32(97);
      let imp = 0;
      let keep = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const after = applyAction(ctx, item, spec, rng).item;
        if (better(after)) imp++;
        if (evaluate(ctx, t, after).allRequiredIgnoringValues || completableByAdding(ctx, t, after, 'rare')) keep++;
      }
      improves = imp / SAMPLES;
      keepsPossible = keep / SAMPLES;
      sampled = true;
    }
    const { cost, missing } = priceOf(book, actionMaterials(ctx, spec));
    out.push({ spec, recommended: sameSpec(spec, recommended), improves, keepsPossible, cost, missingPrices: missing, tooLarge: a.tooLarge, sampled });
  }
  // Recomendada primeiro; depois as que mais melhoram o item.
  return out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || (b.improves ?? -1) - (a.improves ?? -1));
}

const EPS = 1e-9;

/**
 * Opções que valem mostrar: tira as que não melhoram nada e as dominadas (outra opção tem chances
 * iguais ou maiores e custo conhecido igual ou menor; ou as mesmas chances usando só parte dos presságios).
 * A recomendada fica sempre.
 */
export function usefulOptions(options: StepOption[]): StepOption[] {
  const ge = (a: number | null, b: number | null) => (a ?? -1) >= (b ?? -1) - EPS;
  const eq = (a: number | null, b: number | null) => Math.abs((a ?? -1) - (b ?? -1)) < EPS;
  return options.filter((o) => {
    if (o.recommended) return true;
    if (!o.improves) return false;
    return !options.some((p) => {
      if (p === o) return false;
      const chancesGe = ge(p.improves, o.improves) && ge(p.keepsPossible, o.keepsPossible);
      if (!chancesGe) return false;
      const sameChances = eq(p.improves, o.improves) && eq(p.keepsPossible, o.keepsPossible);
      const pOmens = p.spec.omens ?? [];
      const oOmens = o.spec.omens ?? [];
      // Mesmo resultado com menos presságios na mesma moeda: o presságio extra é desperdício.
      if (sameChances && p.spec.currency === o.spec.currency && pOmens.length < oOmens.length && pOmens.every((x) => oOmens.includes(x))) return true;
      if (p.cost == null || o.cost == null) return false;
      return p.cost <= o.cost + EPS && (!sameChances || p.cost < o.cost - EPS);
    });
  });
}
