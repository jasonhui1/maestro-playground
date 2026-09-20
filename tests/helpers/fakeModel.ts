import type { ChatCall, ChatCallHooks, ChatCallResponse, WireMessage } from '../../lib/tools/loop'

/**
 * The model, and only the model, stood in for a route test (#112):
 * `vi.mock('@/lib/chatCall', () => import('./helpers/fakeModel'))` leaves
 * runAgent, the tool loop, cost accounting, the routes and the logger real.
 */

export const answer = (content: string, usage?: [number, number]): ChatCallResponse => ({
  choices: [{ message: { role: 'assistant', content } }],
  ...(usage ? { usage: { prompt_tokens: usage[0], completion_tokens: usage[1] } } : {}),
})

export const callRetrieve = (query: string): ChatCallResponse => ({
  choices: [{
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 't1', function: { name: 'retrieve', arguments: JSON.stringify({ query }) } }],
    },
  }],
})

/** What a turn looked like when it reached the model. */
export interface SeenTurn {
  model: string
  tools: string[]
  messages: WireMessage[]
}

export interface FakeModel {
  createChatCall: (agent: { slug?: string; model: string }) => ChatCall
  seen: SeenTurn[]
  reset(): void
}

/**
 * Builds the mock module. `respond` scripts each turn a caller started; a turn
 * answering a tool result is reported back verbatim and is not recorded in
 * `seen`, so a test asserts on the transcript it sent, not the loop's own turns.
 */
export function fakeModel(
  respond: (turn: SeenTurn & { last: WireMessage; agentSlug?: string; hooks?: ChatCallHooks }) => ChatCallResponse,
): FakeModel {
  const seen: SeenTurn[] = []
  return {
    seen,
    reset: () => { seen.length = 0 },
    createChatCall: (agent) => async (req, hooks) => {
      const last = req.messages.at(-1)!
      if (last.role === 'tool') return answer(`grounded: ${last.content}`)
      const turn: SeenTurn = {
        model: agent.model,
        tools: req.tools.map(t => t.function.name),
        messages: [...req.messages],
      }
      seen.push(turn)
      return respond({ ...turn, last, agentSlug: agent.slug, hooks })
    },
  }
}

/** A workspace tool file and a context file the retrieve executor can actually find. */
export const retrieveToolFile =
  '---\nname: retrieve\nexecutor: retrieve\nparams:\n  query:\n    type: string\n    required: true\nconfig:\n  folders:\n    - context\n---\nSearch the lore.\n'

export const tavernsContextFile =
  '# Taverns\n\n## The Gilded Flagon\n\nOwned by Mirna Copperhand.\n'
