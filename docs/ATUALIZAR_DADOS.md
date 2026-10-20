# Atualizar os dados do jogo

## Banco de modificadores e bases (após cada patch)

```bash
npm run data:download
```

O script:
1. baixa `mods`, `base_items`, `item_classes` e `stat_translations/stat_descriptions` do RePoE-fork PoE2
   para `data-raw/repoe-poe2/` (valida que cada arquivo é JSON);
2. lê a versão do jogo exibida no índice do RePoE-fork;
3. gera `public/data/poe2/{meta,bases,mods,stats}.json` com:
   - apenas bases lançadas (`release_state = released`) das categorias de equipamento;
   - apenas prefixos/sufixos de item que podem gerar (ou exclusivos de essência);
   - `meta.json` com versão do jogo, data de importação, URL da fonte e SHA-256 dos arquivos brutos.

O mesmo comando baixa a tabela de essências do poe2db (`data-raw/poe2db/essence.html`) e gera
`public/data/poe2/essences.json`, ligando cada efeito ao id do mod do jogo. O resumo impresso mostra
quantos efeitos foram ligados (`essenceEffectsLinked` / `essenceEffects`); efeitos sem ligação ficam
visíveis no app como "não modelado". Mods da Abyss (domínio `desecrated`) são importados com o lorde.

### Classes ainda não lançadas e bases não obtíveis

Os arquivos do cliente trazem bases de classes futuras (adagas, garras, espadas, machados, manguais)
**marcadas como `released`** — nada nos dados as diferencia das classes jogáveis. Por isso existe a
lista curada `data-config/poe2-release.json`:

- `unreleasedClasses`: classes ocultas no app (o jogador pode mostrá-las em Configurações). **Quando uma
  classe for lançada, remova-a desta lista** e rode `npm run data:import`.
- `excludedTags` / `excludedIdPatterns`: bases que não são obtidas normalmente e são removidas
  (itens gerados por habilidade, peças Demigod, bases de ascendência, bases genéricas `…Base`, bases
  exclusivas de únicos `…VerisiumUnique`).

Para regenerar a partir dos arquivos já baixados (sem rede):

```bash
npm run data:import
```

Depois rode os testes — `tests/dataset.test.ts` verifica a integridade do dataset novo e
**acusa templates de tradução PT que deixaram de existir** no jogo:

```bash
npm test
```

## Regras de crafting

Mudanças de mecânica (ex.: novo nível mínimo de uma moeda Greater) são editadas em
`src/data/rules.ts`, sempre com `source` e `confidence`. O jogador também pode sobrescrever níveis
mínimos em Configurações → Regras sem alterar o código.

## Traduções de modificadores

`src/i18n/modTemplatesPtBr.ts` mapeia o template em inglês (exatamente como em `stats.json`) para PT.
Se uma futura versão do export trouxer o idioma `Portuguese`, o formatador usa a tradução oficial
automaticamente.

## Preços

```bash
npm run prices:update -- --league "Nome da Liga"
```

Grava `public/data/prices/<liga>.json` (preços em Exalted, fonte e horário). Carregue o arquivo em
Configurações → Economia → "Carregar arquivo de preços". Durante o desenvolvimento (`npm run dev`) o
botão "Atualizar preços do poe.ninja" funciona direto pelo proxy do Vite. Preços com mais de 24 h
são sinalizados como desatualizados.
