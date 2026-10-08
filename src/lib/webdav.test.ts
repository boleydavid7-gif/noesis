import { describe, expect, it } from 'vitest'
import { parseMultistatus } from './webdav'

const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/Books/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Books/Fiction/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Books/My%20Book.epub</d:href><d:propstat><d:prop><d:getcontentlength>2048</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Books/notes.exe</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Books/.hidden.epub</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Books/A.pdf</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
</d:multistatus>`

describe('parseMultistatus', () => {
  it('lists folders first, then book files, and skips the rest', () => {
    const list = parseMultistatus(xml, 'https://cloud.example.com/dav/Books/')
    expect(list.map((entry) => entry.name)).toEqual(['Fiction', 'A.pdf', 'My Book.epub'])
    expect(list[0].folder).toBe(true)
    expect(list[2]).toMatchObject({
      folder: false,
      size: 2048,
      url: 'https://cloud.example.com/dav/Books/My%20Book.epub',
    })
  })
  it('ignores entries on another host', () => {
    const other =
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>https://evil.example/x.epub</d:href></d:response></d:multistatus>'
    expect(parseMultistatus(other, 'https://cloud.example.com/dav/')).toEqual([])
  })
})
