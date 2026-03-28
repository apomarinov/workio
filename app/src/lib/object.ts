/** Read a value from a nested object by dot-path, e.g. 'server_config.max_buffer_lines' */
export function getByPath(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let current = obj
  for (const k of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[k]
  }
  return current
}

/** Return a shallow-cloned object with a value set at the given dot-path */
export function setByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const keys = path.split('.')
  const next = { ...obj }
  if (keys.length === 1) {
    ;(next as Record<string, unknown>)[keys[0]] = value
    return next
  }
  const [root, ...rest] = keys
  let current: Record<string, unknown> = {
    ...(((next as Record<string, unknown>)[root] as Record<string, unknown>) ??
      {}),
  }
  ;(next as Record<string, unknown>)[root] = current
  for (let i = 0; i < rest.length - 1; i++) {
    const child = {
      ...((current[rest[i]] as Record<string, unknown>) ?? {}),
    }
    current[rest[i]] = child
    current = child
  }
  current[rest[rest.length - 1]] = value
  return next
}
