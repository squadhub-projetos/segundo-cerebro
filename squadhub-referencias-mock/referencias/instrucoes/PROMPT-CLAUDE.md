# Complemento ao prompt de desenvolvimento

A pasta referencias/ contém o pacote completo de dados de demonstração. Use estes arquivos como fonte inicial, preservando IDs, textos e relações. Não crie uma segunda base fictícia.

1. Leia referencias/README.md e dados/grafo-completo.json.
2. O JSON completo é equivalente aos arquivos separados. Escolha uma forma de importação; não concatene as duas.
3. Use os tipos em dados/tipos.ts como contrato inicial, adaptando a arquitetura sem alterar a semântica dos dados.
4. Copie midias/ para public/referencias/midias/ para servir os SVGs no Vite. Na interface, resolva thumbnailPath com `${import.meta.env.BASE_URL}referencias/${content.thumbnailPath}`. Não use caminhos C:\ nem /workspace/ no código da interface.
5. bodyMarkdown contém o texto pronto para o painel de detalhes. Os arquivos conteudos/*.md são a cópia legível para referência. Não é necessário carregá-los por fetch.
6. Use posições apenas como ponto de partida. Recalcule o layout conforme as dimensões reais dos cartões. Organize três conjuntos exploráveis. Não transforme o resultado numa linha única.
7. Os temas são metadados de busca. Compartilhar um tema não cria uma aresta por si só.
8. Preserve os tipos de relações: criativo direciona-para página; página apresenta curso; curso contem aula.
9. Todas as capas são ilustrativas. Não há vídeo, PDF, site publicado ou checkout real. Mostrar texto e capa; não inventar botões de reprodução ou links ativos.
10. O logo será fornecido pelo usuário. As cores do pacote são provisórias. Atualize a identidade quando o logo e a paleta oficial estiverem disponíveis.
11. Comece o localStorage com esta base somente quando não houver estado salvo válido. Criar, editar ou mover nós não deve sobrescrever os arquivos de referência. Restaurar demonstração deve pedir confirmação.
12. Valide que existem 30 conteúdos e 27 relações antes de renderizar. Se alguma mídia falhar, exiba fallback legível.
13. Desenvolva o frontend conforme o prompt principal. A galeria HTML é uma referência do acervo, não o design final do aplicativo.
