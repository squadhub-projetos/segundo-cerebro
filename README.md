# Segundo Cérebro | SquadHub

Primeira versão do frontend para organizar, visualizar e explorar conexões entre conteúdos da SquadHub.
A navegação é em grafo (inspirada no Obsidian): cada nó mostra a miniatura do conteúdo e abre um painel de detalhes.

> **Os dados são fictícios** (pacote mock de demonstração) e o modelo de conteúdo é **provisório**:
> Criativo → Página → Curso → Aula. Esta versão serve para validar a experiência enquanto o discovery continua.

## Requisitos

- Node.js 20 ou superior e npm.

## Instalação e execução

```powershell
npm.cmd install
npm.cmd run dev
```

Abra o endereço exibido (normalmente http://localhost:5173/).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm.cmd run dev` | Servidor de desenvolvimento |
| `npm.cmd run build` | Verificação de tipos e build de produção em `dist/` |
| `npm.cmd run preview` | Serve o build localmente |
| `npm.cmd run typecheck` | Somente a verificação do TypeScript |
| `npm.cmd run lint` | ESLint |
| `npm.cmd run verify:data` | Confere IDs, relações e caminhos de mídia do pacote importado |
| `npm.cmd run gen:thumbs` | Regenera as miniaturas sem texto em `public/referencias/midias` |

## O que existe

- Grafo com pan, zoom, arrastar nós, ajustar à tela, reorganizar e legenda.
- Busca (título, descrição e temas; ignora acentos e caixa) combinada com filtros de tipo, tema e status.
- Painel de detalhes com capa, Markdown, temas e relações de entrada e saída.
- Criar e editar conteúdos e vínculos, com validação de relações compatíveis.
- Persistência em `localStorage` (conteúdos, relações e posições) e “Restaurar demonstração” no menu secundário.
- Layout responsivo: filtros recolhíveis e painel como drawer em telas estreitas.

## Experiência de exploração (segunda rodada)

- **Hierarquia dos nós**: cursos são os centros dos conjuntos (maiores), páginas são a ponte, criativos destacam a miniatura
  e aulas são compactas. A caixa de cada tipo é fixa (`src/lib/dimensions.ts`) e é usada pelo layout, pelo posicionamento
  de novos nós e pela ancoragem das arestas.
- **Zoom semântico** (`src/lib/zoom.ts`): três níveis com histerese.
  Distante (< 0,66): ícones, título só em cursos e páginas, criativos como miniatura. Intermediário (0,66 a 1,05):
  título e tipo. Próximo (≥ 1,05): capa, título, status e descrição do curso. As camadas fazem fade entre si e a caixa
  do nó não muda, então as arestas não saltam.
- **Hover** (180 ms): elevação e brilho na cor do conjunto aplicados ao elemento interno `.node-inner`, nunca ao
  transform de posicionamento; conexões diretas e vizinhos são realçados e o restante esmaece. Hover é temporário, seleção
  é persistente. Entrada e saída têm pequenos atrasos para não piscar ao atravessar nós.
- **Câmera**: clicar em um nó só desloca a vista se ele ficaria fora da área livre (fora do painel e da barra de
  controles), sem alterar o zoom. Navegar por um relacionado move a câmera suavemente até a área livre. Clicar no fundo
  limpa a seleção e preserva a câmera.
- **Arestas**: curvas suaves com ponta na borda do nó. Na seleção ou no hover mostram cor do conjunto, rótulo e um pulso
  de movimento ao longo do traçado; as demais ficam estáticas.
- **Reorganizar**: o layout é recalculado e as posições são interpoladas por quadros (600 ms), então nós e arestas se
  movem juntos; a câmera acompanha. Posições salvas nunca são alteradas sem esta ação.
- **Interface**: cabeçalho compacto, filtros em popover com contador, chips das seleções ativas sobre o canvas, barra
  flutuante de controles com tooltips e painel de detalhes em vidro fosco. Durações e easing: `src/lib/motion.ts` e
  `tokens.css`. `prefers-reduced-motion` desliga animações e transições de câmera.
- **Miniaturas**: as capas originais continham texto (repetindo o título do nó). `npm.cmd run gen:thumbs` gera cópias sem
  texto, com um motivo por tipo na cor do conjunto, somente em `public/referencias/midias`.

## Identidade SquadHub e interação (terceira rodada)

- **Logo**: `public/brand/logo-squadhub.svg` (arquivo vetorial fornecido, usado sem alterações e com proporção preservada,
  em `TopBar.tsx`). O verde e o logo da Gaustec, vistos nas referências de apresentação, pertencem ao cliente e **não**
  fazem parte da identidade da plataforma.
- **Paleta**: aproximação extraída do logo (azul `#009ADC`) e das referências (azul-marinho muito escuro, ciano, texto claro).
  Valores estimados, não um manual oficial; tudo centralizado em `src/styles/tokens.css` (`--brand-*`) e `BRAND_CYAN`
  em `components/meta.tsx`. Botões, foco, seleção, painel, arestas ativas e brilho dos nós usam a marca; as cores dos
  conjuntos ficam secundárias (ícones, tinta suave dos nós e halos).
- **Dimensões**: curso 320×214, página 280×136, criativo 260×196, aula 240×96 (`src/lib/dimensions.ts`). A folga mínima
  entre caixas no layout é 56 px, cobrindo hover, brilho e anel de seleção. As fontes não foram reduzidas; títulos têm
  2 a 3 linhas reservadas e status/tipo não quebram.
- **Proximidade do mouse**: `useProximity` (em `GraphView.tsx`) escreve `--prox` (0 a 1) nos nós a até 300 px do cursor, sem
  re-renderizar o React nem mover o layout; o CSS converte em escala, elevação e brilho progressivos. Desligado em touch,
  durante o arraste e com `prefers-reduced-motion`.
- **Detalhes**: o painel entra com deslocamento, escala e brilho, a capa faz zoom com reflexo, o conteúdo e os
  relacionados aparecem em sequência e um anel se expande no nó selecionado. Ao fechar, o painel sai com animação.

## Pesquisa, presença e continuidade (quarta rodada)

- **Presença em vez de remoção**: todos os nós e arestas permanecem montados; a busca só alterna `presence-in/out` (e a classe
  `is-out` do wrapper). A saída (220 ms, escala 0,96) e a entrada (280 ms) são transições CSS, então são interrompíveis:
  apagar a consulta no meio da saída reverte a partir do estado atual, sem remontar cards, timers ou callbacks antigos.
  Nós em saída perdem clique, foco, seleção e arraste na hora e ficam `visibility:hidden` ao final. Os dados salvos não mudam.
- **Debounce de 150 ms** (`useDebouncedQuery` em `App.tsx`): o campo responde na hora; os resultados lógicos só são
  recalculados quando o debounce fecha. Limpar o campo é imediato. O contador e as listas usam o resultado lógico.
- **Por que apareceu** (`src/lib/search.ts`): comparação sem acento/caixa com mapeamento de volta ao texto original, sem
  regex e sem HTML. Destaque no título; "Tema: …" ou "Descrição: …trecho…" só quando o título não explica a correspondência.
- **Resultados no zoom distante**: com busca/filtro ativo, aulas e criativos mostram o título mesmo no nível distante. Além
  disso, uma lista compacta sob a busca (título, tipo, motivo; setas e Enter funcionam) seleciona e revela o nó.
- **Câmera**: digitar nunca move a câmera nem o layout. "Enquadrar resultados" anima a câmera na área livre (fora do painel e
  da barra de controles) com zoom máximo de 0,9. Limpar a busca preserva a câmera.
- **Estado vazio**: aparece depois da saída dos cards, mostra a consulta e permite limpar a pesquisa e os filtros
  separadamente (limpar pesquisa devolve o foco ao campo). Se o conteúdo aberto deixar de corresponder, o painel fecha com
  animação e a seleção é limpa (não reabre ao limpar a busca).
- **Zoom semântico**: só a camada do nível atual existe no DOM (entrada de 140 ms, sem camada de saída), então nunca há dois
  títulos sobrepostos; a histerese de `zoom.ts` foi mantida.
- **Camadas de efeito** (sem multiplicar): presença no `.node`, proximidade/hover/seleção no `.node-inner`, posição no wrapper do
  React Flow. Itens não relacionados perdem borda, brilho e saturação antes de perder opacidade (mínimo de 0,82).
- **Fundo**: base quase preta azul-marinho com gradiente e forma orgânica discretos; cards mais opacos.
- **Painel**: trocar de conteúdo anima apenas o interior; fechar conclui a animação antes de desmontar.

## Busca no mapa, conexões e exclusão (quinta rodada)

- **Busca dentro do mapa**: a pesquisa de texto não abre lista. Quem não corresponde fica visível e esmaecido, resultados ganham
  brilho (título = forte; tema/descrição = intermediário) e as conexões entre resultados ganham presença. A lista detalhada é
  opcional: chevron à direita do campo (anima ao mudar os resultados), altura limitada, hover destaca o nó no mapa, clique
  centraliza e fecha a lista mantendo a pesquisa; fecha ao clicar fora ou com Escape. Filtros de tipo/tema/status continuam
  tirando nós de cena com fade.
- **Criar conexões**: arraste pelo ponto ciano na lateral do card (aparece no hover/seleção). Só esse ponto inicia a conexão;
  arrastar o card move o card e arrastar o fundo move a câmera. A linha Bézier luminosa acompanha o cursor; o alvo válido
  reage (escala, contorno e brilho); soltar no vazio recolhe a linha. O tipo e a direção são **inferidos** pelos tipos dos
  conteúdos (cada par tem uma única relação possível), então não há popover de tipo; ligar uma aula a um curso grava sempre
  curso → aula. Duplicatas, autoconexão e pares incompatíveis são recusados com um aviso curto.
- **Remover conexão**: clique na linha, "Remover conexão" e confirmação no próprio menu. Nenhum conteúdo é excluído.
- **Excluir conteúdo**: ação discreta "Excluir conteúdo" no painel de detalhes, com confirmação. O nó sai com animação e as
  relações e a posição dele são removidas.
- **Cadastro**: tipo e status viraram controles segmentados; os vínculos ficaram em "Vínculos (gerenciamento alternativo)",
  recolhido (também é o caminho por teclado para criar/remover vínculos).

## Conexões por trás dos cards e layout assistido (sexta rodada)

- **Origem lógica no centro, linha por trás**: toda relação é traçada de centro a centro (`src/lib/edgeGeometry.ts`) e as
  arestas ficam abaixo dos cards (opacos), então a linha parece sair de trás de cada bloco. Só a seta, o rótulo e o menu usam o
  ponto em que a curva cruza a borda do card, para nunca invadirem o conteúdo legível. Cards esmaecidos (busca/foco) mantêm o
  fundo opaco; só o conteúdo esmaece.
- **Arrastar para conectar**: o ponto de interação continua sendo o handle ciano na lateral; a origem visual da linha em
  andamento é o centro do card (também por trás). O alvo válido ganha escala, brilho e a dica "Soltar para conectar".
- **Feedback ao concluir**: a linha é desenhada, um brilho percorre o traçado, a seta aparece com uma expansão luminosa, o
  destino pulsa com um anel e a linha "assenta" até o estilo normal (cerca de 1,5 s). Respeita `prefers-reduced-motion`.
- **Posicionamento assistido** (`src/lib/placement.ts`): novo conteúdo sem vínculo surge perto do foco (conteúdo selecionado
  ou centro da área visível); com vínculo, perto do conteúdo de origem. A colisão agora compara centros e tamanhos reais.
  Ao conectar dois conteúdos distantes, só uma "folha" (nó cujo único vínculo é o novo) é aproximada, mantendo a direção em que
  estava; nenhum outro nó se mexe. Tudo anima. "Reorganizar" continua sendo o recálculo completo, sob demanda.

## Conexão pelo contorno dos cards (sétima rodada)

- **Sem handle fixo**: não existe mais a bola azul. Ao aproximar o mouse do contorno de um card aparece um pequeno indicador
  que acompanha o perímetro continuamente (topo, base, lados e cantos arredondados). Arrastar a partir dele cria a conexão.
- **Projeção no perímetro** (`src/lib/boundary.ts`, `getNearestPointOnNodeBoundary`): ponto mais próximo de um retângulo com
  cantos arredondados (retângulo interno encolhido pelo raio + arco), com normal externa e distância assinada.
- **Zona magnética** (`src/components/BoundaryConnect.tsx`): faixa de 10 px para dentro e 14 px para fora **de tela** (dividida
  pelo zoom, limitada a 22% do menor lado). O centro do card continua selecionando e arrastando o card. Em toque só o card
  selecionado inicia pelo contorno. Sobre uma conexão o clique seleciona a conexão.
- **Gesto**: a origem fica congelada no ponto escolhido; a linha (Bézier que sai pela normal) fica abaixo dos cards. Perto de um
  alvo válido a ponta encaixa no contorno dele (indicador de destino que acompanha o perímetro, brilho e dica); alvo inválido
  mostra estado de recusa; soltar fora ou Esc recolhe a linha. Tudo com refs e requestAnimationFrame (sem estado React por
  movimento do mouse). Cursor: cruz na zona e "agarrando" durante o gesto.
- **Linha final**: depois de criada, a relação usa a aresta normal (centro a centro, por trás dos cards), que já sai pelo lado
  voltado ao outro card sem atravessá-lo; a linha do gesto se dissolve enquanto a aresta é desenhada, com brilho percorrendo,
  pulso no destino e assentamento (cerca de 0,8 s).

## Organização espacial assistida (oitava rodada)

Módulo `src/lib/spatial.ts` (sem biblioteca nova), em três níveis, do mais local ao mais global:

- **`placeNode`** (novo conteúdo, ou um nó re-posicionado): candidatos ao redor de cada vizinho em 8 raios proporcionais às
  dimensões reais e 24 direções (ou ao redor do foco, se não há vizinhos); colisão com margem (64 × 52) é restrição dura;
  entre os candidatos vale o menor custo: comprimento das conexões (ideal baseado nos tamanhos dos cards), cruzamentos e
  atravessamentos de cards, setores angulares já ocupados ao redor do vizinho, expansão do conjunto, equilíbrio em torno do
  núcleo, distância ao foco do usuário e (no re-posicionamento) deslocamento.
- **`optimizeLocalNeighborhood`** (ao conectar dois conteúdos): só o nó MENOS estável tenta se aproximar do outro, e só se o
  custo melhorar de forma clara. Nada além disso se move (testado: 641 → 484 de distância, demais nós intactos).
- **`organizeGraph`** (botão Reorganizar): reparo local por custo (primeiro as conexões longas, movendo a ponta menos estável;
  depois colisões/cruzamentos), redistribuição angular só de núcleos apinhados, colisões com margem e afastamento entre
  conjuntos. Se o ganho não compensa mexer nos nós, avisa "já está bem organizado" e não move nada. **Shift + clique** refaz tudo
  do zero (algoritmo anterior). A câmera só é reenquadrada se o resultado ficar parcialmente fora da tela.
- **Estabilidade**: peso por número de vínculos (hubs quase não se movem) e por posição manual (`pinned`, gravado ao soltar um
  arraste e persistido de forma retrocompatível). Um nó fixado à mão só volta se a conexão ficar absurdamente longa (> 2,2×).
- **Animação**: duração proporcional à distância (300–700 ms), só os nós que mudam, com escalonamento sutil a partir do centro
  da região afetada. Os títulos dos conjuntos acompanham porque o halo é calculado a partir das posições.
- Conteúdo sem conjunto herda o conjunto de quem ele conecta.

## Refinamentos: zoom de conexão e títulos de conjunto

- **Conexão só em zoom aproximado**: `CONNECTION_INTERACTION_MIN_ZOOM = 0.5` em `src/lib/zoom.ts`. Abaixo disso o contorno é
  parte normal do card (sem indicador, sem faixa magnética, sem cursor de conexão, sem início de arraste); um gesto já iniciado
  segue até o fim. Conexões existentes não são afetadas.
- **Títulos dos conjuntos**: derivados da caixa delimitadora atual dos nós do próprio conjunto (`ClusterHalos` em
  `GraphView.tsx`), com título acima e alinhado à esquerda da caixa (56 unidades de folga). Como as posições são animadas
  quadro a quadro, o título acompanha sem atraso. Nós sem conjunto herdam o do vizinho (`clusterAssignments`).

## Interação avançada no canvas

- **Menu de contexto** (`ContextMenu.tsx`): botão direito no fundo, em um card ou em um grupo selecionado (o menu do navegador é
  impedido só dentro do grafo). Abre junto ao cursor, inverte de lado perto das bordas, fecha com Escape, clique fora,
  roda/zoom ou ao escolher; só existe um por vez. Fundo: Novo conteúdo, Selecionar área, Organizar visualização. Card: Abrir,
  Editar, Duplicar, Excluir. Grupo: Duplicar/Excluir selecionados.
- **Novo conteúdo no ponto clicado**: o clique é convertido com `screenToFlowPosition` e vira a dica de posicionamento do
  mesmo formulário/`saveContent`; o card nasce ali (ou no lugar livre mais próximo) e a câmera não se move.
- **Duplicar** (`useStore.duplicateContents`, `lib/duplicate.ts`): copia tipo, descrição, texto, temas, status e conjunto;
  título "— cópia" (numerado se repetir); sem conexões; o grupo é deslocado junto para o lado livre mais próximo; entrada animada
  e destaque breve.
- **Excluir**: sempre com confirmação do app (um ou N conteúdos); remove relações e posições; o card sai com animação.
  Delete/Backspace abrem a mesma confirmação (ignorados em campos de texto e diálogos).
- **Seleção múltipla** (recursos nativos do React Flow): Shift + arrastar no fundo desenha o retângulo (interseção);
  Shift/Ctrl/Cmd + clique alterna; clique simples seleciona um; clique no vazio limpa. "Selecionar área" no menu arma o
  retângulo para um arraste sem Shift. Esc cancela (restaura a seleção anterior). O pan por arraste simples foi preservado.
- **Mover em grupo**: arrastar qualquer card selecionado move todos (posições relativas preservadas, arestas acompanham); as
  posições são gravadas pelo mesmo debounce de sempre e os nós passam a contar como posicionados à mão. Não há auto-layout.
- Prioridade dos gestos: botão direito → menu; handle de conexão → conexão; arrastar card → card/grupo; Shift + arrastar no
  vazio → área; arrastar no vazio → pan; roda → zoom.

## Navegação do canvas e desempenho da seleção

- **Convenção do mouse**: roda = zoom (em torno do cursor, nativo do React Flow, sem estado React); botão esquerdo no vazio =
  seleção por área (sem Shift); botão do meio + arrastar = pan; botão direito = menu; esquerdo em card = selecionar/mover
  (grupo, se selecionado); contorno do card = conexão. Duplo clique não dá zoom. O autoscroll nativo do botão do meio é
  impedido (`mousedown`/`auxclick` do botão 1 com `preventDefault`, sem parar a propagação do pan).
- **Causa das engasgadas** (medida): cada mudança de seleção refazia o objeto de TODOS os nós, então o React Flow readotava
  tudo, os 30 cards e as 27 arestas renderizavam de novo (≈70 a 190 ms por commit em dev) e cada nó que entrava na área
  disparava animações/sombras. Medido em dev (StrictMode, 25 mudanças): 1560 → 234 renders de card e 2808 → 204 de aresta.
- **Otimizações**: (1) cache por nó em `GraphView` (objeto novo só se algo que o afeta mudou); (2) a seleção do React Flow é
  aplicada em um `Set` e publicada no máximo uma vez por quadro, só se o conjunto mudou; (3) `onRemoveRelation` estável (antes
  invalidava os dados de todas as arestas a cada render do App) e `RelationEdge` com `memo`; (4) durante o retângulo
  (`.is-selecting`) transições, glow e anel ficam desligados (feedback instantâneo) e voltam ao soltar; (5) o brilho por
  proximidade não toca no DOM durante arraste/seleção; (6) a faixa de conexão agora é tratada na captura da janela, antes do
  React Flow, para o gesto de conexão não iniciar também uma seleção.
- Build de produção (30 nós): seleção com vai e volta, mediana de quadro 8,3 ms, p95 8,6 ms, 1 quadro > 33 ms, sem tarefas
  longas; arrasto de 10 nós em grupo p95 16,6 ms; pan p95 16,9 ms.

## Estrutura

```
public/referencias/midias/   Capas SVG publicadas (cópias; originais preservados)
scripts/                     Verificação dos dados importados
src/
  components/                Interface (TopBar, FilterBar, GraphView, ContentNode, DetailPanel, ContentForm...)
  data/grafo-completo.json   Base consolidada do pacote mock (única fonte importada)
  lib/                       Importação do mock, regras das relações, filtros, layout, posicionamento, storage
  state/useStore.ts          Estado da aplicação e persistência com debounce
  styles/                    tokens.css (variáveis), base.css, graph.css, panels.css
  types/                     Tipos de dados
referencias/                 Pasta original do projeto (preservada)
squadhub-referencias-mock/   Pacote mock original (preservado, não editar)
```

## Decisões técnicas

- **Importação**: somente `grafo-completo.json` (cópia em `src/data`); os JSONs separados do pacote não são carregados.
  `bodyMarkdown`, `thumbnailPath`, `themes` e `collectionId` são usados como descrito no pacote.
  A validação de 30 conteúdos e 27 relações roda antes de renderizar.
- **Layout**: `d3-force` executado de forma síncrona e estável (sem simulação contínua), por conjunto temático, com resolução
  de colisões retangulares conforme o tamanho dos cartões; os conjuntos são dispostos em grade. As posições do pacote são só
  sementes. O layout inicial é calculado uma vez e salvo; nada é reorganizado ao filtrar ou abrir o painel.
- **Relações**: regras centralizadas em `src/lib/relations.ts`. Temas compartilhados não criam arestas.
- **Persistência**: chave `squadhub:segundo-cerebro:v1`. Posições são gravadas com debounce (400 ms) e ao sair da página;
  dados inválidos ou incompatíveis são descartados com aviso, e falhas de gravação aparecem em um banner.

## Identidade visual (pendência)

Não há logo nem paleta oficial nas pastas do projeto (a pasta `referencias/` está vazia e o pacote mock não inclui logo).
Procurei novamente em `referencias/` (continua vazia). Foi usada a **paleta provisória do pacote**, centralizada em `src/styles/tokens.css`, e a barra superior usa uma identificação tipográfica ("SquadHub / Segundo Cérebro"), sem logo inventado. Quando o logo oficial estiver disponível, basta adicioná-lo em `public/` e trocar a identificação tipográfica em
`TopBar.tsx`, além de revisar os tokens. As capas originais em `squadhub-referencias-mock` não foram alteradas; só as cópias publicadas foram adaptadas.

## Limitações desta versão

- Dados fictícios; capas ilustrativas. Não há vídeos, PDFs ou páginas externas, então não existem botões de reprodução ou links.
- Modelo de conteúdo provisório (quatro tipos e três relações).
- Sem integrações (monday, Supabase, IA), login, upload de arquivos ou deploy.
- Dados vivem apenas no `localStorage` do navegador; não há sincronização entre dispositivos.
- Não há exclusão de conteúdos nem de vínculos fora do formulário de edição.
- Os temas disponíveis são os sete do pacote; não é possível criar novos temas.
- Layouts salvos antes da segunda rodada continuam como estão (nada é apagado); use "Reorganizar" para aplicar a nova composição.
- Em telas touch não há hover: a seleção por toque mostra as mesmas conexões e o painel.
- Com muitos conteúdos, manter todos os nós montados durante a busca pode pesar; hoje são 30.
- O ponto de conexão encolhe junto com o zoom: em zoom muito afastado fica pequeno; aproxime para conectar.
- Criar/remover conexões pelo mapa exige mouse ou toque; o gerenciamento alternativo no formulário cobre o teclado.
- Ao excluir um conteúdo o espaço não é reorganizado automaticamente (posições salvas são preservadas); use "Reorganizar".
- A aproximação automática só move nós "folha"; se ambos os conteúdos já têm outros vínculos nada é movido (use "Reorganizar").
- Em zoom muito próximo, o menu de uma conexão pode ficar sob o cabeçalho se a linha estiver no topo da tela.
- Conexões entre conjuntos diferentes não puxam os conjuntos para perto um do outro; a aresta fica longa por natureza.
- O custo de cruzamentos usa segmentos centro a centro (igual às arestas desenhadas), mas é heurístico e local.
- Não há testes automatizados; a verificação feita foi tipagem, lint, build e testes manuais no navegador.

## Arquivos originais

Preserve `referencias/` e `squadhub-referencias-mock/`. O aplicativo nunca os altera; criar, editar ou mover nós grava
somente no `localStorage`.

## Dados reais da monday (fonte de verdade)

O navegador lê o grafo em `GET /api/graph`, grava itens em `POST /api/mutate` e altera a ESTRUTURA em `/api/structure` (funções serverless da Vercel; no `npm run dev`, middleware do Vite com o MESMO código em `server/monday/`). O token (`MONDAY_API_TOKEN`) existe só no servidor.

### Schema (registry na monday)
Cada **tipo de conteúdo** é um board e cada **tipo de conexão** é uma coluna Connect Boards. O schema vive na própria monday, em dois boards administrativos globais (não são conteúdo do grafo; "SC" é só o prefixo técnico dos boards, o produto continua se chamando Segundo Cérebro) na pasta do cérebro (hoje "Cursos SH", workspace "Marketing 2.0"):

- `SC | Estrutura` (global): um item por tipo (Slug, Brain ID, Plural, Descrição, Board ID, Workspace ID, Folder ID, Ícone, Cor, Papel [Núcleo/Personalizado], Coluna de descrição, Prefixo, Ativo).
- `SC | Relações` (global): um item por conexão (Slug, Brain ID, Origem, Destino, Rótulo, Rótulo inverso, Natureza [Hierarquia/Associação], Cardinalidade, Coluna em [Origem/Destino], Coluna (ID), Coluna refletida (ID), Descrição, Ativo).

Os tipos núcleo (Infoproduto, Aula, YouTube) e as duas conexões atuais (`contem-aula`, `divulga`) são registrados SEM tocar nos boards existentes (`Registrar estrutura` na tela Conexões; boards com o prefixo antigo "Segundo Cérebro |" são renomeados, nunca recriados ou `POST /api/structure {"op":"init"}`). Enquanto o registry não existe, valem esses mesmos padrões (`src/brains/content/core.ts`), com os ids de coluna descobertos no schema real dos boards. O servidor inclui o schema no `GET /api/graph`; o cliente o mantém em memória (sem consulta a cada arrasto).

Leitura: cada item é um nó; cada conexão ativa diz em qual coluna a ligação é guardada (e a coluna refletida). A ligação é lida dos dois lados e deduplicada pelo par de ids (uma aresta por par); nada é inferido por nome, grupo ou tema. Escrita: o servidor lê antes a lista atual da coluna e grava o conjunto resultante (nunca sobrescreve), respeitando a cardinalidade.

### Criar tipos e conexões (tela Conexões)
- **+ Tipo de conteúdo**: nome, descrição, cérebro, ícone, "criar novo board". A prévia mostra o board (`SC | {Cérebro} | {Tipo no plural}`, por exemplo `SC | Projetos | Clientes`), workspace, pasta e colunas (Descrição, Status). Só depois da confirmação o servidor cria o board na pasta do cérebro, as colunas e o registro. Falhas no meio mostram o que já foi feito e oferecem "Tentar concluir configuração" (idempotente; nada é apagado).
- **+ Tipo de conexão**: origem, destino (podem ser o mesmo tipo), nome da relação, natureza e cardinalidade. Cria UMA coluna Connect Boards no board de origem (múltiplos itens e coluna refletida no destino quando aplicável) e registra a regra. Nunca é criada uma coluna por ligação entre itens.
- No mapa, ligar dois tipos sem regra mostra "Este tipo de conexão ainda não está configurado." com **Configurar conexão** (abre Conexões já com origem e destino).
- Não há exclusão de boards nem de colunas; tipos núcleo não podem ser removidos.

### Variáveis de ambiente
| Variável | Onde | Descrição |
| --- | --- | --- |
| `MONDAY_API_TOKEN` | servidor (obrigatória) | token com leitura e escrita; para estrutura precisa criar boards/colunas e ler workspaces |
| `MONDAY_API_VERSION` | servidor | padrão `2025-10` (criar colunas Connect Boards exige 2025-10 ou mais nova) |
| `MONDAY_*_BOARD_ID` | servidor | boards núcleo (padrões embutidos) |
| `MONDAY_WRITE_ENABLED` | servidor | `0` = somente leitura (inclui estrutura) |
| `MONDAY_STRUCTURE_ENABLED` | servidor | `1` habilita alterações de estrutura; em desenvolvimento vem ligado, na Vercel precisa ser explícito |
| `SCHEMA_ADMIN_KEY` | servidor | chave exigida (cabeçalho `x-admin-key`) para alterar estrutura; obrigatória na Vercel |
| `MONDAY_SCHEMA_NODETYPES_BOARD_ID`, `MONDAY_SCHEMA_CONNECTIONS_BOARD_ID` | servidor | opcionais (por padrão os boards de registry são achados pelo nome na pasta) |
| `ALLOWED_ORIGINS` / `APP_ORIGIN` | servidor | hosts extras aceitos nos POST (o host da requisição, `VERCEL_*URL` e localhost já são aceitos) |
| `MONDAY_CACHE_SECONDS` | servidor | cache do grafo por instância (padrão 30; "Atualizar dados" e qualquer gravação o invalidam) |
| `VITE_DATA_SOURCE` | cliente | `monday` (padrão) ou `mock` |

### Teste local
Preencha `MONDAY_API_TOKEN` no `.env`; `npm run dev`. Diagnóstico: `/api/schema` (colunas dos boards ativos), `/api/graph` (grafo + schema) e `GET /api/structure` (pasta, workspace, permissões). Para testar estrutura crie tipos `[TESTE] ...` e apague os boards, linhas do registry e colunas de teste depois (a aplicação não apaga boards nem colunas).

### Vercel
Settings → Environment Variables: `MONDAY_API_TOKEN` (Production e Preview, sensível). Para liberar alterações de estrutura em produção: `MONDAY_STRUCTURE_ENABLED=1` e `SCHEMA_ADMIN_KEY=<segredo>` (sem a chave a Vercel recusa). `MONDAY_WRITE_ENABLED=0` bloqueia toda escrita. `/api/graph` e `/api/mutate` ficam públicos a quem tiver a URL; ative *Deployment Protection* ou autenticação antes de divulgar.

### Cérebros (Conteúdo, Projetos, Marketing)
Cada tipo e cada conexão tem um `brainId` (coluna Brain ID dos boards `SC | Estrutura` e `SC | Relações`). A interface mostra e edita só o schema do cérebro ativo: mapa, busca, filtros, "Novo conteúdo" e a tela Conexões (origem e destino só listam tipos do mesmo cérebro; conexões entre cérebros ainda não são permitidas). Projetos e Marketing começam vazios: o mapa mostra "Seu cérebro ainda está vazio" com **Configurar estrutura**, e a tela Conexões mostra **Criar primeiro tipo de conteúdo**. O diálogo de novo tipo abre com o cérebro atual e mostra o nome do board antes de criar. Para criar um tipo ou uma relação não é preciso mexer no código nem fazer novo deploy.

## Assistente (IA)

Chat lateral à direita (ícone de brilho na barra superior) que interpreta pedidos em linguagem natural, **propõe** um plano e só o executa depois da confirmação do usuário. A monday continua só como armazenamento; a IA nunca fala com ela.

Fluxo: usuário → `POST /api/ai/chat` (OpenAI, Responses API, ciclo de ferramentas) → plano (sem gravar nada) → usuário clica **Criar agora** → `POST /api/ai/execute` → o servidor **revalida cada ação** e executa pelas mesmas funções do app (`runMutation`: criar item e ligar itens) → o mapa é recarregado → **Ver no mapa** / **Enquadrar itens criados**.

- **Ferramentas de leitura** (executam sozinhas): `get_brain_schema`, `search_content`, `get_content_details`.
- **Ferramentas de escrita** (só registram uma proposta no plano; nada é gravado): `create_content`, `connect_content`. Não existem ferramentas de exclusão, de criação de tipos/conexões nem de GraphQL.
- O modelo recebe o schema do cérebro ativo (tipos e conexões, em linguagem de negócio), conteúdos possivelmente relacionados e consulta o resto por busca; não recebe o grafo inteiro, tokens nem ids de coluna. Cada cérebro tem a sua conversa (guardada só no navegador, nesta sessão).
- Segurança: a chave `OPENAI_API_KEY` fica no servidor; texto do usuário não consegue pular a confirmação nem o schema (a execução é outro endpoint e valida tudo de novo); há limite de requisições por IP, checagem de origem e `MONDAY_WRITE_ENABLED=0` bloqueia a execução.

Variáveis: `OPENAI_API_KEY` (obrigatória para o assistente), `OPENAI_MODEL` (padrão `gpt-5.4-mini`), `AI_ENABLED=0` para desligar, `AI_MAX_STEPS`. Na Vercel, crie `OPENAI_API_KEY` (sensível) em Production/Preview; `/api/ai/*` ficam públicos como as demais rotas, então ative *Deployment Protection* antes de divulgar (cada pedido consome a cota da OpenAI).
