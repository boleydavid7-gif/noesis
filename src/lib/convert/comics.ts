// Comic book archives (.cbz): a zip of page pictures.

import JSZip from 'jszip'
import { decodeEntities } from './html'
import { pictureName } from './build'
import type { Draft } from './types'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export async function cbzToDraft(data: ArrayBuffer, filename: string): Promise<Draft> {
  const zip = await JSZip.loadAsync(data)
  const files = Object.values(zip.files)
    .filter(
      (entry) =>
        !entry.dir && !/__MACOSX|(^|\/)\./.test(entry.name) && TYPES[entry.name.split('.').pop()?.toLowerCase() ?? ''],
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (files.length === 0) throw new Error('No pages were found in this comic file.')
  const info = (await zip.file(/ComicInfo\.xml$/i)[0]?.async('string')) ?? ''
  const field = (name: string) => decodeEntities(info.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '').trim()
  const series = field('Series')
  const title =
    field('Title') ||
    [series, field('Number') && `#${field('Number')}`].filter(Boolean).join(' ') ||
    filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  const pictures = []
  for (const [index, entry] of files.entries()) {
    const type = TYPES[entry.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/jpeg'
    pictures.push({ name: pictureName(index + 1, type), type, data: await entry.async('uint8array') })
  }
  const chapters = pictures.map((picture, index) => ({
    title: `Page ${index + 1}`,
    html: `<div><img src="images/${picture.name}" alt="Page ${index + 1}" style="max-width:100%"/></div>`,
  }))
  return { title, author: field('Writer') || 'Unknown author', chapters, pictures, cover: pictures[0].name }
}
