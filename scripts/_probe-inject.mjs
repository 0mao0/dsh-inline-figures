// Probe: (1) is 'agent' a valid plugin inject name? (2) does ctx.on accept 'agent/created'?
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Point DSH_APP_ASAR at your own install; the default is the Windows layout.
const asar = process.env.DSH_APP_ASAR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
const harnessPkgs = path.join(asar, 'dsh', 'node_modules')
let createHarness, mountServices
try {
  ;({ createHarness, mountServices } = await import(pathToFileURL(path.join(harnessPkgs, '@deepseek-ai/dsh-protocore/dist/index.mjs')).href))
} catch (e) {
  console.log('protocore import failed:', e.message)
  process.exit(2)
}
console.log('protocore loaded; createHarness?', typeof createHarness, 'mountServices?', typeof mountServices)
