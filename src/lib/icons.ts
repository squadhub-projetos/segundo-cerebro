import {
  BookOpen,
  Box,
  Clapperboard,
  FileText,
  Folder,
  FolderKanban,
  Lightbulb,
  Magnet,
  Mail,
  Megaphone,
  Package,
  Rocket,
  ShoppingCart,
  Star,
  Tag,
  Target,
  Users,
  Wrench,
  Layers,
  Globe,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Ícones que um tipo pode usar (o registry guarda só o NOME). Lista curada: evita importar a biblioteca inteira e mantém o
 * seletor da interface enxuto.
 */
export const ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  package: { label: 'Pacote', Icon: Package },
  'book-open': { label: 'Livro', Icon: BookOpen },
  clapperboard: { label: 'Vídeo', Icon: Clapperboard },
  megaphone: { label: 'Anúncio', Icon: Megaphone },
  magnet: { label: 'Ímã', Icon: Magnet },
  target: { label: 'Alvo', Icon: Target },
  'folder-kanban': { label: 'Projeto', Icon: FolderKanban },
  folder: { label: 'Pasta', Icon: Folder },
  users: { label: 'Pessoas', Icon: Users },
  'file-text': { label: 'Documento', Icon: FileText },
  layers: { label: 'Camadas', Icon: Layers },
  lightbulb: { label: 'Ideia', Icon: Lightbulb },
  rocket: { label: 'Lançamento', Icon: Rocket },
  'shopping-cart': { label: 'Oferta', Icon: ShoppingCart },
  tag: { label: 'Etiqueta', Icon: Tag },
  mail: { label: 'E-mail', Icon: Mail },
  globe: { label: 'Página', Icon: Globe },
  wrench: { label: 'Ferramenta', Icon: Wrench },
  star: { label: 'Destaque', Icon: Star },
  box: { label: 'Caixa', Icon: Box },
}

export const DEFAULT_ICON = 'box'

export const iconOf = (name: string | undefined): LucideIcon => (ICONS[name ?? '']?.Icon ?? ICONS[DEFAULT_ICON].Icon)
