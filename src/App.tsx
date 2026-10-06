import { useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  CircleHelp,
  FileText,
  Flame,
  FolderOpen,
  Highlighter,
  Home,
  Library,
  ListChecks,
  Menu,
  MessageCircle,
  MoreVertical,
  Network,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import './App.css'

type Book = {
  id: string
  title: string
  author: string
  progress: number
  chapter: string
  updated: string
  accent: string
  cover: string
}

type Note = {
  kind: 'highlight' | 'idea' | 'question'
  body: string
  source: string
  tag: string
}

const initialBooks: Book[] = [
  { id: 'deep-work', title: 'Deep Work', author: 'Cal Newport', progress: 42, chapter: 'Chapter 4 · Rules for Focus', updated: 'Last read 2 hours ago', accent: 'cover-amber', cover: 'DEEP\nWORK' },
  { id: 'atomic-habits', title: 'Atomic Habits', author: 'James Clear', progress: 18, chapter: 'Chapter 2 · The Four Laws', updated: 'Last read yesterday', accent: 'cover-sand', cover: 'Atomic\nHabits' },
  { id: 'pragmatic-programmer', title: 'The Pragmatic Programmer', author: 'Hunt & Thomas', progress: 73, chapter: 'Chapter 6 · Concurrency', updated: 'Last read 3 days ago', accent: 'cover-blue', cover: 'The Pragmatic\nProgrammer' },
  { id: 'clean-architecture', title: 'Clean Architecture', author: 'Robert C. Martin', progress: 25, chapter: 'Chapter 5 · Architecture', updated: 'Last read 4 days ago', accent: 'cover-navy', cover: 'Clean\nArchitecture' },
  { id: 'thinking-fast-slow', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', progress: 10, chapter: 'Part 1 · Two Systems', updated: 'Last read last week', accent: 'cover-cream', cover: 'THINKING,\nFAST AND SLOW' },
  { id: 'art-learning', title: 'The Art of Learning', author: 'Josh Waitzkin', progress: 0, chapter: 'Ready to begin', updated: 'Added recently', accent: 'cover-mountain', cover: 'The Art of\nLearning' },
]

const initialNotes: Note[] = [
  { kind: 'highlight', body: 'Attention is a resource that must be managed.', source: 'Deep Work · p. 52', tag: '#focus' },
  { kind: 'idea', body: 'Combine deep work principles with my shift schedule.', source: 'Deep Work · Chapter 4', tag: '#implementation' },
  { kind: 'question', body: 'How does this apply to team environments at work?', source: 'Deep Work · Chapter 4', tag: '#question' },
]

const paths = [
  { title: 'Focused Learning', books: 5, progress: 28, icon: Brain, accent: 'path-green' },
  { title: 'IT Fundamentals', books: 8, progress: 15, icon: Network, accent: 'path-blue' },
  { title: 'Automotive Basics', books: 6, progress: 0, icon: FolderOpen, accent: 'path-orange' },
]

const navItems = [
  { label: 'Home', icon: Home },
  { label: 'My Library', icon: Library },
  { label: 'Learning Paths', icon: ListChecks },
  { label: 'Read', icon: BookOpen },
  { label: 'Notes', icon: FileText },
  { label: 'Second Brain', icon: Brain },
  { label: 'Ask GAYL', icon: MessageCircle },
  { label: 'Progress', icon: Network },
]

function ProgressRing({ value }: { value: number }) {
  return <div className="progress-ring" style={{ '--progress': `${value * 3.6}deg` } as React.CSSProperties}><span>{value}%</span></div>
}

function BookCover({ book, compact = false }: { book: Book; compact?: boolean }) {
  return <div className={`book-cover ${book.accent} ${compact ? 'book-cover-compact' : ''}`}>
    <div className="book-cover-mark">N</div>
    <strong>{book.cover.split('\n').map((line) => <span key={line}>{line}</span>)}</strong>
    <small>{book.author}</small>
  </div>
}

function App() {
  const [books, setBooks] = useState(initialBooks)
  const [notes] = useState(initialNotes)
  const [activeNav, setActiveNav] = useState('Home')
  const [query, setQuery] = useState('')
  const [tutorPrompt, setTutorPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const filteredBooks = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return books
    return books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(normalized))
  }, [books, query])

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3500)
  }

  function openBook(book: Book) {
    setSelectedBook(book)
    showNotice(`Reader preview ready for ${book.title}.`)
  }

  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const title = file.name.replace(/\.(epub|pdf)$/i, '').replace(/[-_]+/g, ' ').trim()
    const imported: Book = { id: `import-${Date.now()}`, title: title || 'Imported book', author: 'Imported locally', progress: 0, chapter: 'Ready to read', updated: 'Added just now', accent: 'cover-violet', cover: title || 'Imported\nBook' }
    setBooks((current) => [imported, ...current])
    showNotice(`${file.name} is in your library. EPUB parsing and reader import come next.`)
    event.target.value = ''
  }

  function askTutor(prompt: string) {
    const question = prompt.trim()
    if (!question) return
    setTutorPrompt(question)
    showNotice('GAYL will answer from the active book and your saved notes.')
  }

  return <div className="app-shell">
    <div className="ambient ambient-top" />
    <div className="ambient ambient-bottom" />

    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark"><BookOpen size={20} /></div>
        <div><strong>NOESIS</strong><span>Your learning space</span></div>
        <button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <nav className="main-nav" aria-label="Main navigation">
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'nav-item-active' : ''}`} onClick={() => { setActiveNav(label); setMobileNavOpen(false) }}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search books..." aria-label="Search books" /></div>
        <p className="eyebrow sidebar-eyebrow">Quick actions</p>
        <button className="quick-action" onClick={() => fileInput.current?.click()}><Plus size={16} /> Add book</button>
        <button className="quick-action" onClick={() => fileInput.current?.click()}><Upload size={16} /> Import EPUB / PDF</button>
        <button className="quick-action" onClick={() => showNotice('Path builder will use books from your library.')}><ListChecks size={16} /> Create learning path</button>
      </div>
    </aside>
    {mobileNavOpen ? <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" /> : null}

    <main className="main-column">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="greeting"><p className="eyebrow">{activeNav === 'Home' ? 'Today' : activeNav}</p><h1>Good morning, David<span>.</span></h1><p>Continue reading. Keep building what matters.</p></div>
        <div className="top-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to learn?" aria-label="Search your library" /><kbd>⌘ K</kbd></div>
        <button className="avatar-button" aria-label="Open account menu">D</button>
      </header>

      <div className="dashboard-grid">
        <section className="content-column">
          {selectedBook ? <section className="reader-preview panel-card">
            <div className="reader-preview-head"><div><p className="eyebrow">Reader preview</p><h2>{selectedBook.title}</h2><p>{selectedBook.chapter} · {selectedBook.author}</p></div><button className="icon-button" onClick={() => setSelectedBook(null)} aria-label="Close reader preview"><X size={18} /></button></div>
            <div className="reader-preview-body"><BookCover book={selectedBook} /><div className="reader-copy"><p className="reader-kicker"><Sparkles size={15} /> Your reader will open here</p><h3>Read, highlight, and ask about the page you are on.</h3><p>The next slice connects EPUB chapter text to this reader, saved locations, highlights, and GAYL context.</p><div className="reader-preview-actions"><button className="primary-button" onClick={() => showNotice('EPUB reader setup is next.')}>Resume reading <ArrowRight size={16} /></button><button className="secondary-button" onClick={() => showNotice('Notes will follow the selected book.')}>View notes</button></div></div></div>
          </section> : <section className="continue-card panel-card">
            <div className="continue-cover-wrap"><BookCover book={books[0]} /></div><div className="continue-details"><p className="eyebrow">Continue reading</p><h2>{books[0].title}</h2><p className="muted">{books[0].author}</p><div className="progress-row"><div className="progress-track"><span style={{ width: `${books[0].progress}%` }} /></div><strong>{books[0].progress}%</strong></div><p className="chapter-line"><BookOpen size={14} /> {books[0].chapter}</p><p className="muted small">{books[0].updated}</p></div><div className="continue-actions"><button className="primary-button" onClick={() => openBook(books[0])}>Resume reading <ArrowRight size={16} /></button><button className="secondary-button" onClick={() => setActiveNav('Notes')}><FileText size={16} /> View notes</button></div>
          </section>}

          <section className="section-block"><div className="section-heading"><div><h2>My library</h2><p>Books you are reading and keeping close.</p></div><button className="text-button" onClick={() => setActiveNav('My Library')}>View all <ArrowRight size={15} /></button></div><div className="book-grid">{filteredBooks.map((book) => <button key={book.id} className="book-card" onClick={() => openBook(book)}><div className="book-card-cover"><BookCover book={book} compact /><ProgressRing value={book.progress} /></div><div className="book-card-title">{book.title}</div><div className="book-card-author">{book.author}</div></button>)}</div>{filteredBooks.length === 0 ? <div className="empty-state">No books match “{query}”. Import an EPUB or PDF to start a library.</div> : null}</section>

          <section className="section-block"><div className="section-heading"><div><h2>Learning paths</h2><p>Collections with a purpose, built from your books.</p></div><button className="text-button" onClick={() => setActiveNav('Learning Paths')}>View all <ArrowRight size={15} /></button></div><div className="path-grid">{paths.map(({ title, books: bookCount, progress, icon: Icon, accent }) => <button key={title} className={`path-card ${accent}`} onClick={() => showNotice(`${title} is ready for the path builder.`)}><div className="path-art"><Icon size={25} /><span>NOESIS</span></div><div className="path-card-info"><strong>{title}</strong><span>{bookCount} books · {progress}% complete</span></div><div className="path-arrow"><ArrowRight size={16} /></div></button>)}</div></section>

          <section className="section-block notes-section"><div className="section-heading"><div><h2>My notes</h2><p>Highlights and ideas worth returning to.</p></div><button className="text-button" onClick={() => setActiveNav('Notes')}>View all <ArrowRight size={15} /></button></div><div className="note-tabs"><button className="note-tab note-tab-active">Recent</button><button className="note-tab">Highlights</button><button className="note-tab">Ideas</button><button className="note-tab">Questions</button></div><div className="notes-grid">{notes.map((note) => <article key={note.body} className={`note-card note-${note.kind}`}><div className="note-icon">{note.kind === 'highlight' ? <Highlighter size={16} /> : note.kind === 'idea' ? <Sparkles size={16} /> : <CircleHelp size={16} />}</div><p>{note.body}</p><span>{note.source}</span><div className="note-footer"><em>{note.tag}</em><button className="icon-button tiny" aria-label="More note actions"><MoreVertical size={15} /></button></div></article>)}</div></section>
        </section>

        <aside className="right-rail">
          <section className="tutor-card panel-card"><div className="tutor-head"><div className="gayl-orb"><span /></div><div><h2>Ask GAYL</h2><p>Your learning guide</p></div><button className="icon-button"><MoreVertical size={17} /></button></div><div className="tutor-input"><input value={tutorPrompt} onChange={(event) => setTutorPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') askTutor(tutorPrompt) }} placeholder="How can I help you learn?" aria-label="Ask GAYL" /><button onClick={() => askTutor(tutorPrompt)} aria-label="Send question"><ArrowRight size={17} /></button></div><div className="tutor-chips"><button onClick={() => askTutor('Explain this chapter')}>Explain this chapter</button><button onClick={() => askTutor('Summarize the key ideas')}>Summarize key ideas</button><button onClick={() => askTutor('Test my understanding')}>Test my understanding</button><button onClick={() => askTutor('Connect this to what I am learning')}>Connect this to what I’m learning</button><button onClick={() => askTutor('Recommend related books')}>Recommend related books</button></div>{tutorPrompt ? <div className="tutor-status"><MessageCircle size={14} /> “{tutorPrompt}” is queued for the active reader.</div> : null}</section>
          <section className="rail-card panel-card progress-card"><div className="rail-heading"><h2>Progress</h2><button className="text-button">Details <ArrowRight size={14} /></button></div><div className="progress-summary"><div className="large-ring"><span>27<small>%</small></span><em>Overall</em></div><div className="progress-stats"><span><BookOpen size={15} /> Books <strong>{books.length}</strong></span><span><FileText size={15} /> Pages read <strong>1,842</strong></span><span><Highlighter size={15} /> Notes <strong>{notes.length + 123}</strong></span><span><ListChecks size={15} /> Paths <strong>3</strong></span></div></div></section>
          <section className="rail-card panel-card streak-card"><div className="rail-heading"><h2>Study streak</h2></div><div className="streak-row"><div className="flame"><Flame size={27} fill="currentColor" /></div><div><strong>12</strong><span>days</span></div><div className="week-dots">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`} className={index < 5 ? 'week-done' : ''}><em>{day}</em>{index < 5 ? <Check size={11} /> : null}</span>)}</div></div></section>
          <section className="rail-card panel-card recently-card"><div className="rail-heading"><h2>Recently added</h2><button className="text-button" onClick={() => fileInput.current?.click()}>Add <Plus size={14} /></button></div>{['Building a Second Brain', 'Digital Minimalism', 'Make It Stick'].map((title, index) => <button key={title} className="recent-row" onClick={() => showNotice(`${title} will open in the reader.`)}><div className={`mini-cover mini-${index}`}><BookOpen size={13} /></div><div><strong>{title}</strong><span>{index === 0 ? 'Tiago Forte' : index === 1 ? 'Cal Newport' : 'Brown, Roediger, McDaniel'}</span><small>EPUB · {index === 0 ? '2 days ago' : index === 1 ? '4 days ago' : '1 week ago'}</small></div></button>)}</section>
        </aside>
      </div>

      <input ref={fileInput} className="visually-hidden" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={handleImport} />
      {notice ? <div className="toast-notice"><Sparkles size={15} /> {notice}</div> : null}
    </main>
  </div>
}

export default App
