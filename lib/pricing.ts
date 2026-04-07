const PRICING: Record<string, { input: number; output: number }> = {
  'anthropic/claude-3-opus':   { input: 0.000015, output: 0.000075 },
  'anthropic/claude-3.5-sonnet': { input: 0.000003, output: 0.000015 },
  'openai/gpt-4o':             { input: 0.000005, output: 0.000015 },
  'openai/gpt-4o-mini':        { input: 0.00000015, output: 0.00000060 },
}

export function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? { input: 0, output: 0 }
  return p.input * tokensIn + p.output * tokensOut
}
