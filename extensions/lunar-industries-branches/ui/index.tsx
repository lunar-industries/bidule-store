import type { ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { BranchesPage } from './BranchesPage.tsx'
import './branches.css'

// A CI that turns red is told by the core's « T'attend », from Git (the official module), not here.
const ui: ExtensionUi = { pages: { branches: BranchesPage } }
export default ui
