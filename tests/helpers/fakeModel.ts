import type { ChatCallHooks, ChatCallResponse, WireMessage } from '../../lib/tools/loop'
import type { ModelFactory } from '../../lib/model'
import type { AgentDef } from '../../lib/types'

/**
 * The model, and only the model, stood in (#112, #170): set `requestEntry.model = fake.model`
 * for a route, or hand `fake.model` to runAgentTurn; the turn, tool loop, cost and logger stay real.
 */

export const answer = (content: string, usage?: [number, number]): ChatCallResponse => ({
  choices: [{ message: { role: 'assistant', content } }],
  ...(usage ? { usage: { prompt_tokens: usage[0], completion_tokens: usage[1] } } : {}),
})

export const callRetrieve = (query: string, hooks?: ChatCallHooks): ChatCallResponse => {
  hooks?.onToolCallStart?.()
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', function: { name: 'retrieve', arguments: JSON.stringify({ query }) } }],
      },
    }],
  }
}

/** What a turn looked like when it reached the model. */
export interface SeenTurn {
  model: string
  tools: string[]
  messages: WireMessage[]
}

export interface FakeModel {
  model: ModelFactory
  seen: SeenTurn[]
  reset(): void
}

/**
 * Builds the mock module. `respond` scripts each turn a caller started; a turn
 * answering a tool result is reported back verbatim and is not recorded in
 * `seen`, so a test asserts on the transcript it sent, not the loop's own turns.
 */
export function fakeModel(
  respond: (turn: SeenTurn & { last: WireMessage; system: string; agent: AgentDef; agentSlug?: string; hooks?: ChatCallHooks }) => ChatCallResponse | Promise<ChatCallResponse>,
): FakeModel {
  const seen: SeenTurn[] = []
  return {
    seen,
    reset: () => { seen.length = 0 },
    model: (agent) => async (req, hooks) => {
      const last = req.messages.at(-1)!
      if (last.role === 'tool') {
        const text = `grounded: ${last.content}`
        hooks?.onToken?.(text, 'output')
        return answer(text)
      }
      const turn: SeenTurn = {
        model: agent.model,
        tools: req.tools.map(t => t.function.name),
        messages: [...req.messages],
      }
      seen.push(turn)
      const first = req.messages[0]
      const system = first?.role === 'system' ? first.content : ''
      return respond({ ...turn, last, system, agent, agentSlug: agent.slug, hooks })
    },
  }
}

/** A workspace tool file and a context file the retrieve executor can actually find. */
export const retrieveToolFile =
  '---\nname: retrieve\nexecutor: retrieve\nparams:\n  query:\n    type: string\n    required: true\nconfig:\n  folders:\n    - context\n---\nSearch the lore.\n'

export const tavernsContextFile =
  '# Taverns\n\n## The Gilded Flagon\n\nOwned by Mirna Copperhand.\n'
