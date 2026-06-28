import { RunMeta, AgentDef } from './types'
import { parseRefs, ParsedRef } from './refs'

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Returns the slugified text of every markdown heading (#..######), in order.
export function extractSections(markdown: string): string[] {
  const re = /^#{1,6}\s+(.+?)\s*$/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const slug = slugify(m[1])
    if (slug) out.push(slug)
  }
  return out
}

export interface InputSocket {
  id: string
  label: string
  ref: ParsedRef
  unresolvedField?: boolean
}
export interface OutputSocket {
  id: string
  name: string
  type?: string
  present: boolean
  consumed: boolean
  undeclared?: boolean
}
export interface TraceNode {
  id: string
  kind: 'seed' | 'agent' | 'context'
  label: string
  stepIndex?: number
  agentName?: string
  status?: 'success' | 'error'
  defMissing?: boolean
  stale?: boolean
  inputs?: InputSocket[]
  outputs?: OutputSocket[]
  fileName?: string
}
export interface TraceEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  kind: ParsedRef['kind']
  label: string
  flagged?: boolean
}
export interface TraceGraph {
  nodes: TraceNode[]
  edges: TraceEdge[]
}

// Resolver currently resolves only these agent fields; others render as "unsupported".
const RESOLVER_FIELDS = new Set(['output', 'summary'])

export function buildRunGraph(run: RunMeta, agents: AgentDef[]): TraceGraph {
  const outputs = run.agentOutputs || []
  const agentByName = new Map(agents.map(a => [a.name, a]))

  const nodes: TraceNode[] = []
  const edges: TraceEdge[] = []
  const nodeById = new Map<string, TraceNode>()
  const add = (n: TraceNode) => { nodes.push(n); nodeById.set(n.id, n); return n }

  const priorStepOf = (name: string, before: number): number => {
    for (let j = 0; j < before; j++) if (outputs[j].agentName === name) return j
    return -1
  }

  let seedAdded = false
  const ensureSeed = () => {
    if (!seedAdded) { add({ id: 'seed', kind: 'seed', label: 'Seed' }); seedAdded = true }
    return 'seed'
  }
  const ensureContext = (name: string) => {
    const id = `context-${name}`
    if (!nodeById.has(id)) add({ id, kind: 'context', label: name, fileName: name })
    return id
  }
  const ensureStale = (name: string) => {
    const id = `stale-${slugify(name)}`
    if (!nodeById.has(id)) {
      add({ id, kind: 'agent', label: name, agentName: name, stale: true, inputs: [], outputs: [] })
    }
    return id
  }

  // Pass 1: one node per executed step.
  outputs.forEach((o, i) => {
    const def = agentByName.get(o.agentName)
    add({
      id: `agent-${i}`,
      kind: 'agent',
      label: o.agentName,
      stepIndex: i,
      agentName: o.agentName,
      status: o.status,
      defMissing: !def,
      inputs: [],
      outputs: [],
    })
  })

  const consumed = new Set<string>() // `${nodeId}::${socketSlug}`

  // Pass 2: derive input sockets + edges from each agent's refs.
  outputs.forEach((o, i) => {
    const node = nodeById.get(`agent-${i}`)!
    const def = agentByName.get(o.agentName)
    if (!def) return // cannot parse refs without a definition (node already flagged defMissing)

    parseRefs(def.systemPrompt).forEach((ref, ri) => {
      const inputId = `in-${i}-${ri}`
      let sourceNodeId: string | null = null
      let sourceHandle = 'output'
      let label = ''
      let flagged = false
      let unresolvedField = false

      if (ref.kind === 'input') {
        label = 'input'
        sourceNodeId = i === 0 ? ensureSeed() : `agent-${i - 1}`
        sourceHandle = 'output'
      } else if (ref.kind === 'file') {
        label = ref.target
        sourceNodeId = ensureContext(ref.target)
        sourceHandle = 'file'
      } else {
        label = `${ref.target}.${ref.field}`
        const fieldSlug = slugify(ref.field)
        sourceHandle = fieldSlug
        if (!RESOLVER_FIELDS.has(ref.field)) unresolvedField = true
        const ps = priorStepOf(ref.target, i)
        if (ps !== -1) {
          sourceNodeId = `agent-${ps}`
          consumed.add(`agent-${ps}::${fieldSlug}`)
          const prodDef = agentByName.get(ref.target)
          const declared = fieldSlug === 'output' ||
            (prodDef?.outputs || []).some(s => slugify(s.name) === fieldSlug)
          if (!declared) flagged = true
        } else {
          sourceNodeId = ensureStale(ref.target)
          flagged = true
        }
      }

      node.inputs!.push({ id: inputId, label, ref, unresolvedField: unresolvedField || undefined })
      if (sourceNodeId) {
        edges.push({
          id: `e-${i}-${ri}`,
          source: sourceNodeId,
          sourceHandle,
          target: node.id,
          targetHandle: inputId,
          kind: ref.kind,
          label,
          flagged: flagged || undefined,
        })
      }
    })
  })

  // Pass 3: declared output sockets, reconciled against the actual output text.
  outputs.forEach((o, i) => {
    const node = nodeById.get(`agent-${i}`)!
    const def = agentByName.get(o.agentName)
    const declared = def?.outputs || [{ name: 'output' }]
    const sections = extractSections(o.output || '')
    node.outputs = declared.map(sock => {
      const slug = slugify(sock.name)
      return {
        id: slug,
        name: sock.name,
        type: sock.type,
        present: slug === 'output' ? true : sections.includes(slug),
        consumed: consumed.has(`agent-${i}::${slug}`),
      }
    })
  })

  // Pass 4: ensure every edge's source handle exists as an output socket on its
  // source node (covers undeclared outputs and stale nodes so wires have anchors).
  for (const e of edges) {
    const sn = nodeById.get(e.source)
    if (!sn || sn.kind !== 'agent') continue
    sn.outputs = sn.outputs || []
    if (!sn.outputs.some(s => s.id === e.sourceHandle)) {
      const present = sn.stale ? false : extractSections(outputs[sn.stepIndex!]?.output || '').includes(e.sourceHandle)
      sn.outputs.push({
        id: e.sourceHandle,
        name: e.sourceHandle,
        present: e.sourceHandle === 'output' ? !sn.stale : present,
        consumed: true,
        undeclared: sn.stale ? undefined : true,
      })
    }
  }

  return { nodes, edges }
}
