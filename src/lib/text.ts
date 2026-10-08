export function friendlyBookError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : ''
  if (/zip|slice|central directory|corrupt|invalid/i.test(message))
    return 'Noesis could not open this file. Make sure it is complete and has no copy protection.'
  return message || fallback
}
