function newer(localValue: string | undefined, remoteValue: string | undefined): boolean {
  return new Date(remoteValue ?? 0).valueOf() > new Date(localValue ?? 0).valueOf()
}

export function mergeById<T extends { id: string; updated?: string; createdAt?: string }>(
  local: T[],
  remote: T[],
): T[] {
  const merged = new Map(local.map((item) => [item.id, item]))
  for (const item of remote) {
    const current = merged.get(item.id)
    if (!current || newer(current.updated ?? current.createdAt, item.updated ?? item.createdAt))
      merged.set(item.id, item)
  }
  return [...merged.values()].sort(
    (a, b) => new Date(b.updated ?? b.createdAt ?? 0).valueOf() - new Date(a.updated ?? a.createdAt ?? 0).valueOf(),
  )
}
