import type { WeightTable } from './context';

export interface WeightImportResult {
  table: WeightTable | null;
  unknownIds: string[];
  error?: string;
}

/**
 * Lê uma tabela de pesos fornecida pelo jogador.
 * JSON: {"source": "...", "confidence": "estimated"|"confirmed", "weights": {"ModId": 1000}}
 * CSV:  linhas "modId,peso" (cabeçalho opcional; "#" inicia comentário).
 * Pesos devem ser números finitos >= 0. Ids desconhecidos são ignorados e reportados.
 */
export function parseWeightTable(text: string, knownIds: Set<string>, fallbackSource: string, now = new Date().toISOString()): WeightImportResult {
  let source = fallbackSource;
  let confidence: 'confirmed' | 'estimated' = 'estimated';
  const raw: Record<string, number> = {};
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith('{')) {
      const j = JSON.parse(trimmed);
      if (typeof j.source === 'string' && j.source.trim()) source = j.source.trim();
      if (j.confidence === 'confirmed') confidence = 'confirmed';
      if (!j.weights || typeof j.weights !== 'object') throw new Error('campo "weights" ausente');
      for (const [k, v] of Object.entries(j.weights)) raw[k] = Number(v);
    } else {
      for (const line of trimmed.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('#')) continue;
        const [id, w] = l.split(/[,;\t]/).map((s) => s.trim());
        if (!id || w === undefined) continue;
        if (Number.isNaN(Number(w))) continue; // cabeçalho
        raw[id] = Number(w);
      }
    }
  } catch (e) {
    return { table: null, unknownIds: [], error: String((e as Error).message) };
  }
  const weights: Record<string, number> = {};
  const unknownIds: string[] = [];
  for (const [id, w] of Object.entries(raw)) {
    if (!Number.isFinite(w) || w < 0) return { table: null, unknownIds: [], error: `peso inválido para ${id}` };
    if (!knownIds.has(id)) unknownIds.push(id);
    else weights[id] = w;
  }
  if (!Object.keys(weights).length) return { table: null, unknownIds, error: 'nenhum peso válido' };
  return { table: { source, confidence, importedAt: now, weights }, unknownIds };
}
