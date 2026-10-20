# POE2 Crafting Assistant

Aplicativo web para **planejar, calcular e acompanhar crafting de equipamentos no Path of Exile 2**.
Interface em português brasileiro (padrão) e inglês, tema escuro, responsiva (desktop, tablet e celular).

> Ferramenta de fã, sem afiliação com a Grinding Gear Games.

## Usar agora

- **No navegador (PC ou celular):** https://marcellobf.github.io/poe2-crafting-assistant/
  Dá para instalar como app pelo ícone de instalar na barra de endereço.
- **Executável para Windows:** baixe `POE2-Crafting-Assistant-Setup-x.y.z.exe` em
  [Releases](https://github.com/MarcelloBF/poe2-crafting-assistant/releases/latest) e instale
  (atalho no menu Iniciar e na área de trabalho). **Só é preciso baixar uma vez:** o app procura versões novas
  ao abrir, a cada hora e quando você volta para a janela dele, baixa sozinho e oferece reiniciar; se você escolher "Depois", instala ao fechar.

  O executável não tem certificado digital pago, então o Windows pode mostrar "O Windows protegeu o computador".
  Clique em **Mais informações → Executar assim mesmo**.

Projetos e configurações ficam salvos no seu próprio navegador/computador; nada é enviado a servidores.
Preços: o executável consulta o poe.ninja direto; o site usa uma cópia que o GitHub Actions renova a cada 6 horas.

## O que o app faz

| Área | Função |
|---|---|
| **Criar item** | Construtor visual: categoria → base → nível do item → raridade → modificadores desejados (tier mínimo, valor mínimo, obrigatório/opcional, prioridade). Valida compatibilidade e bloqueia itens impossíveis, explicando o motivo. |
| **Importar item** | Envie uma captura de tela (arraste, escolha ou Ctrl+V) ou cole o texto do item (Ctrl+C / Ctrl+Alt+C no jogo). OCR no próprio navegador (tesseract.js); cada linha é conferida com os afixos do jogo: possível, valor impossível na base, não existe na base ou não reconhecido — com sugestão de onde o mod existe. Gera o objetivo e abre o passo a passo, ou continua o crafting a partir do item. |
| **Meus projetos** | Salvar, duplicar, editar, excluir e retomar projetos (persistidos no navegador). |
| **Tutorial do projeto** | Passo a passo adaptativo: recomenda a próxima ação, mostra as chances, e **exige que o jogador informe o resultado real** antes de recomendar a seguinte. Botões: confirmar resultado, informar falha, resultado diferente do esperado, registrar modificadores obtidos, voltar uma etapa, recalcular estratégia, encerrar projeto, base nova. |
| **Calculadora** | Distribuição exata do resultado de uma ação ou sequência; chance de família/tier; tentativas esperadas; chance de valor após Divine. |
| **Simulador** | Monte Carlo de uma estratégia completa ou sequência fixa, com distribuição de resultados, custos observados e comparação com o cálculo exato (aviso de divergência quando \|z\| > 4). |
| **Comparador** | Simula todas as estratégias compatíveis e escolhe os perfis **Econômico**, **Equilibrado** e **Maior consistência**, sempre com o critério explícito. |
| **Modificadores** | Banco pesquisável de afixos por categoria, base, lado, atributo; tiers, valores, nível, grupo, categorias compatíveis, métodos, chance e fonte. |
| **Histórico** | Todas as tentativas registradas, com filtros. |
| **Configurações** | Idioma, pesos (hipótese/tabela importada), regras de moedas, essências, preços (poe.ninja ou manuais), backup. |

Todo número exibido traz um selo de confiança: **Confirmado**, **Estimado** (com as hipóteses listadas) ou **Indisponível**.

## Requisitos

- Node.js 20+ (testado com 24 LTS)

## Executar

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:5173. O banco de dados inicial (PoE2 0.5.5.4.2) já está em `public/data/poe2/`.

Build de produção (gera `dist/`, que pode ser servido por qualquer servidor estático):

```bash
npm run build
```

Executável Windows (gera `release/`):

```bash
npm run app:dist
```

## Publicação

- `.github/workflows/pages.yml` — a cada push na `main` (e a cada 6 h, para renovar os preços) roda os testes, gera o build e publica no GitHub Pages.
- `.github/workflows/release.yml` — ao enviar uma tag `vX.Y.Z` (com a mesma versão do `package.json`), gera o instalador e anexa à Release junto com o `latest.yml`, que os apps instalados consultam para se atualizar (`electron/updater.cjs`, log em `%APPDATA%\poe2-crafting-assistant\updater.log`).

## Testes

```bash
npm test
```

116 testes automatizados cobrem: compatibilidade de mods, limites de prefixos/sufixos (inclusive bases que alteram o limite), requisitos de nível, regras de cada moeda/presságio/essência, cálculos de probabilidade com resultados conhecidos (conferidos à mão), simulação vs. cálculo exato, estratégias, custos, projeto/tutorial, importador de dados, integridade do dataset real e traduções.

## Atualizar dados

```bash
npm run data:download
```

```bash
npm run prices:update -- --league "Standard"
```

Detalhes em [docs/ATUALIZAR_DADOS.md](docs/ATUALIZAR_DADOS.md).

## Documentação

- [docs/REGRAS.md](docs/REGRAS.md) — regras de crafting implementadas e como os cálculos funcionam
- [docs/FONTES_E_INTEGRACOES.md](docs/FONTES_E_INTEGRACOES.md) — fontes de dados avaliadas e condições de uso
- [docs/ATUALIZAR_DADOS.md](docs/ATUALIZAR_DADOS.md) — processo de atualização
- [docs/LIMITACOES.md](docs/LIMITACOES.md) — limitações conhecidas

## Estrutura

```
scripts/            importador RePoE e atualizador de preços (Node)
public/data/poe2/   dataset do jogo gerado (meta, bases, mods, traduções de stats)
src/data/           tipos e regras de crafting (com fonte e confiança)
src/engine/         motor: pool de mods, ações, probabilidade, estratégias, simulação, custos, projeto/tutorial
src/worker/         Web Worker para simulações pesadas
src/i18n/           dicionários pt-BR / en e templates de texto de mods em PT
src/store/          persistência (localStorage) e carregamento do dataset
src/pages/          telas
tests/              testes Vitest
```
