# Fontes de dados e integrações (investigação — outubro/2026)

| Fonte | O que oferece | Condições / observações | Decisão |
|---|---|---|---|
| **RePoE-fork (PoE2)** — https://repoe-fork.github.io/poe2/ | Export JSON dos arquivos do cliente (via PyPoE): `mods`, `base_items`, `stat_translations`, etc. Página indica a versão do jogo (0.5.5.4.2). | Projeto aberto; o README credita a Grinding Gear Games como dona do conteúdo dos dados e avisa que o formato pode mudar. **Spawn weights do PoE2 vêm apenas como 0/1**. Traduções só em inglês. | **Usado** como banco de modificadores/bases (importador `scripts/import-repoe.mjs`). Origem, versão, data e hash SHA-256 dos arquivos ficam em `meta.json`. |
| **Craft of Exile (PoE2)** | Pesos de modificadores e simulador. | Sem API pública documentada. O próprio site informa que os pesos do PoE2 **não estão no cliente** e foram **extrapolados** pela comunidade. Não há autorização para redistribuição. | **Não integrado**. Alternativa legítima: o jogador pode importar uma tabela de pesos própria (JSON/CSV) com a fonte declarada; ela é marcada como estimativa. |
| **poe.ninja** — https://poe.ninja/docs/api | API pública de economia: `/poe2/api/economy/leagues` e `/poe2/api/economy/exchange/current/overview?league=…&type=Currency|Essences|Ritual`. Preços em relação ao Divine, com taxa para Exalted. | Documentada como superfície pública suportada; pede cache (~1 h no PoE2), User-Agent descritivo, não replicar o site; sem SLA; recomenda não chamar direto do navegador do usuário final; **sem cabeçalho CORS**. | **Usado** para preços: script Node `npm run prices:update` (grava arquivo com fonte e horário) e, em desenvolvimento, via proxy do Vite. Preços manuais têm prioridade. |
| **poe2db.tw** — https://poe2db.tw/us/Essence | Tabela de essências (95 itens, efeitos por categoria) e textos de itens/presságios/ossos, gerados dos arquivos do jogo. | Site de fã público; não há API — usamos a página HTML pública (baixada uma vez por atualização, com User-Agent identificado). | **Usado** para a tabela de essências (`scripts/essences.mjs`) e como fonte citada dos textos de presságios e ossos. |
| **poe2wiki.net** | Descrições de moedas e presságios. | Protegido por anti-bot (Anubis) para acesso automatizado. | Usado apenas como **referência citada** nas regras com confiança "comunidade". |
| **Trade oficial do PoE** | Preços de itens prontos. | Sem API pública para terceiros com termos claros. | **Não integrado**. O preço de compra de item semelhante é informado manualmente no projeto. |
| **Documentação oficial GGG** | API de desenvolvedor (OAuth, contas). | Não fornece dados de mods/pesos. | Não aplicável. |

## Por que não há probabilidade "confirmada" baseada em pesos

Os arquivos do PoE2 indicam apenas elegibilidade. Qualquer peso relativo vem de testes da comunidade.
O app, portanto:

1. usa os dados do jogo para tudo o que é estrutural (quais mods existem, tiers, níveis, grupos, limites);
2. marca como **estimado** qualquer cálculo com pesos de tabela externa ou hipótese;
3. marca como **indisponível** quando não há pesos e o resultado depende deles.
