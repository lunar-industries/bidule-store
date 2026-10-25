import type { ExtensionUi } from '@bidule/sdk'
import '../contract.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { TempsPage } from './TempsPage.tsx'

const ui: ExtensionUi = { pages: { temps: TempsPage }, settings: SettingsPanel }
export default ui
