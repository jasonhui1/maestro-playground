import type { AgentDef } from './types'
import type { ChatCall } from './tools/loop'

/** The model port: one chat call per agent, carried on the request's Workspace (#170). */
export type ModelFactory = (agent: AgentDef) => ChatCall

/** A workspace built without a model refuses every turn rather than reaching a provider (#170). */
export const noModel: ModelFactory = agent => async () => {
  throw new Error(`No model is wired into this workspace; ${agent.name} cannot run`)
}
