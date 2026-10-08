import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { convertToEpub, isImportable } from './index'
import { palmDecompress, mobiToDraft } from './mobi'
import { rtfToText } from './documents'
import { tidyHtml } from './html'

const enc = (text: string) => new TextEncoder().encode(text)

async function read(file: File) {
  const zip = await JSZip.loadAsync(await convertToEpub(file))
  const opf = (await zip.file('OEBPS/content.opf')?.async('string')) ?? ''
  const chapters: string[] = []
  for (const name of Object.keys(zip.files)
    .filter((item) => /OEBPS\/ch\d+\.xhtml$/.test(item))
    .sort()) {
    chapters.push((await zip.file(name)?.async('string')) ?? '')
  }
  return { zip, opf, chapters, text: chapters.join('\n') }
}

describe('formats', () => {
  it('knows what it can import', () => {
    for (const name of [
      'a.epub',
      'a.PDF',
      'a.mobi',
      'a.azw3',
      'a.fb2',
      'a.fb2.zip',
      'a.docx',
      'a.cbz',
      'a.txt',
      'a.md',
      'a.rtf',
      'a.odt',
      'a.htm',
    ])
      expect(isImportable(name)).toBe(true)
    expect(isImportable('a.exe')).toBe(false)
  })

  it('turns text into chapters, using the Gutenberg title and author', async () => {
    const text = `Title: Tiny Tale\nAuthor: A. Writer\n\n*** START OF THE PROJECT GUTENBERG EBOOK TINY ***\n\nCHAPTER I\n\n${'Once upon a time there was a long sentence. '.repeat(20)}\n\nCHAPTER II\n\n${'And then it ended, but not for a while. '.repeat(20)}\n\n*** END OF THE PROJECT GUTENBERG EBOOK TINY ***\nlicence`
    const result = await read(new File([text], 'tiny.txt'))
    expect(result.opf).toContain('<dc:title>Tiny Tale</dc:title>')
    expect(result.opf).toContain('A. Writer')
    expect(result.chapters).toHaveLength(2)
    expect(result.text).not.toContain('licence')
  })

  it('reads Windows-1252 text', async () => {
    const result = await read(new File([Uint8Array.from([0x63, 0x61, 0x66, 0xe9])], 'old.txt'))
    expect(result.text).toContain('café')
  })

  it('converts markdown and web pages, dropping scripts', async () => {
    const md = await read(new File(['# Big Title\n\nSome *words* here.\n\n## Next\n\n- one\n- two\n'], 'a.md'))
    expect(md.text).toContain('<em>words</em>')
    expect(md.text).toContain('<li>one</li>')
    const page = await read(
      new File(
        [
          '<html><head><title>Page &amp; Co</title><script>alert(1)</script></head><body><p onclick="x()">Hi<br>there</p></body></html>',
        ],
        'p.html',
      ),
    )
    expect(page.text).not.toContain('alert')
    expect(page.text).not.toContain('onclick')
    expect(page.opf).toContain('Page &amp; Co')
    expect(page.text).toContain('<br/>')
  })

  it('converts FictionBook with sections', async () => {
    const fb2 = `<?xml version="1.0"?><FictionBook><description><title-info><author><first-name>Ann</first-name><last-name>Lee</last-name></author><book-title>Fb Book</book-title></title-info></description><body><section><title><p>One</p></title><p>${'First words. '.repeat(40)}</p></section><section><title><p>Two</p></title><p>${'Second words. '.repeat(40)}</p><empty-line/><p><emphasis>x</emphasis></p></section></body></FictionBook>`
    const result = await read(new File([fb2], 'b.fb2'))
    expect(result.opf).toContain('Fb Book')
    expect(result.opf).toContain('Ann Lee')
    expect(result.chapters).toHaveLength(2)
    expect(result.text).toContain('<em>x</em>')
  })

  it('converts Word documents by heading', async () => {
    const zip = new JSZip()
    const para = (text: string, style = '') =>
      `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
    zip.file(
      'word/document.xml',
      `<w:document><w:body>${para('Start', 'Heading1')}${para('Body one '.repeat(60))}${para('Next', 'Heading1')}${para('Body two '.repeat(60))}</w:body></w:document>`,
    )
    zip.file(
      'docProps/core.xml',
      '<cp:coreProperties><dc:title>Doc Title</dc:title><dc:creator>Dee</dc:creator></cp:coreProperties>',
    )
    const result = await read(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'd.docx'))
    expect(result.opf).toContain('Doc Title')
    expect(result.chapters).toHaveLength(2)
    expect(result.text).toContain('Body two')
  })

  it('converts OpenDocument text', async () => {
    const zip = new JSZip()
    zip.file(
      'content.xml',
      '<office:text><text:h text:outline-level="1">Head</text:h><text:p>Hello<text:s/>world</text:p></office:text>',
    )
    const result = await read(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'o.odt'))
    expect(result.text).toContain('Hello world')
  })

  it('reads rich text and skips its tables of fonts', () => {
    const text = rtfToText("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator X;}Hello \\u233? caf\\'e9\\par Next}")
    expect(text).toContain('Hello é café')
    expect(text).toContain('Next')
    expect(text).not.toContain('Arial')
    expect(text).not.toContain('generator')
  })

  it('makes a comic book into picture pages in order', async () => {
    const zip = new JSZip()
    for (const name of ['p10.png', 'p2.png', 'p1.png']) zip.file(name, Uint8Array.from([0x89, 0x50, 1, 2]))
    const result = await read(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'c.cbz'))
    expect(result.chapters).toHaveLength(3)
    expect(Object.keys(result.zip.files).filter((name) => /images\/img/.test(name))).toHaveLength(3)
    expect(result.opf).toContain('cover-image')
  })

  it('packs a valid epub container', async () => {
    const { zip } = await read(new File(['hello'], 'h.txt'))
    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip')
    expect(zip.file('META-INF/container.xml')).not.toBeNull()
  })
})

describe('kindle files', () => {
  it('decompresses PalmDoc runs', () => {
    // "hello " literal, then a copy of 5 bytes from 6 back, then a space-plus-letter byte.
    const input = Uint8Array.from([...enc('hello '), 0x80 | 0, 0x00, 0xe1])
    const out = palmDecompress(Uint8Array.from([0x68, 0x69, 0x20, 0x80, 0x1b, 0xc2]))
    expect(new TextDecoder().decode(out).startsWith('hi ')).toBe(true)
    expect(input.length).toBeGreaterThan(0)
    expect(new TextDecoder().decode(palmDecompress(Uint8Array.from([0x61, 0xc2])))).toBe('a B')
  })

  function buildMobi(text: string, encryption = 0): ArrayBuffer {
    const body = enc(text)
    const header = new Uint8Array(16 + 232)
    const view = new DataView(header.buffer)
    view.setUint16(0, 1) // no compression
    view.setUint32(4, body.length)
    view.setUint16(8, 1)
    view.setUint16(10, 4096)
    view.setUint16(12, encryption)
    header.set(enc('MOBI'), 16)
    view.setUint32(20, 232)
    view.setUint32(28, 65001)
    view.setUint32(108, 0xffffffff)
    const name = enc('Kindle Tale')
    const total = 78 + 2 * 8 + 2
    const record0 = new Uint8Array(header.length + name.length)
    record0.set(header)
    record0.set(name, header.length)
    new DataView(record0.buffer).setUint32(84, header.length)
    new DataView(record0.buffer).setUint32(88, name.length)
    const file = new Uint8Array(total + record0.length + body.length)
    const fv = new DataView(file.buffer)
    fv.setUint16(76, 2)
    fv.setUint32(78, total)
    fv.setUint32(86, total + record0.length)
    file.set(record0, total)
    file.set(body, total + record0.length)
    return file.buffer
  }

  it('reads text and title from a simple Kindle file', () => {
    const markup = `<html><body><h1>One</h1><p>${'Words go here. '.repeat(40)}</p><mbp:pagebreak/><h1>Two</h1><p>${'More words follow. '.repeat(40)}</p></body></html>`
    const draft = mobiToDraft(buildMobi(markup), 'k.mobi')
    expect(draft.title).toBe('Kindle Tale')
    expect(draft.chapters.map((chapter) => chapter.title)).toEqual(['One', 'Two'])
  })

  it('refuses copy-protected Kindle books with a clear message', () => {
    expect(() => mobiToDraft(buildMobi('x', 2), 'k.mobi')).toThrow(/copy-protected/)
  })
})

describe('tidyHtml', () => {
  it('closes unclosed tags and escapes text', () => {
    expect(tidyHtml('<p>one <b>bold<p>two & three')).toBe('<p>one <b>bold</b></p><p>two &amp; three</p>')
  })
})
