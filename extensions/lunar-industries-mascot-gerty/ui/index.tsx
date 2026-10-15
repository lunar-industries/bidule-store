import type { ExtensionUi } from '@bidule/sdk'
import { mascot } from './mascot.ts'
import './gerty.css'

const ui: ExtensionUi = { mascots: { gerty: mascot } }
export default ui
