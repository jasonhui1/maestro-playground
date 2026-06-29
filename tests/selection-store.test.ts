// tests/selection-store.test.ts
import assert from 'node:assert'
import { useSelectionStore, selectedNodeId } from '../hooks/store/useSelectionStore'

assert.strictEqual(selectedNodeId('chain:a'), null)
useSelectionStore.getState().setSelected('chain:a', 'node-1')
useSelectionStore.getState().setSelected('chain:b', 'node-2')
assert.strictEqual(selectedNodeId('chain:a'), 'node-1')
assert.strictEqual(selectedNodeId('chain:b'), 'node-2')
useSelectionStore.getState().setSelected('chain:a', null)
assert.strictEqual(selectedNodeId('chain:a'), null)

console.log('✅ selection-store tests passed')
