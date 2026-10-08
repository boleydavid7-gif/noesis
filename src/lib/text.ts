export function friendlyBookError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : ''
  if (/zip|slice|central directory|corrupt|invalid/i.test(message))
    return 'Noesis could not open this EPUB. Make sure it is a complete, DRM-free .epub file, not a preview page.'
  return message || fallback
}
