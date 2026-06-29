export interface History<S> {
  past: S[]
  present: S
  future: S[]
}

export function withHistory<S, A extends { type: string }>(
  reducer: (s: S, a: A) => S,
  isHistoric: (a: A) => boolean,
  cap = 50,
) {
  return function (state: History<S>, action: A | { type: 'undo' } | { type: 'redo' }): History<S> {
    if (action.type === 'undo') {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] }
    }
    if (action.type === 'redo') {
      if (!state.future.length) return state
      const next = state.future[0]
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) }
    }
    const present = reducer(state.present, action as A)
    if (present === state.present) return state
    if (!isHistoric(action as A)) return { ...state, present }
    const past = [...state.past, state.present]
    while (past.length > cap) past.shift()
    return { past, present, future: [] }
  }
}

export const canUndo = <S>(h: History<S>): boolean => h.past.length > 0
export const canRedo = <S>(h: History<S>): boolean => h.future.length > 0
