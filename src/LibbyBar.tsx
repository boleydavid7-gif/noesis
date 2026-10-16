import { useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { useChosenLibrary } from './lib/publicLibrary'
import { LIBBY_SHELF, libbyLibrary, libbyLinkProps, libbySearch } from './lib/libby'

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

// Libby, one tap away: the shelf with loans and holds, the reader's library, and a search there.
export function LibbyBar() {
  const library = useChosenLibrary()
  const [query, setQuery] = useState('')
  return (
    <section className="libby-bar panel-card" aria-label="Libby">
      <div className="libby-head">
        <strong>Libby</strong>
        {library ? <small>{library.name}</small> : null}
        <span className="libby-links">
          <a className="secondary-button" href={LIBBY_SHELF} target="_blank" rel="noopener noreferrer">
            Shelf <ExternalLink size={13} />
          </a>
          <a className="secondary-button" href={libbyLibrary(library)} target="_blank" rel="noopener noreferrer">
            Library <ExternalLink size={13} />
          </a>
        </span>
      </div>
      {library?.libbyKey ? (
        <form
          className="libby-search"
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim()) open(libbySearch(library, query))
          }}
        >
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${library.name}`}
            aria-label="Search Libby"
            enterKeyHint="search"
          />
        </form>
      ) : null}
    </section>
  )
}

export function SearchLibbyLink({ query }: { query: string }) {
  const library = useChosenLibrary()
  if (!library?.libbyKey || !query.trim()) return null
  return (
    <a className="text-button" {...libbyLinkProps(libbySearch(library, query))}>
      Search Libby for “{query.trim()}” <ExternalLink size={13} />
    </a>
  )
}
