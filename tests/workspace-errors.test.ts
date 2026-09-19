import { test } from 'vitest'
import assert from 'node:assert'
import { WorkspaceError, isWorkspaceError, WorkspaceErrorKind } from '../lib/fs/errors'
import { workspaceErrorResponse, workspaceErrorStatus } from '../app/api/workspace/errors'

test('WorkspaceError carries kind, message and name', () => {
  const kinds: WorkspaceErrorKind[] = [
    'NOT_FOUND',
    'ALREADY_EXISTS',
    'IN_USE',
    'INVALID_NAME',
    'INVALID_CONTENT',
    'FOLDER_NOT_EMPTY',
    'SECURITY_VIOLATION',
  ]

  for (const kind of kinds) {
    const err = new WorkspaceError(kind, `message for ${kind}`)
    assert.strictEqual(err.kind, kind)
    assert.strictEqual(err.message, `message for ${kind}`)
    assert.strictEqual(err.name, 'WorkspaceError')
    assert.ok(err instanceof Error)
    assert.ok(err instanceof WorkspaceError)
    assert.strictEqual(isWorkspaceError(err), true)
  }
})

test('isWorkspaceError distinguishes WorkspaceError from plain Error or other values', () => {
  assert.strictEqual(isWorkspaceError(new Error('plain error')), false)
  assert.strictEqual(isWorkspaceError(null), false)
  assert.strictEqual(isWorkspaceError(undefined), false)
  assert.strictEqual(isWorkspaceError('error string'), false)
  assert.strictEqual(isWorkspaceError({ kind: 'NOT_FOUND', message: 'fake' }), false)
  assert.strictEqual(isWorkspaceError(42), false)
})

test('workspaceErrorStatus exhaustively maps error kinds to HTTP statuses', () => {
  assert.strictEqual(workspaceErrorStatus('NOT_FOUND'), 404)
  assert.strictEqual(workspaceErrorStatus('ALREADY_EXISTS'), 409)
  assert.strictEqual(workspaceErrorStatus('IN_USE'), 409)
  assert.strictEqual(workspaceErrorStatus('FOLDER_NOT_EMPTY'), 400)
  assert.strictEqual(workspaceErrorStatus('INVALID_NAME'), 400)
  assert.strictEqual(workspaceErrorStatus('INVALID_CONTENT'), 400)
  assert.strictEqual(workspaceErrorStatus('SECURITY_VIOLATION'), 403)
})

test('workspaceErrorResponse encodes WorkspaceError based on kind without message sniffing', async () => {
  const cases: [WorkspaceErrorKind, number, string, string][] = [
    ['NOT_FOUND', 404, 'Arbitrary missing text', 'Arbitrary missing text'],
    ['ALREADY_EXISTS', 409, 'Something already here', 'Something already here'],
    ['IN_USE', 409, 'Referenced by something else', 'Referenced by something else'],
    ['FOLDER_NOT_EMPTY', 400, 'Cannot delete: items present', 'Cannot delete: items present'],
    ['INVALID_NAME', 400, 'Bad characters in slug', 'Bad characters in slug'],
    ['INVALID_CONTENT', 400, 'Bad yaml frontmatter', 'Bad yaml frontmatter'],
    ['SECURITY_VIOLATION', 403, 'Traversal blocked: ../../etc', 'Forbidden'],
  ]

  for (const [kind, expectedStatus, message, expectedBodyError] of cases) {
    const err = new WorkspaceError(kind, message)
    const res = workspaceErrorResponse(err)
    assert.strictEqual(res.status, expectedStatus)
    const body = await res.json()
    assert.deepStrictEqual(body, { error: expectedBodyError })
  }
})

test('workspaceErrorResponse maps non-WorkspaceError to 500', async () => {
  const plain = new Error('Database crash')
  const res = workspaceErrorResponse(plain)
  assert.strictEqual(res.status, 500)
  const body = await res.json()
  assert.deepStrictEqual(body, { error: 'Database crash' })

  const nonObj = workspaceErrorResponse('Raw string error')
  assert.strictEqual(nonObj.status, 500)
  const nonObjBody = await nonObj.json()
  assert.deepStrictEqual(nonObjBody, { error: 'Raw string error' })
})
