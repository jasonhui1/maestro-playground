import { test } from 'vitest'
import assert from 'node:assert'
import { folderOf, ancestorFolders, workspaceRootOf, buildTreeRows, buildSearchRows, allFolders, type TreeItem, type EntityType } from '../lib/fileTree'

function item(slug: string, filePath: string, entityType: EntityType = 'agent'): TreeItem {
  return { slug, name: slug, filePath, entityType }
}

const WS = '/Users/x/agents-playground/workspace'

test('a folder is the path between the type directory and the file', () => {
  assert.strictEqual(folderOf(`${WS}/agents/optimist.md`, 'agent', WS), '')
  assert.strictEqual(folderOf(`${WS}/agents/panel/optimist.md`, 'agent', WS), 'panel')
  assert.strictEqual(folderOf(`${WS}/agents/panel/deep/optimist.md`, 'agent', WS), 'panel/deep')
  // windows separators, and a path that never names the type directory
  assert.strictEqual(folderOf(`C:\\ws\\agents\\panel\\o.md`, 'agent', 'C:\\ws'), 'panel')
  assert.strictEqual(folderOf('/somewhere/else/o.md', 'agent', '/somewhere'), '')
  // with no root, the last matching segment is the type directory
  assert.strictEqual(folderOf('/home/agents/ws/agents/panel/o.md', 'agent'), 'panel')
})

test('the workspace root comes back out of the paths, so a folder may share its type name', () => {
  assert.strictEqual(workspaceRootOf([`${WS}/agents/panel/o.md`, `${WS}/chains/d.md`]), WS)
  // only one type populated: the shared prefix reaches into the type directory and comes back off
  assert.strictEqual(workspaceRootOf([`${WS}/agents/panel/o.md`]), WS)
  assert.strictEqual(workspaceRootOf([]), undefined)

  // the case a segment scan cannot see: a folder named after its own type directory
  const root = workspaceRootOf([`${WS}/agents/agents/o.md`, `${WS}/chains/d.md`])
  assert.strictEqual(folderOf(`${WS}/agents/agents/o.md`, 'agent', root), 'agents')
})

test('a folder lists every ancestor of itself, outermost first', () => {
  assert.deepStrictEqual(ancestorFolders(''), [])
  assert.deepStrictEqual(ancestorFolders('panel'), ['panel'])
  assert.deepStrictEqual(ancestorFolders('panel/deep/deeper'), ['panel', 'panel/deep', 'panel/deep/deeper'])
})

test('folders come before root files, and a collapsed folder hides its children', () => {
  const items = [
    item('flat', `${WS}/agents/flat.md`),
    item('optimist', `${WS}/agents/panel/optimist.md`),
    item('skeptic', `${WS}/agents/panel/skeptic.md`),
  ]
  const collapsed = buildTreeRows(items, { category: 'agent', expanded: {}, favorites: [] })
  assert.deepStrictEqual(collapsed.map(r => [r.kind, r.label, r.depth]), [
    ['folder', 'panel', 0],
    ['file', 'flat', 0],
  ])

  const open = buildTreeRows(items, { category: 'agent', expanded: { 'agent:panel': true }, favorites: [] })
  assert.deepStrictEqual(open.map(r => [r.kind, r.label, r.depth]), [
    ['folder', 'panel', 0],
    ['file', 'optimist', 1],
    ['file', 'skeptic', 1],
    ['file', 'flat', 0],
  ])
})

test('nesting goes to any depth, one folder row per level', () => {
  const items = [item('red-teaming', `${WS}/agents/craft/deep/red-teaming.md`)]
  const expanded = { 'agent:craft': true, 'agent:craft/deep': true }
  const rows = buildTreeRows(items, { category: 'agent', expanded, favorites: [] })
  assert.deepStrictEqual(rows.map(r => [r.kind, r.label, r.depth]), [
    ['folder', 'craft', 0],
    ['folder', 'deep', 1],
    ['file', 'red-teaming', 2],
  ])
})

