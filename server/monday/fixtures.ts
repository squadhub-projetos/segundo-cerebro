import type { RawBoard, RawBoards, RawColumn, RawColumnValue, RawItem } from './types.js'

/**
 * DADOS SINTÉTICOS para desenvolvimento e testes (MONDAY_FIXTURE=1). Imitam o formato da API da monday, mas NÃO são os dados
 * reais da SquadHub e nunca são usados sem essa variável.
 */

const cv = (id: string, type: string, text: string | null, extra: Partial<RawColumnValue> = {}): RawColumnValue => ({ id, type, text, value: null, ...extra })

const infoColumns: RawColumn[] = [
  { id: 'status', title: 'Status', type: 'status' },
  { id: 'plataforma', title: 'Plataforma', type: 'dropdown' },
  { id: 'tema', title: 'Tema', type: 'dropdown' },
  { id: 'lancamento', title: 'Data de lançamento', type: 'date' },
  { id: 'aulas', title: 'Aulas', type: 'board_relation' },
]

function info(id: string, name: string, status: string, platform: string, theme: string, date: string, lessonIds: string[] = []): RawItem {
  return {
    id,
    name,
    url: `https://squadhub.monday.com/boards/1/pulses/${id}`,
    group: { id: 'g1', title: 'Infoprodutos' },
    column_values: [
      cv('status', 'status', status),
      cv('plataforma', 'dropdown', platform),
      cv('tema', 'dropdown', theme),
      cv('lancamento', 'date', date),
      cv('aulas', 'board_relation', lessonIds.length ? 'Aulas vinculadas' : '', { linked_item_ids: lessonIds }),
    ],
  }
}

const courseColumns: RawColumn[] = [
  { id: 'status', title: 'Status', type: 'status' },
  { id: 'modulo', title: 'Módulo', type: 'text' },
  { id: 'conteudo', title: 'Descrição da aula', type: 'long_text' },
  { id: 'resp', title: 'Responsáveis', type: 'people' },
  { id: 'produto', title: 'Infoproduto', type: 'board_relation' },
]

function lesson(id: string, name: string, groupId: string, groupTitle: string, status: string, module: string, infoIds: string[] = []): RawItem {
  return {
    id,
    name,
    url: `https://squadhub.monday.com/boards/2/pulses/${id}`,
    group: { id: groupId, title: groupTitle },
    column_values: [
      cv('status', 'status', status),
      cv('modulo', 'text', module),
      cv('conteudo', 'long_text', `Conteúdo da aula "${name}" (dado sintético).`),
      cv('resp', 'people', 'Equipe Conteúdo'),
      cv('produto', 'board_relation', infoIds.length ? 'Produto' : '', { linked_item_ids: infoIds }),
    ],
  }
}

const youtubeColumns: RawColumn[] = [
  { id: 'status', title: 'Status de produção', type: 'status' },
  { id: 'tema', title: 'Tema', type: 'dropdown' },
  { id: 'data', title: 'Planejamento', type: 'date' },
  { id: 'roteiro', title: 'Roteiro', type: 'long_text' },
  { id: 'link', title: 'Link do YouTube', type: 'link' },
  { id: 'produto', title: 'Infoproduto', type: 'board_relation' },
]

function video(id: string, name: string, status: string, theme: string, date: string, url: string, infoIds: string[] = []): RawItem {
  return {
    id,
    name,
    url: `https://squadhub.monday.com/boards/3/pulses/${id}`,
    group: { id: 'v', title: 'Vídeos' },
    column_values: [
      cv('status', 'status', status),
      cv('tema', 'dropdown', theme),
      cv('data', 'date', date),
      cv('roteiro', 'long_text', `Roteiro do vídeo "${name}" (dado sintético).`),
      cv('link', 'link', url),
      cv('produto', 'board_relation', infoIds.length ? 'Produto' : '', { linked_item_ids: infoIds }),
    ],
  }
}

export function buildFixtureBoards(): RawBoards {
  const infoproducts: RawBoard = {
    id: '18433730926',
    name: 'Controle de Infoprodutos',
    groups: [{ id: 'g1', title: 'Infoprodutos' }],
    columns: infoColumns,
    items: [
      info('101', 'Curso Copilot', 'Publicado', 'Memberkit', 'Copilot', '2026-03-10'),
      info('102', 'Curso Claude', 'Em produção', 'Memberkit', 'Claude', '2026-08-01'),
      info('103', 'Mini Curso ChatGPT', 'Finalizado', 'Memberkit', 'ChatGPT', '2025-11-20'),
      info('104', 'Prompts de Gestão Estratégica', 'Publicado', 'Memberkit', 'Gestão', '2026-01-15'),
      info('105', 'Curso de Automações', 'Em produção', 'Hotmart', 'Automação', '2026-10-30'),
    ],
  }
  const courses: RawBoard = {
    id: '18433759798',
    name: 'Controle de Cursos 2.0',
    groups: [
      { id: 'a', title: 'Memberkit - Minicurso ChatGPT' },
      { id: 'b', title: 'Memberkit - Prompts de Gestão Estratégica' },
      { id: 'c', title: 'Copilot - Curso' },
      { id: 'd', title: 'Claude - Curso' },
      { id: 'e', title: 'Memberkit - Curso Piloto Antigo' },
    ],
    columns: courseColumns,
    items: [
      lesson('201', 'Primeiros Passos no ChatGPT', 'a', 'Memberkit - Minicurso ChatGPT', 'Publicado', 'Módulo 1'),
      lesson('202', 'Recursos Avançados do ChatGPT', 'a', 'Memberkit - Minicurso ChatGPT', 'Publicado', 'Módulo 1'),
      lesson('203', 'Projeto Final e Próximos Passos', 'a', 'Memberkit - Minicurso ChatGPT', 'Finalizado', 'Módulo 2'),
      lesson('204', 'Introdução: Prompts de Gestão Estratégica', 'b', 'Memberkit - Prompts de Gestão Estratégica', 'Publicado', 'Módulo 1'),
      lesson('205', 'Sistema: do Prompt para a Gestão Real', 'b', 'Memberkit - Prompts de Gestão Estratégica', 'Publicado', 'Módulo 1'),
      lesson('206', 'Engenharia de Prompt', 'c', 'Copilot - Curso', 'Publicado', 'Módulo 2'),
      lesson('207', 'Introdução', 'c', 'Copilot - Curso', 'Publicado', 'Módulo 1'),
      lesson('208', 'Engenharia de Prompt', 'd', 'Claude - Curso', 'Em produção', 'Módulo 2', ['102']),
      lesson('209', 'Introdução', 'd', 'Claude - Curso', 'Em produção', 'Módulo 1', ['102']),
      lesson('210', 'Fundamentos do Claude Projects', 'd', 'Claude - Curso', 'Em produção', 'Módulo 3', ['102']),
      lesson('211', 'Aula antiga sem produto', 'e', 'Memberkit - Curso Piloto Antigo', 'Finalizado', 'Módulo 1'),
    ],
  }
  const youtube: RawBoard = {
    id: '18426268819',
    name: 'YouTube',
    groups: [{ id: 'v', title: 'Vídeos' }],
    columns: youtubeColumns,
    items: [
      video('301', 'Como usar Copilot no Teams', 'Publicado', 'Copilot', '2026-02-02', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', ['101']),
      video('302', 'Claude Projects na prática', 'Em produção', 'Claude', '2026-09-12', ''),
      video('303', '5 prompts para gestão de projetos', 'Publicado', 'Gestão', '2026-04-04', 'https://youtu.be/abcdefghijk'),
    ],
  }
  return { infoproducts, courses, youtube }
}
