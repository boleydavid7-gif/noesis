// Packs a draft book into a standard EPUB file.

import JSZip from 'jszip'
import { escapeXml } from './html'
import type { Draft } from './types'

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export const pictureName = (index: number, type: string) => `img${index}.${EXTENSION[type] ?? 'jpg'}`

export async function buildEpub(draft: Draft): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  const chapters = draft.chapters.length ? draft.chapters : [{ title: draft.title, html: '<p></p>' }]
  const id = `urn:uuid:${crypto.randomUUID()}`
  const manifest: string[] = []
  const spine: string[] = []
  const points: string[] = []
  const list: string[] = []
  chapters.forEach((chapter, index) => {
    const file = `ch${index + 1}.xhtml`
    zip.file(
      `OEBPS/${file}`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(chapter.title)}</title></head><body>${chapter.html}</body></html>`,
    )
    manifest.push(`<item id="c${index + 1}" href="${file}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="c${index + 1}"/>`)
    points.push(
      `<navPoint id="n${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(chapter.title)}</text></navLabel><content src="${file}"/></navPoint>`,
    )
    list.push(`<li><a href="${file}">${escapeXml(chapter.title)}</a></li>`)
  })
  draft.pictures.forEach((picture, index) => {
    zip.file(`OEBPS/images/${picture.name}`, picture.data)
    const cover = picture.name === draft.cover ? ' properties="cover-image"' : ''
    manifest.push(`<item id="i${index + 1}" href="images/${picture.name}" media-type="${picture.type}"${cover}/>`)
  })
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${list.join('')}</ol></nav></body></html>`,
  )
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${escapeXml(draft.title)}</text></docTitle><navMap>${points.join('')}</navMap></ncx>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${id}</dc:identifier><dc:title>${escapeXml(draft.title)}</dc:title><dc:creator>${escapeXml(draft.author)}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest.join('')}</manifest><spine toc="ncx">${spine.join('')}</spine></package>`,
  )
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' })
}
