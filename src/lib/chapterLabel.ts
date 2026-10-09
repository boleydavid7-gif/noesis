// A contents entry the reader can recognise: spaces tidied, a trailing "CHAPTER II." picked out of a caption,
// and a plain "Section N" when the book gave nothing usable.
export function cleanChapterLabel(raw: string, index: number): string {
  const label = raw.replace(/\s+/g, ' ').trim()
  if (!label || /^(untitled( chapter)?|unknown|null|undefined|\d{1,3}|page \d+)$/i.test(label))
    return `Section ${index + 1}`
  if (label.length > 70) {
    const tail = label.match(/\b((?:chapter|book|part|section)\s+[ivxlcdm\d]+)\.?$/i)?.[1]
    if (tail)
      return tail.replace(
        /^(\w)(\w*)\s+(.*)$/,
        (_, a: string, b: string, c: string) => `${a.toUpperCase()}${b.toLowerCase()} ${c.toUpperCase()}`,
      )
    return `${label.slice(0, 60).trim()}…`
  }
  return label
}
