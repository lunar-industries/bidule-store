import type { ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { Kanban } from './KanbanPage.tsx'
import { KanbanSettings } from './KanbanSettings.tsx'
import './kanban.css'

// Simon's Kanban: a module on the core's tasks (and branches for the cards), in place of the official one.
const ui: ExtensionUi = {
  pages: { kanban: Kanban },
  settings: KanbanSettings,
}
export default ui
