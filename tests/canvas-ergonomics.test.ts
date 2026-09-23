import { test } from 'vitest'
import assert from 'node:assert'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SocketList, Sockets, SocketDot } from '../components/editor/nodes/Sockets'
import { ModelPicker } from '../components/ModelPicker'
import { CONTROL } from '../lib/resultControls'
import { DeletableEdge } from '../components/editor/ChainCanvas'
import type { SocketHandle } from '../lib/nodeSockets'

import { ReactFlowProvider } from '@xyflow/react'

// Sockets render markdown affordances for section outputs (#146).
test('markdown section sockets render ## prefix and contract tooltip (#146)', () => {
  const handles: SocketHandle[] = [
    { id: 'topic', side: 'input' },
    { id: 'output', side: 'output' },
    { id: 'summary', side: 'output' },
    { id: 'act-1', side: 'output' },
  ]

  const html = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(Sockets, {
        handles,
        node: { id: 'agent-1', kind: 'agent' },
      })
    )
  )

  assert.ok(html.includes('.output'), 'standard output is .output')
  assert.ok(html.includes('## '), 'section socket has ## prefix')
  assert.ok(html.includes('summary'), 'summary handle rendered')
  assert.ok(html.includes('act-1'), 'act-1 handle rendered')
  assert.ok(
    html.includes('title="Extracts ## summary from output"'),
    'summary tooltip confirms extraction contract'
  )
  assert.ok(
    html.includes('title="Extracts ## act-1 from output"'),
    'act-1 tooltip confirms extraction contract'
  )
})

// Loop state outputs wear amber tone and do not render markdown section prefix (#146).
test('loop state outputs do not format as markdown sections (#146)', () => {
  const handles: SocketHandle[] = [
    { id: 'draft', side: 'output' },
  ]

  const html = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(SocketList, {
        handles,
        tone: 'loop',
        node: { id: 'le', kind: 'loop-end' },
      })
    )
  )

  assert.ok(!html.includes('## draft'), 'loop state does not get ## prefix')
  assert.ok(html.includes('.draft'), 'loop state renders as .draft')
  assert.ok(!html.includes('title="Extracts ## draft from output"'), 'loop state does not have section extraction tooltip')
})

// Branch outputs do not render markdown section extraction tooltips (#146).
test('branch and muted output sockets do not format as markdown sections (#146)', () => {
  const caseHandle: SocketHandle = { id: 'urgent', side: 'output' }
  const defaultHandle: SocketHandle = { id: 'default', side: 'output' }

  const caseHtml = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(SocketDot, { handle: caseHandle })
    )
  )
  const defaultHtml = renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(SocketDot, { handle: defaultHandle, tone: 'muted' })
    )
  )

  assert.ok(caseHtml.includes('title="urgent"'), 'branch case dot tooltip is plain identifier')
  assert.ok(!caseHtml.includes('Extracts ##'), 'branch case has no extraction tooltip')
  assert.ok(defaultHtml.includes('title="default"'), 'branch default dot tooltip is plain identifier')
  assert.ok(!defaultHtml.includes('Extracts ##'), 'branch default has no extraction tooltip')
})

// ModelPicker default styling uses flexible auto-fit width (#146).
test('ModelPicker uses flexible min/max width styling (#146)', () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelPicker, {
      value: 'gpt-4o',
      onChange: () => {},
    })
  )

  assert.ok(html.includes('min-w-[160px]'), 'has min-w-[160px]')
  assert.ok(html.includes('max-w-[240px]'), 'has max-w-[240px]')
})

// Border radius design tokens standardize inner controls to rounded-md (#146).
test('CONTROL tokens standardize inner controls to rounded-md (#146)', () => {
  assert.ok(CONTROL.field.includes('rounded-md'), 'CONTROL.field is rounded-md')
  assert.ok(CONTROL.secondary.includes('rounded-md'), 'CONTROL.secondary is rounded-md')
})

// DeletableEdge renders hit-area path and BaseEdge wire (#146).
test('DeletableEdge renders interaction path and BaseEdge wire (#146)', () => {
  const html = renderToStaticMarkup(
    React.createElement(DeletableEdge, {
      id: 'e1',
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: 'right' as any,
      targetPosition: 'left' as any,
      data: {
        edge: { fromNode: 'a', fromSocket: 'output', toNode: 'b', toSocket: 'input' },
        readOnly: false,
      },
    } as any)
  )

  assert.ok(html.includes('stroke-width="20"'), 'renders hover hit area path')
  assert.ok(html.includes('class="cursor-pointer"'), 'hit area has pointer cursor')
})
