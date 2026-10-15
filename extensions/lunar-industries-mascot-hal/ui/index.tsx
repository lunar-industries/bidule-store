import type { ExtensionUi } from '@bidule/sdk'
import { mascot } from './mascot.ts'
import './hal.css'

const ui: ExtensionUi = { mascots: { hal: mascot } }
export default ui
