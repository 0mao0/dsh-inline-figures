// Does a `{ global: true }` listener on a parent context receive an event emitted
// from a child context? The plugin relies on exactly this to read `session/event`
// (the session service emits from its own context, not from the plugin's).
import { Context } from '@deepseek-ai/cordis'

const root = new Context()
const child = root.extend({ name: 'child' })
const grandchild = child.extend({ name: 'grandchild' })

let got = 0
root.on('probe/event', () => { got++ }, { global: true })

grandchild.emit('probe/event', { from: 'grandchild' })
const afterGrandchild = got

child.emit('probe/event', { from: 'child' })
const afterChild = got - afterGrandchild

root.emit('probe/event', { from: 'root' })
const afterRoot = got - afterGrandchild - afterChild

let scoped = 0
root.on('probe/scoped', () => { scoped++ })
grandchild.emit('probe/scoped', {})

console.log(JSON.stringify({ afterGrandchild, afterChild, afterRoot, scopedWithoutGlobal: scoped }))
console.log(afterGrandchild === 1 ? 'PASS global listener receives grandchild emissions' : 'FAIL global listener missed the grandchild emission')
// Measured, and it contradicts the first guess: a listener WITHOUT `{ global: true }`
// also receives events emitted from a descendant context. The wording is therefore
// documentation of intent, not a delivery fix - the actual bug was the session-key
// lookup, not the subscription (see the note in index.js).
console.log(scoped >= 1 ? 'NOTE scoped listeners also receive descendant emissions' : 'NOTE scoped listeners are contained')
