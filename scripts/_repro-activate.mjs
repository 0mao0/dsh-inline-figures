// scripts/_repro-activate.mjs — activate inline-figures against REAL, real-registered
// SystemPrompt + ToolRuntime services so apply() actually runs and any throw surfaces.
// Run inside the installed package dir: node _repro-activate.mjs
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as pluginNs from '@local/dsh-inline-figures'

const ToolRuntime = dshTools.ToolRuntime ?? dshTools.default
const root = new Context()

async function step(label, target, config) {
  try {
    await root.registry.plugin(target, config ?? {})
    console.log(`OK    ${label}`)
  } catch (error) {
    console.log(`THREW ${label}: ${error?.message ?? error}`)
    console.log((error?.stack ?? '').split('\n').slice(1, 7).join('\n'))
  }
}

// Mount services the way patch rows do: SystemPrompt has no inject; ToolRuntime injects systemPrompt.
await step('SystemPrompt', SystemPrompt, { personaPrefix: '' })
console.log('root.systemPrompt:', !!root.systemPrompt)
await step('ToolRuntime', ToolRuntime, {})
console.log('root.tools:', !!root.tools, '| root.systemPrompt:', !!root.systemPrompt)

const plugin = { name: pluginNs.name, inject: pluginNs.inject, Config: pluginNs.Config, apply: pluginNs.apply }
await step('inline-figures', plugin, {})
if (root.tools) console.log('draw_figure registered:', !!root.tools.get?.('draw_figure', root))
