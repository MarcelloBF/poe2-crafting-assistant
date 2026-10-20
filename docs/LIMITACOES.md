# Limitações conhecidas

## Dados

- **Pesos de geração ausentes.** O cliente do PoE2 não contém pesos relativos (só flags 0/1). Sem tabela
  importada ou hipótese escolhida, probabilidades dependentes de sorteio aparecem como indisponíveis.
  Com hipótese, são estimativas — podem divergir bastante do jogo (ex.: tiers altos tendem a ser mais
  raros do que a hipótese uniforme supõe).
- **Classes lançadas** não são identificáveis pelos dados do jogo: a lista de classes ocultas
  (Dagger, Claw, One/Two Hand Sword, One/Two Hand Axe, Flail) é mantida à mão em
  `data-config/poe2-release.json` e precisa ser atualizada quando a GGG lançar novas armas.
- **Essências** vêm do poe2db (página pública); se o layout do site mudar, o importador avisa e a
  tabela anterior continua valendo. 3 efeitos especiais não são modelados (Delírio, Insanidade, Abismo).
- **Abyss**: o número de opções na revelação (3) e a forma como o jogador escolhe entre opções
  equivalentes são hipóteses; mods de joias (jewels) e o Omen of Putrefaction não são modelados.
- **Textos em português** dos modificadores são tradução manual não oficial (166 templates, cobrindo os
  mods mais comuns). Os demais aparecem em inglês com o selo "EN". Nomes de bases e de afixos ficam em
  inglês (identificação no jogo).
- **Níveis mínimos** de Greater/Perfect Transmutation, Augmentation e Regal não foram confirmados;
  essas moedas ficam indisponíveis até o jogador informar o valor. Os de Exalted/Chaos (35/50) vêm da
  comunidade.
- Omens of Erasure: fontes divergem sobre qual lado removem (marcados como não confirmados).

## Mecânicas não modeladas

- Omen of Putrefaction e a Marca do Lorde Abissal (Essence of the Abyss).
- Catalisadores (qualidade — não alteram quais mods aparecem).
- Omens homogeneizadores e Omen of Catalysing Exaltation.
- Vaal Orb/corrupção, Orb of Chance, runas/núcleos de alma/Verisium, Hinekora's Lock.
- Implícitos não são craftáveis no app (exibidos apenas como informação da base).
- Hybrid mods de influência (Soul/Decay/Berserk Influence) só aparecem se a base tiver a tag; o app não
  modela a aplicação dessas influências.

## Cálculo

- Enumeração exata limitada a 250 mil estados (≈ 2 ações de adição em bases com ~200 mods);
  sequências maiores e Alquimia usam simulação.
- Estratégias são políticas fixas e simples (ex.: recomeçar em base nova quando o mágico tem mod inútil).
  Jogadores experientes podem ter rotas melhores (multi-omen, recombinação, desecration) não cobertas.
- Valores rolam de forma uniforme (hipótese).
- O comparador usa simulação: resultados variam ligeiramente entre execuções/sementes (o intervalo de
  confiança é exibido).
- Mensagens de validação do alvo citam o texto do mod em inglês.

## Importação por imagem

- O OCR (tesseract.js) roda no navegador; na primeira vez baixa ~10 MB (motor + modelo de inglês) de
  cdn.jsdelivr.net. Sem internet nessa primeira vez, use a colagem de texto (Ctrl+C no jogo).
- O OCR pode errar números ou quebrar linhas; o texto fica editável e a análise é refeita na hora.
  O texto copiado do jogo é sempre mais confiável que a imagem.
- Só textos em inglês são reconhecidos (o cliente do jogo em português gera textos que não estão no dataset).
- Rótulos de tier de ferramentas externas (ex.: "P1", "S3") são usados apenas para indicar o lado;
  o tier é determinado pelo valor/intervalo lido, comparado com os dados do jogo.
- Mods de outras mecânicas (Árvore Gênese, profanação, únicos) aparecem como "não reconhecido" ou
  "não existe nesta base".

## Base mágica recomendada

- O app só indica o que vale a pena ter na base (mods e valores mínimos); não busca nem estima o preço.
- Por ora só bases **mágicas** são recomendadas (raros parciais não).

## Economia

- Preço de itens prontos (comparação comprar × craftar) é manual — não há API de trade utilizável.
- Preço de bases é manual.
- O botão de atualização de preços no app só funciona com `npm run dev` (proxy); em build estático,
  use o script `prices:update` e carregue o arquivo.

## Persistência

- Projetos e configurações ficam no `localStorage` do navegador (por origem). Use Configurações →
  Backup para exportar/importar. Modo privado ou limpeza de dados do site apaga o progresso.
