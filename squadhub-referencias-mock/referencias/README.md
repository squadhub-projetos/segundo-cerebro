# Pacote mock | Segundo Cérebro SquadHub

Conteúdo inteiramente fictício para validar um frontend local. Não representa ofertas, aulas ou resultados reais da empresa. Não inclui logo.

## Instalação
Extraia o ZIP na pasta C:\Projetos\segundo-cerebro-squadhub. O resultado deve ser C:\Projetos\segundo-cerebro-squadhub\referencias\README.md. Se a pasta referencias já existir, mescle as pastas preservando seu logo e arquivos existentes. Não coloque uma pasta referencias dentro de outra.

Abra GALERIA.html no navegador para conferir as capas e os textos. Ela funciona sem instalar pacotes. O campo de busca filtra cartões; clique em Detalhes para consultar o conteúdo.

Envie ao Claude Code o conteúdo de instrucoes/PROMPT-CLAUDE.md junto ao prompt principal de desenvolvimento.

## Conteúdo
- 30 registros: 9 criativos, 3 páginas, 3 cursos e 15 aulas.
- 27 relações explícitas: 9 direcionamentos, 3 apresentações de curso e 15 vínculos de aula.
- 3 coleções temáticas e 7 temas, incluindo Processos como tema compartilhado.
- 30 capas SVG locais, 960 × 540, editáveis.
- 30 textos Markdown completos para os painéis.
- JSON completo e arquivos separados equivalentes; importar apenas uma representação.
- Contrato TypeScript, posições iniciais e tokens CSS provisórios.

## Convenções
Caminhos de thumbnailPath e contentPath são relativos a esta pasta. No Vite, publique as mídias em public/referencias/midias. Dados, relações e posições ficam separados. IDs não devem ser gerados a partir dos títulos ao editar.

As posições são sementes para o layout, não garantem ausência de sobreposição em qualquer tamanho de cartão. Todas as relações são direcionais. Temas não são nós nesta amostra.

## Cenários de teste
1. Pesquisar “follow-up”: localizar o criativo e a aula correspondentes.
2. Filtrar tipo Aula e tema CRM: encontrar cinco aulas.
3. Selecionar Operação comercial conectada: visualizar uma página e cinco aulas relacionadas.
4. Abrir um criativo: exibir a capa e o texto, com acesso à página relacionada.
5. Filtrar Processos: encontrar os 30 conteúdos sem criar novas relações.
6. Criar um novo conteúdo, recarregar e confirmar persistência.
7. Arrastar um nó: apenas sua posição muda, não suas relações.

## Limitações intencionais
Não contém integração, IA, banco de dados, autenticação, vídeos, PDFs ou URLs de produção. As páginas são conteúdos de exemplo para prévia, sem site externo ativo. A galeria é somente um catálogo de referência.
