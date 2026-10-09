import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { assertNotProtected, EpubProtectedError, looksScrambled } from './epub'

async function epubWith(encryption?: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  if (encryption) zip.file('META-INF/encryption.xml', encryption)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const block = (algorithm: string, uri: string) =>
  `<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData>`
const wrap = (...blocks: string[]) =>
  `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">${blocks.join('')}</encryption>`

describe('copy-protected EPUBs', () => {
  it('accepts a plain book', async () => {
    await expect(assertNotProtected(await epubWith())).resolves.toBeUndefined()
  })

  it('accepts font obfuscation, which leaves the text readable', async () => {
    const xml = wrap(block('http://www.idpf.org/2008/embedding', 'fonts/a.otf'))
    await expect(assertNotProtected(await epubWith(xml))).resolves.toBeUndefined()
  })

  it('recognises encrypted chapters', async () => {
    const xml = wrap(block('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/chapter1.xhtml'))
    await expect(assertNotProtected(await epubWith(xml))).rejects.toBeInstanceOf(EpubProtectedError)
  })
})

describe('scrambled text', () => {
  it('spots binary noise but not ordinary prose', () => {
    expect(looksScrambled('The morning light came slowly over the hill and the village woke. '.repeat(5))).toBe(false)
    expect(looksScrambled('日本語の文章です。'.repeat(20))).toBe(false)
    expect(looksScrambled(('U5��G��\u0003U�' + 'ab').repeat(40))).toBe(true)
  })
})
