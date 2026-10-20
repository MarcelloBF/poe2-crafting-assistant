# Regras implementadas

Versão das regras: **PoE2 0.5.x**. Dataset: **0.5.5.4.2** (RePoE-fork). Toda regra está em
`src/data/rules.ts` com fonte e nível de confiança (`confirmed`, `community`, `unverified`).
Nenhuma mecânica foi trazida do Path of Exile 1 por suposição (ex.: **não existe** Orb of Alteration;
o Chaos Orb do PoE2 **não** rerrola o item inteiro).

## Item

- Raridades: normal (0 afixos), mágico (até 1 prefixo + 1 sufixo), raro (até 3 + 3).
- **Bases especiais**: implícitos `local_maximum_prefixes_allowed_+` / `local_maximum_suffixes_allowed_+`
  (ex.: Dusk/Gloam/Penumbra/Tenebrous Ring e amuletos equivalentes) alteram o limite de itens **raros**.
  Para mágicos o limite 1/1 é mantido (hipótese).
- Um modificador só pode gerar se:
  1. a primeira tag da lista `spawn_weights` do mod que existe nas tags da base tem flag > 0;
  2. `nível do mod ≤ nível do item`;
  3. há espaço no lado (prefixo/sufixo);
  4. nenhum mod existente compartilha um **grupo de geração** (`groups`).
- **Família / tier**: mods do mesmo `type` e lado. Na base escolhida, ordenados por nível exigido:
  **T1 = melhor (maior nível)**. A numeração exibida no jogo pode ser diferente; o app sempre mostra
  nível e intervalo de valores junto do tier.

## Moedas

| Moeda | Efeito modelado | Confiança |
|---|---|---|
| Transmutation | Normal → mágico com 1 mod | confirmado |
| Augmentation | Mágico com espaço → +1 mod | confirmado |
| Regal | Mágico → raro, +1 mod | confirmado |
| Exalted | Raro com espaço → +1 mod | confirmado |
| Chaos | Remove 1 mod aleatório (não fraturado) e adiciona 1 | confirmado |
| Alchemy | Normal → raro com 4 mods (adicionados em sequência) | confirmado |
| Annulment | Remove 1 mod aleatório (não fraturado) | confirmado |
| Divine | Rerrola valores (mods não fraturados) | confirmado |
| Fracturing | Raro com ≥ 4 mods, sem fraturado: fratura 1 mod aleatório | comunidade |
| Greater/Perfect Exalted | Nível mínimo de mod 35 / 50 | comunidade (poe2wiki) |
| Greater/Perfect Chaos | Nível mínimo de mod 35 / 50 | comunidade (poe2wiki) |
| Greater/Perfect Transmutation, Augmentation, Regal | Nível mínimo **desconhecido** | não confirmado → indisponível até o jogador informar |

