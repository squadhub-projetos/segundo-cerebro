# Segundo Cérebro SquadHub

Frontend local (React + TypeScript + Vite) para explorar conteúdos da SquadHub em um grafo. A SquadHub opera sobre a
monday.com; esta solução própria organiza e visualiza as conexões entre conteúdos.

## Contexto desta primeira versão

- Escopo: somente frontend com dados locais. Sem monday, Supabase, IA, login, deploy ou credenciais. Sem chat fictício.
- Modelo **provisório** autorizado pelo responsável: Criativo → Página → Curso → Aula.
  Relações: criativo `direciona-para` página; página `apresenta` curso; curso `contem` aula (sempre curso → aula).
- Dados **fictícios** do pacote `squadhub-referencias-mock/referencias` (30 conteúdos, 27 relações, 3 conjuntos).
  Importamos apenas `grafo-completo.json` (cópia em `src/data`). Preservar IDs, títulos, textos e relações.
- Identidade: logo oficial em `public/brand/logo-squadhub.svg` (não redesenhar). Paleta = aproximação a partir do logo e das referências, em `tokens.css`; não é manual oficial. Verde e logo da Gaustec são do cliente: não usar na plataforma. Tokens provisórios em `src/styles/tokens.css`; revisar quando houver identidade.

## Regras a manter

- Preservar `referencias/` e `squadhub-referencias-mock/`. Não remover nem editar esses arquivos.
- Temas são metadados de busca e filtro; **nunca** criar arestas por tema compartilhado.
- Regras de relação ficam em `src/lib/relations.ts` (compatibilidade, autorrelação, duplicata, ID inexistente).
- Capas via `import.meta.env.BASE_URL` + `referencias/` + `thumbnailPath` (`src/lib/media.ts`); sem caminhos do Windows.
- Não mostrar “Reproduzir” nem “Abrir página”: não existem vídeo nem URL.
- Dimensões por tipo em `src/lib/dimensions.ts` (usadas pelo nó, layout, posicionamento e arestas).
- Hover aplica efeitos só em `.node-inner` (nunca no transform do nó). Seleção é persistente; hover é temporário.
- Zoom semântico: níveis far/mid/near com histerese em `src/lib/zoom.ts`; a caixa do nó é fixa por tipo, não por nível.
- Reorganizar anima posições por quadros em `App.tsx` (`tweenPositions`); não gravar a cada quadro (debounce do store).
- Movimento: usar `MOTION`/`motionDuration` (`src/lib/motion.ts`); respeitar `prefers-reduced-motion`.
- Dimensões dos nós incluem folga para hover/brilho/seleção (layout usa margem de 56 px). Não encolher fonte para caber conteúdo: ajustar caixa.
- Proximidade do mouse: `--prox` escrito direto no DOM (sem estado React) em `useProximity`.
- Painel de detalhes mantém o último conteúdo durante a animação de saída (`held` em `App.tsx`).
- Busca: nunca desmontar nós/arestas ao filtrar. Alternar `presence-in/out` (CSS, interrompível); `GraphView` recebe todos os conteúdos e `matchedIds`. Debounce de 150 ms só no cálculo dos resultados; não recriar nós a cada tecla.
- Texto da busca: comparar com `src/lib/search.ts` (sem regex, sem HTML, grafia original preservada). Motivos só quando o título não explica.
- Zoom semântico: uma camada por nó (`key={level}`); proibido crossfade de textos entre níveis.
- Efeitos em camadas: presença em `.node`, hover/proximidade/seleção em `.node-inner`, posição no wrapper do React Flow. Hover não pode restaurar nó em saída.
- Câmera: digitar/limpar não move a câmera; só "Enquadrar resultados", seleção (mínimo necessário) e navegação.
- Conexões: criadas pelo contorno do card (`BoundaryConnect.tsx` + `lib/boundary.ts`), sem handles do React Flow (os handles dos nós são mínimos e invisíveis, só para as arestas). Estado do gesto via refs/rAF e `data-conn` no wrapper do nó. Tipo/direção inferidos em `inferRelation` (`src/lib/relations.ts`); persistência em `useStore.connect` (mesma lista `relations`).
- Busca de texto esmaece (`q-miss`) em vez de remover; filtros de tipo/tema/status usam presença (`presence-out`). Lista de resultados é opcional (chevron).
- Exclusão: `useStore.deleteContent` após animação de saída (`leaving` em `App.tsx`); remove relações e posição.
- Arestas: traçado centro a centro por trás dos cards (`edgeGeometry.ts`); seta/rótulo/menu no cruzamento com a borda. Cards precisam ser opacos. Nós informam `measured` fixo.
- Posicionamento/layout: `src/lib/spatial.ts` (`placeNode`, `optimizeLocalNeighborhood`, `organizeGraph`, `layoutCost`). Criar/conectar é sempre local; Reorganizar é gentil (Shift = do zero via `computeLayout`). Respeitar `pinned` (posição manual) e estabilidade por grau. `placement.ts` só serve de fallback em `storage.ts`.
- Canvas: menu de contexto próprio (`ContextMenu.tsx`; itens como dados, ações em `runMenuAction` no App), seleção múltipla pelos recursos do React Flow (`selectionMode` parcial, `multiSelectionKeyCode`), seleção do RF → `onSelectionChange` (1 = painel, 2+ = grupo). Duplicar sem relações; excluir sempre com `ConfirmDialog`.
- Miniaturas sem texto geradas por `npm.cmd run gen:thumbs` (só em `public/`); o título é texto da interface.
- Não rodar `fitView` nem reorganizar o grafo ao filtrar, selecionar ou abrir o painel. Só em “Ajustar à tela”,
  “Reorganizar”, “Restaurar demonstração” e na abertura inicial.
