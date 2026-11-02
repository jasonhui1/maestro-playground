/** Compile-time exhaustiveness: a switch that misses a case fails to build here. */
export function unreachable(value: never): never {
  throw new Error(`unhandled case "${String(value)}"`)
}
