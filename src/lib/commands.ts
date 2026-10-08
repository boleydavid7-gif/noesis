export type Command = { id: string; label: string; hint?: string; group: string; keywords?: string; run: () => void }

const GROUP_ORDER = ['Go to', 'Do', 'Books', 'Notes', 'Paths']

// Picks and orders what matches what was typed: every word must appear, titles that start with the
// text come first, and each group is kept together.
export function filterCommands(commands: Command[], query: string, limit = 14): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored = commands.flatMap((command) => {
    const label = command.label.toLowerCase()
    const haystack = `${label} ${command.hint?.toLowerCase() ?? ''} ${command.keywords?.toLowerCase() ?? ''}`
    if (!words.every((word) => haystack.includes(word))) return []
    const start =
      words.length > 0 && label.startsWith(words[0]) ? 0 : words.length > 0 && label.includes(words[0]) ? 1 : 2
    return [{ command, start }]
  })
  scored.sort(
    (a, b) =>
      (query ? a.start - b.start : 0) || GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group),
  )
  return scored.slice(0, limit).map((item) => item.command)
}
