// Places to find books that work in Noesis because they come without DRM.

export type BookSource = { name: string; note: string; url: (query: string) => string; always: boolean }

const q = encodeURIComponent

export const DRM_FREE_SOURCES: BookSource[] = [
  {
    name: 'Standard Ebooks',
    note: 'Public-domain classics, beautifully made',
    always: true,
    url: (s) => `https://standardebooks.org/ebooks?query=${q(s)}`,
  },
  {
    name: 'Project Gutenberg',
    note: 'Tens of thousands of public-domain books',
    always: true,
    url: (s) => `https://www.gutenberg.org/ebooks/search/?query=${q(s)}`,
  },
  {
    name: 'Smashwords',
    note: 'Independent fiction and nonfiction',
    always: true,
    url: (s) => `https://www.smashwords.com/books/search?query=${q(s)}`,
  },
  {
    name: 'Baen',
    note: 'Science fiction and fantasy, always without DRM',
    always: true,
    url: (s) => `https://www.baen.com/catalogsearch/result/?q=${q(s)}`,
  },
  {
    name: 'Leanpub',
    note: 'Books by independent authors, mostly technical',
    always: true,
    url: (s) => `https://leanpub.com/bookstore?search=${q(s)}`,
  },
  {
    name: 'Pragmatic Bookshelf',
    note: 'Programming and technology',
    always: true,
    url: (s) => `https://pragprog.com/search/?q=${q(s)}`,
  },
  {
    name: 'No Starch Press',
    note: 'Technology, security and making',
    always: true,
    url: (s) => `https://nostarch.com/search?search_api_fulltext=${q(s)}`,
  },
  {
    name: 'Manning',
    note: 'Programming and data',
    always: true,
    url: (s) => `https://www.manning.com/search?q=${q(s)}`,
  },
  {
    name: 'Humble Bundle',
    note: 'Book bundles, usually without DRM',
    always: false,
    url: () => 'https://www.humblebundle.com/books',
  },
  {
    name: 'Kobo',
    note: 'Many titles have no DRM; the page says which',
    always: false,
    url: (s) => `https://www.kobo.com/us/en/search?query=${q(s)}`,
  },
  {
    name: 'Bookshop.org',
    note: 'Some e-books have no DRM; check the description',
    always: false,
    url: (s) => `https://bookshop.org/search?keywords=${q(s)}`,
  },
]