test('the active file auto-expands its ancestors, and a hand-collapsed ancestor still wins', () => {
  const items = [item('optimist', `${WS}/agents/panel/deep/optimist.md`)]
  const rows = buildTreeRows(items, {
    category: 'agent',
    expanded: {},
    favorites: [],
    activeSlug: 'optimist',
  })
  assert.deepStrictEqual(rows.map(r => [r.kind, r.label]), [
    ['folder', 'panel'],
    ['folder', 'deep'],
    ['file', 'optimist'],
  ])

  // auto-expansion only seeds a folder with no stored state, or its chevron would be dead
  const collapsed = buildTreeRows(items, {
    category: 'agent',
    expanded: { 'agent:panel': false },
    favorites: [],
    activeSlug: 'optimist',
  })
  assert.deepStrictEqual(collapsed.map(r => [r.kind, r.label]), [['folder', 'panel']])
})

test('a starred file pins into ★ Favorites and still sits, starred, in its real folder', () => {
  const items = [
    item('optimist', `${WS}/agents/panel/optimist.md`),
    item('flat', `${WS}/agents/flat.md`),
  ]
  const rows = buildTreeRows(items, {
    category: 'agent',
    expanded: { 'agent:panel': true, 'agent:__favorites__': true },
    favorites: ['agent:optimist'],
  })
  const shape = rows.map(r => r.kind === 'file'
    ? [r.kind, r.label, r.subtitle, r.isFavorite]
    : [r.kind, r.label, null, false])
  assert.deepStrictEqual(shape, [
    ['folder', 'Favorites', null, false],
    ['file', 'optimist', 'panel', true],
    ['folder', 'panel', null, false],
    ['file', 'optimist', null, true],
    ['file', 'flat', null, false],
  ])
  // the two rows address the same file but must not collide as React keys
  assert.notStrictEqual(rows[1].key, rows[3].key)
})

test('no favourite in this category means no Favorites node', () => {
  const rows = buildTreeRows([item('flat', `${WS}/agents/flat.md`)], {
    category: 'agent',
    expanded: {},
    favorites: ['skill:other'],
  })
  assert.deepStrictEqual(rows.map(r => r.kind), ['file'])
})

test('an empty folder from the directory reader still renders, at any depth', () => {
  const items = [item('flat', `${WS}/agents/flat.md`)]
  const rows = buildTreeRows(items, {
    category: 'agent',
    expanded: { 'agent:empty': true },
    favorites: [],
    emptyFolders: ['empty', 'empty/deeper'],
  })
  assert.deepStrictEqual(rows.map(r => [r.kind, r.label, r.depth]), [
    ['folder', 'empty', 0],
    ['folder', 'deeper', 1],
    ['file', 'flat', 0],
  ])
})

test('an empty folder sharing a name with a file-derived folder does not duplicate it', () => {
  const items = [item('optimist', `${WS}/agents/panel/optimist.md`)]
  const rows = buildTreeRows(items, {
    category: 'agent',
    expanded: {},
    favorites: [],
    emptyFolders: ['panel'],
  })
  assert.deepStrictEqual(rows.map(r => [r.kind, r.label]), [['folder', 'panel']])
})

test('allFolders lists every folder a file could move to, populated or empty, deduped and sorted', () => {
  const items = [
    item('optimist', `${WS}/agents/panel/deep/optimist.md`),
    item('flat', `${WS}/agents/flat.md`),
  ]
  assert.deepStrictEqual(allFolders(items, 'agent', WS, ['panel', 'archive']), ['archive', 'panel', 'panel/deep'])
  assert.deepStrictEqual(allFolders(items, 'agent', WS), ['panel', 'panel/deep'])
  assert.deepStrictEqual(allFolders([], 'agent', WS), [])
})

test('search keeps the ranked order flat, each row carrying its folder', () => {
  const ranked = [
    item('optimist', `${WS}/agents/panel/deep/optimist.md`),
    item('flat', `${WS}/agents/flat.md`),
  ]
  const rows = buildSearchRows(ranked, { category: 'agent', favorites: ['agent:flat'] })
  assert.deepStrictEqual(rows.map(r => [r.kind, r.label, r.depth, r.subtitle ?? null, r.isFavorite ?? false]), [
    ['file', 'optimist', 0, 'panel/deep', false],
    ['file', 'flat', 0, null, true],
  ])
})
