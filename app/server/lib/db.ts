export function buildSetClauses(
  fields: Record<string, unknown>,
  opts?: { updatedAt?: boolean },
): { sql: string; values: unknown[]; nextParam: number } | null {
  const clauses: string[] = []
  const values: unknown[] = []
  let paramIdx = 1

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      clauses.push(`${key} = $${paramIdx++}`)
      values.push(value)
    }
  }

  if (clauses.length === 0) return null

  if (opts?.updatedAt !== false) {
    clauses.push('updated_at = NOW()')
  }

  return { sql: clauses.join(', '), values, nextParam: paramIdx }
}

export function jsonOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  return v ? JSON.stringify(v) : null
}
