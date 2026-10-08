// Everything you've saved, as plain Markdown files that open in Obsidian, Notion or any text editor.

import JSZip from 'jszip'
import type { BrainNote } from './knowledge'
import { diaryDays, type DiaryEntry } from './diary'

export function slug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return base || 'note'
}

const quoteYaml = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function noteToMarkdown(note: BrainNote): string {
  const lines = [
    '---',
    `title: ${quoteYaml(note.title)}`,
    `type: ${note.kind}`,
    `source: ${quoteYaml(note.bookTitle ?? note.source)}`,
    note.chapter ? `chapter: ${quoteYaml(note.chapter)}` : '',
    note.page ? `page: ${note.page}` : '',
    `created: ${note.createdAt}`,
    note.tags?.length ? `tags: [${note.tags.map((tag) => slug(tag)).join(', ')}]` : '',
    '---',
    '',
    `# ${note.title}`,
    '',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '' || index === all.length - 1)
  if (note.quote) lines.push(...note.quote.split('\n').map((line) => `> ${line}`), '')
  lines.push(note.body.trim(), '')
  return lines.join('\n')
}

export function diaryToMarkdown(entries: DiaryEntry[], notes: BrainNote[]): string {
  const out = ['# Reading diary', '']
  for (const day of diaryDays(entries, notes)) {
    out.push(`## ${day.day}`, '')
    for (const entry of day.reading)
      out.push(
        `- Read **${entry.title}** for ${Math.round(entry.minutes)} min (${Math.round(entry.from)}% → ${Math.round(entry.to)}%)`,
      )
    for (const note of day.notes) out.push(`- Saved a ${note.kind}: ${note.title}`)
    out.push('')
  }
  return out.join('\n')
}

export async function notesToZip(notes: BrainNote[], diary: DiaryEntry[]): Promise<Blob> {
  const zip = new JSZip()
  const used = new Set<string>()
  for (const note of notes) {
    let name = slug(note.title)
    for (let n = 2; used.has(name); n += 1) name = `${slug(note.title)}-${n}`
    used.add(name)
    zip.file(`notes/${name}.md`, noteToMarkdown(note))
  }
  zip.file('reading-diary.md', diaryToMarkdown(diary, notes))
  return zip.generateAsync({ type: 'blob' })
}
