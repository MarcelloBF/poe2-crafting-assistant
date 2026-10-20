import { describe, expect, it } from 'vitest';
import { parseWeightTable } from '../src/engine/weightsImport';

const known = new Set(['Life1', 'Life2', 'Fire1']);

describe('importação de tabela de pesos', () => {
  it('lê JSON com fonte e confiança', () => {
    const r = parseWeightTable('{"source":"Minha planilha","confidence":"estimated","weights":{"Life1":1000,"Life2":500,"X":3}}', known, 'arquivo.json', '2026-10-20');
    expect(r.table!.source).toBe('Minha planilha');
    expect(r.table!.confidence).toBe('estimated');
    expect(r.table!.weights).toEqual({ Life1: 1000, Life2: 500 });
    expect(r.unknownIds).toEqual(['X']);
  });
  it('lê CSV com cabeçalho e comentários', () => {
    const r = parseWeightTable('# comentário\nmodId,peso\nLife1,800\nFire1;200', known, 'pesos.csv');
    expect(r.table!.weights).toEqual({ Life1: 800, Fire1: 200 });
    expect(r.table!.source).toBe('pesos.csv');
    expect(r.table!.confidence).toBe('estimated');
  });
  it('rejeita pesos negativos e arquivos sem pesos válidos', () => {
    expect(parseWeightTable('Life1,-5', known, 'x').error).toBeTruthy();
    expect(parseWeightTable('{"weights":{"Nada":1}}', known, 'x').table).toBeNull();
    expect(parseWeightTable('{oops', known, 'x').error).toBeTruthy();
  });
});
