import assert from 'node:assert'
import { reconcileExternalEdit } from '../lib/syncReconcile'

assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'A' }), 'ignore-echo')
assert.strictEqual(reconcileExternalEdit({ local: 'A', lastSaved: 'A', incoming: 'B' }), 'adopt')
assert.strictEqual(reconcileExternalEdit({ local: 'C', lastSaved: 'A', incoming: 'B' }), 'conflict')
assert.strictEqual(reconcileExternalEdit({ local: 'C', lastSaved: 'A', incoming: 'A' }), 'ignore-echo')

console.log('✅ sync-reconcile tests passed')
