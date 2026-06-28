import assert from 'node:assert'
import { parseSlots } from '../lib/slots'

assert.deepStrictEqual(parseSlots('World: {world}\nChars: {characters}'), ['world', 'characters'])
assert.deepStrictEqual(parseSlots('{input} then {input}'), ['input'])         // dedupe
assert.deepStrictEqual(parseSlots('{ world }'), ['world'])                     // trimmed
assert.deepStrictEqual(parseSlots('{a.b} {world}'), ['world'])                 // dotted token ignored
assert.deepStrictEqual(parseSlots('no slots here'), [])
console.log('✅ parseSlots tests passed')
