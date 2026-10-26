import { Plus, Settings2 } from 'lucide-react'

interface Props {
  brainName: string
  /** `no-types`: o cérebro ainda não tem estrutura. `no-contents`: tem tipos, mas nenhum conteúdo ainda. */
  kind: 'no-types' | 'no-contents'
  onConfigure: () => void
  onNew: () => void
}

/** Estado vazio de um cérebro (sem erro): convida a configurar a estrutura ou a criar o primeiro conteúdo. */
export function BrainEmpty({ brainName, kind, onConfigure, onNew }: Props) {
  return (
    <div className="brain-empty" role="status">
      <div className="brain-empty-card">
        {kind === 'no-types' ? (
          <>
            <h2>Seu cérebro de {brainName} ainda está vazio.</h2>
            <p>Comece definindo os tipos de conhecimento e suas conexões.</p>
            <button type="button" className="btn btn-primary" onClick={onConfigure}>
              <Settings2 size={16} aria-hidden="true" />
              Configurar estrutura
            </button>
          </>
        ) : (
          <>
            <h2>Ainda não há conteúdo em {brainName}.</h2>
            <p>Crie o primeiro item ou ajuste os tipos e as conexões na tela Conexões.</p>
            <div className="brain-empty-actions">
              <button type="button" className="btn btn-primary" onClick={onNew}>
                <Plus size={16} aria-hidden="true" />
                Novo conteúdo
              </button>
              <button type="button" className="btn btn-ghost" onClick={onConfigure}>
                Ver estrutura
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