**Nível mínimo (Greater/Perfect)**: se nenhum tier de uma família atinge o mínimo, a família continua
elegível com todos os seus tiers (interpretação do texto "exceto se um tipo de modificador seria excluído
completamente"). Essa hipótese é exibida junto do resultado.

Remoções (Chaos/Annulment) escolhem uniformemente entre os mods removíveis.

## Presságios (omens)

| Presságio | Efeito | Confiança |
|---|---|---|
| Sinistral / Dextral Exaltation | Exalted adiciona só prefixo / só sufixo | comunidade |
| Greater Exaltation | Exalted adiciona 2 mods | comunidade |
| Sinistral / Dextral Annulment | Annulment remove só prefixo / só sufixo | comunidade |
| Whittling | Chaos remove o mod de menor nível | comunidade |
| Sinistral / Dextral Erasure | Chaos remove só prefixo / só sufixo | confirmado (texto do jogo) |
| Sinistral / Dextral Coronation | Regal adiciona só prefixo / só sufixo | confirmado (texto do jogo) |
| Sinistral / Dextral Alchemy | Alquimia com o máximo de prefixos / sufixos | confirmado (texto do jogo) |
| Greater Annulment | Anulação remove dois mods | confirmado (texto do jogo) |

Todos os presságios usam o texto oficial do item (via poe2db) e estão em `src/data/rules.ts`.

## Essências

A tabela vem da página pública do poe2db (gerada dos arquivos do jogo) e é ligada aos ids dos mods
do RePoE pelo texto genérico + intervalos de valores (`scripts/essences.mjs`): **82 essências, 127 de
130 efeitos ligados**. Regras (texto do item no jogo):

| Essência | Efeito |
|---|---|
| Lesser / normal / Greater | "Upgrades a Magic item to a Rare item, adding a guaranteed modifier" |
| Perfect (e Insanity/Horror/Delirium…) | "Removes a random modifier and augments a Rare item with a new guaranteed modifier" |

- Cada essência garante **um mod diferente por categoria de item** ("Belt, Body Armour, Helmet or
  Shield: +(85-99) to maximum Life"); a categoria é cruzada com onde o mod realmente gera.
- Efeitos com vários mods ("+(17-20) to Strength, Dexterity or Intelligence") sorteiam um deles —
  **hipótese: chance igual** (marcada como estimativa).
- Perfect: se o lado do mod garantido está cheio, assume-se que o mod removido é desse lado (hipótese).
- Mods exclusivos de essência formam famílias próprias (`…@essence`) e nunca saem de moedas.
- Não modelados: Essência do Abismo (Marca do Lorde Abissal), Delírio e Insanidade.

## Abyss — profanação (desecration)

Fontes: export do jogo (322 mods `desecrated`, 197 de equipamento) e textos dos itens no jogo (poe2db).

| Regra | Texto do jogo |
|---|---|
| Profanar | "Desecrating an item adds an Unrevealed Desecrated modifier. If modifiers are full then a random modifier is also removed." |
| Revelar | "Reveal desecrated modifiers may include base modifiers. Unless you use Omen to guarantee named modifiers." |
| Limite | "Items with Desecrated Modifiers cannot be Desecrated again." |
| Jawbone / Rib / Collarbone | "Desecrates a Rare Weapon or Quiver" / "a Rare Armour" / "a Rare Amulet, Ring or Belt" |
| Gnawed / Ancient | "Maximum Item Level: 64" / "Minimum Modifier Level: 40" |
| Omen of the Sovereign / Liege / Blackblooded | "Your next Weapon or Jewellery Desecration attempt will guarantee a random Ulaman / Amanamu / Kurgal modifier" |
| Omen of Sinistral / Dextral Necromancy | "Your next Desecration attempt will add only prefix / suffix modifiers" |
| Omen of Abyssal Echoes | "The next time you reveal Desecrated modifiers you can reroll the options once" |
| Omen of Light | "Your next Orb of Annulment will remove only Desecrated modifiers" |

Modelo de cálculo:
- Ao revelar aparecem **3 opções** (número da comunidade) sorteadas **sem reposição** do pool:
  mods normais elegíveis + mods da Abyss da base; com presságio de lorde, só os mods daquele lorde.
- O jogador **escolhe** a opção que atende o objetivo. A chance de pelo menos uma opção desejada é
  calculada **exatamente** (soma sobre as sequências de 3 sorteios, O(n²)); com Ecos Abissais:
  1 − (1 − p)². A divisão entre opções equivalentes segue os pesos (hipótese).
- Mods da Abyss formam famílias próprias (`…@abyss`) e nunca saem de Exaltados/Caos/Alquimia.
- Estratégias: quando o objetivo tem um mod da Abyss, os outros mods são montados primeiro (o Exaltado
  é direcionado ao outro lado para preservar o espaço) e o último passo é o osso + presságio do lorde.
  Opcionalmente, "último mod por profanação" troca o último Exaltado por uma profanação (escolha entre 3).
  Mod profanado errado é removido com Anulação + Omen of Light.

## Pesos de geração — a lacuna central

No PoE2 o cliente só informa **se** um mod pode gerar (flag 0/1), não **com que frequência**.
O app trata isso explicitamente (Configurações → Pesos):

| Escolha | Efeito na confiança |
|---|---|
| Nenhuma (padrão) | Probabilidades que dependem de sorteio ficam **indisponíveis** |
| Tabela importada (JSON/CSV) | Usa os pesos; "estimado" a menos que a fonte seja marcada como confirmada |
| Hipótese uniforme | Todos os elegíveis com o mesmo peso — **estimado**, hipótese listada |
| Decaimento por tier | Peso × fator^(posição acima do tier mais baixo) — **estimado** |

Resultados que não dependem de pesos (0%, 100%, um único candidato) são **confirmados** mesmo sem pesos.

## Cálculos

- **Exato** (`actionDistribution`): enumera todos os resultados de uma ação com suas probabilidades
  (pesos normalizados no pool elegível de cada passo). Ações compostas (Regal = raridade + adição;
  Chaos = remoção + adição; Greater Exaltation = duas adições) são enumeradas passo a passo,
  respeitando grupos e lados — **mods não são tratados como independentes**.
- **Enumeração de sequência** (`sequenceProbability`): aplica uma sequência fixa, juntando estados
  equivalentes; limite de 250 mil estados (acima disso, simulação).
- **Monte Carlo** (`simulateStrategy`, `simulateSequence`): mesmas funções de regra; intervalo de
  Wilson 95%; semente reprodutível.
- **Tentativas esperadas**: geométrica, 1/p; percentis 50/90/99%.
- **Custo esperado**: E[custo total] = E[custo por base] / P(sucesso por base) (teorema da renovação);
  percentis do custo total por reamostragem das execuções simuladas.
- **Valores**: hipótese de rolagem uniforme dentro do intervalo do tier (marcada como estimativa).
- **Divergência**: z = (p̂ − p) / √(p(1−p)/n); |z| > 4 gera aviso.

## Estratégias

Cada estratégia é uma **política** `decide(item) → ação | recomeçar | sucesso | falha`. A mesma função
alimenta o simulador, o comparador e o tutorial — a recomendação dada ao jogador é exatamente a
simulada.

| Estratégia | Política |
|---|---|
| Transmutação → Aumento → Régio → Exaltados | Mágico com mod inútil → base nova; Aumento se o lado livre tem requisito; Régio (+ Coroação de lado); Exaltados (+ presságio de lado quando falta só um lado); travou → base nova ou Anulação |
| Alquimia → Exaltados | Alquimia; depois como acima |
| Alquimia → Caos repetido | Caos (normal ou Greater) até completar, limite de ações por base |
| Essência → Exaltados | conforme o modo da essência cadastrada |

Variantes: grau Greater/Perfect, presságios de lado, recuperação por Anulação. Estratégias cujas
regras têm dados desconhecidos são **excluídas e listadas com o motivo**.

**Perfis do comparador** (critério sempre exibido):
- **Econômico**: menor custo total esperado; sem todos os preços, menor número esperado de itens
  consumidos (indicado como comparação por quantidade).
- **Maior consistência**: maior chance de sucesso por base; desempate por menos ações.
- **Equilibrado**: menor soma ponderada das posições em custo (40%), chance de falha (30%) e ações até
  o sucesso (30%).

## O que vale a pena já ter na base

O comparador recomenda começar de uma base mágica com o **prefixo mais difícil**, o **sufixo mais
difícil** ou **os dois** (o mais difícil = menor fatia do sorteio de uma Transmutação; sem pesos, o que
tem menos tiers aceitos). O mod indicado é o pior tier aceito, com o valor mínimo.

- Cada recomendação gera estratégias "Começar de mágico com X → Régio → Exaltados" (também com "último
  mod por profanação"). Na simulação, cada tentativa começa nessa base.
- O app não pede preço da base: essas estratégias mostram chance e número de tentativas, e o custo
  total fica indisponível ("—"), então não entram no perfil Econômico como se fossem grátis.
- No tutorial a primeira etapa é "Conseguir a base mágica": o jogador informa o item que conseguiu
  (o app avisa se ele não tem os mods recomendados) e o tutorial continua dele.

## Tutorial

O app nunca supõe o resultado de uma ação aleatória. Após cada ação o jogador informa raridade e
mods reais; o resultado é validado (mod existe na base, nível, grupos, limites). Se o resultado não
estiver entre os possíveis da ação, ele é registrado como **inesperado** com aviso.
