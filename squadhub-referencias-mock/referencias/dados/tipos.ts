export type ContentType = 'criativo' | 'pagina' | 'curso' | 'aula';
export type ContentStatus = 'publicado' | 'finalizado' | 'em-producao';
export type RelationType = 'direciona-para' | 'apresenta' | 'contem';
export interface MockContent {
  id: string; title: string; type: ContentType; description: string;
  bodyMarkdown: string; themes: string[]; status: ContentStatus; collectionId: string;
  thumbnailPath: string; contentPath: string;
  material: { kind: 'illustrative'; isIllustrative: true; caption: string };
  externalReference: null; isMock: true;
}
export interface MockRelation { id: string; source: string; target: string; type: RelationType; isMock: true }
export interface Theme { id: string; label: string }
export interface Collection { id: string; name: string; color: string }
export interface GraphData {
  metadata: { schemaVersion: string; isMock: true; locale: string; assetBase: string; note: string };
  contents: MockContent[]; relations: MockRelation[]; themes: Theme[];
  positions: Record<string, { x: number; y: number }>; collections: Collection[];
}