- Não gravar no `localStorage` a cada quadro: o estado passa por debounce em `src/state/useStore.ts`.
- Textos da interface em português do Brasil, sem emojis.

## Arquitetura

- `src/lib/layout.ts`: sementes estruturais (curso no centro) + `d3-force` síncrono por conjunto + resolução de sobreposição por tamanho de tipo + grade de conjuntos inclinada.
- `src/lib/placement.ts`: posição livre para novos nós, perto do vínculo escolhido.
- `src/lib/storage.ts`: chave versionada `squadhub:segundo-cerebro:v1`, validação do estado salvo.
- `src/components/RelationEdge.tsx`: aresta flutuante (reta entre bordas dos cartões); os nós têm handles invisíveis
  apenas porque o React Flow os exige.
- Nós e arestas são derivados do estado (React Flow controlado); somente mudanças de posição voltam ao estado.

## Comandos (PowerShell: usar `npm.cmd`)

`npm.cmd run dev`, `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run verify:data`.

## Dados live (monday)
- Leitura: `server/monday/{client,normalize,handler}.ts` → `api/graph.ts`/`api/schema.ts` (+ middleware em `vite.config.ts`) → `src/data/providers/*` → `useStore` (`mergeRemote` em `src/data/merge.ts` junta só layout local: posições/fixações).
- Escrita: `server/monday/mutations.ts` (`POST /api/mutate`, ops create/update/delete/link/unlink/duplicate) ← `src/data/providers/mondayWriter.ts` ← funções `*Remote` do `useStore`. O estado local só muda DEPOIS do sucesso na monday. Relação sempre gravada no lado da aula/vídeo com leitura prévia da lista (nunca sobrescrever).
- Um nó por item da monday (sem fusão por nome); grupo = metadado; arestas só de linked items (`relationSource: 'monday'`). Ids: `info:`/`lesson:`/`yt:` + id do item.
- Nunca colocar token no cliente/`VITE_`, nem logá-lo. Não criar colunas/grupos na monday. Testes de escrita com itens `[TESTE]` removidos ao final.
