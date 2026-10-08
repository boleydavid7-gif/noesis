import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Group, Row, Segmented, Toggle } from './settings/controls'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings/sections'
import { ACCENTS, FONT_STACKS, READER_COLORS, updateSetting, type AccentName, type Settings } from './lib/settings'
import { formatBytes, rebuildTextIndex } from './lib/reindex'
import type { LibraryBook } from './lib/library'

type Props = {
  section: SettingsSectionId
  onSection: (section: SettingsSectionId) => void
  settings: Settings
  onChange: (settings: Settings) => void
  account: ReactNode
  backup: ReactNode
  books: LibraryBook[]
  dueCount: number
  signedInEmail?: string
  onExport: () => void
  onClearLocal: () => void
  onNotice: (message: string) => void
}

export function SettingsPage(props: Props) {
  const { section, onSection, settings, onChange, onNotice } = props
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return SETTINGS_SECTIONS
    return SETTINGS_SECTIONS.filter((item) =>
      `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase().includes(needle),
    )
  }, [query])
  const set = <S extends keyof Settings, K extends keyof Settings[S]>(sectionKey: S, key: K, value: Settings[S][K]) =>
    onChange(updateSetting(settings, sectionKey, key, value))
  const active = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="settings-page">
      <div className="settings-head">
        <label className="settings-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
          />
        </label>
      </div>
      <div className="settings-layout">
        <nav className="settings-menu panel-card" aria-label="Settings sections">
          {visible.length === 0 ? <p className="settings-none">No settings match “{query}”.</p> : null}
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === active.id ? 'settings-menu-active' : ''}
              onClick={() => onSection(item.id)}
              aria-current={item.id === active.id ? 'page' : undefined}
            >
              <item.icon size={20} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          <header className="settings-panel-head">
            <active.icon size={26} />
            <div>
              <h3>{active.title}</h3>
              <p>{active.subtitle}</p>
            </div>
          </header>
          {section === 'account' ? props.account : null}
          {section === 'backup' ? props.backup : null}
          {section === 'reading' ? <ReadingSection settings={settings} set={set} /> : null}
          {section === 'appearance' ? <AppearanceSection settings={settings} set={set} /> : null}
          {section === 'library' ? (
            <LibrarySection settings={settings} set={set} books={props.books} onNotice={onNotice} />
          ) : null}
          {section === 'ai' ? <AiSection settings={settings} set={set} /> : null}
          {section === 'notifications' ? (
            <NotificationsSection settings={settings} set={set} dueCount={props.dueCount} onNotice={onNotice} />
          ) : null}
          {section === 'privacy' ? (
            <PrivacySection email={props.signedInEmail} onExport={props.onExport} onClearLocal={props.onClearLocal} />
          ) : null}
          {section === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </div>
  )
}

type SetFn = <S extends keyof Settings, K extends keyof Settings[S]>(section: S, key: K, value: Settings[S][K]) => void

function ReadingSection({ settings, set }: { settings: Settings; set: SetFn }) {
  const reading = settings.reading
  const colors = READER_COLORS[reading.theme]
  return (
    <>
      <Group title="Text">
        <Row title="Text size" detail={`${reading.fontSize}%`}>
          <input
            type="range"
            min={85}
            max={140}
            step={5}
            value={reading.fontSize}
            onChange={(event) => set('reading', 'fontSize', Number(event.target.value))}
            aria-label="Text size"
          />
        </Row>
        <Row title="Font" detail="Use each book’s own font, or pick one.">
          <Segmented
            label="Font"
            value={reading.font}
            onChange={(value) => set('reading', 'font', value)}
            options={[
              { value: 'book', label: "Book's own" },
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
            ]}
          />
        </Row>
        <Row title="Line spacing" detail={reading.lineHeight.toFixed(2)}>
          <input
            type="range"
            min={1.3}
            max={2.2}
            step={0.05}
            value={reading.lineHeight}
            onChange={(event) => set('reading', 'lineHeight', Number(event.target.value))}
            aria-label="Line spacing"
          />
        </Row>
      </Group>
      <Group title="Page">
        <Row title="Page color">
          <Segmented
            label="Page color"
            value={reading.theme}
            onChange={(value) => set('reading', 'theme', value)}
            options={[
              { value: 'paper', label: 'Paper' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'night', label: 'Night' },
            ]}
          />
        </Row>
        <Row title="Open books in wide layout" detail="Shows the reading tools beside the page.">
          <Toggle
            checked={reading.startWide}
            onChange={(value) => set('reading', 'startWide', value)}
            label="Open books in wide layout"
          />
        </Row>
        <div
          className="reading-preview"
          style={{
            background: colors.background,
            color: colors.color,
            fontSize: `${reading.fontSize}%`,
            lineHeight: reading.lineHeight,
            fontFamily: FONT_STACKS[reading.font] ?? "Georgia, 'Times New Roman', serif",
          }}
        >
          This is how your text will look.
        </div>
      </Group>
    </>
  )
}

function AppearanceSection({ settings, set }: { settings: Settings; set: SetFn }) {
  const appearance = settings.appearance
  return (
    <Group title="Look and feel">
      <Row title="Accent color" detail="Used for buttons, highlights, and the logo mark.">
        <div className="swatches" role="radiogroup" aria-label="Accent color">
          {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={appearance.accent === name}
              aria-label={ACCENTS[name].label}
              title={ACCENTS[name].label}
              className={appearance.accent === name ? 'swatch swatch-on' : 'swatch'}
              style={{ background: ACCENTS[name].main }}
              onClick={() => set('appearance', 'accent', name)}
            />
          ))}
        </div>
      </Row>
      <Row title="Scenery backgrounds" detail="Turn off the photo backgrounds.">
        <Toggle
          checked={appearance.scenery}
          onChange={(value) => set('appearance', 'scenery', value)}
          label="Scenery backgrounds"
        />
      </Row>
      <Row title="Reduce motion" detail="Stops animations and transitions.">
        <Toggle
          checked={appearance.reduceMotion}
          onChange={(value) => set('appearance', 'reduceMotion', value)}
          label="Reduce motion"
        />
      </Row>
      <Row title="Compact layout" detail="Tighter spacing so more fits on screen.">
        <Toggle
          checked={appearance.compact}
          onChange={(value) => set('appearance', 'compact', value)}
          label="Compact layout"
        />
      </Row>
    </Group>
  )
}

function LibrarySection({
  settings,
  set,
  books,
  onNotice,
}: {
  settings: Settings
  set: SetFn
  books: LibraryBook[]
  onNotice: (message: string) => void
}) {
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (!cancelled && estimate.usage !== undefined) setUsage({ used: estimate.usage, quota: estimate.quota ?? 0 })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [progress])
  const bookBytes = books.reduce((sum, book) => sum + (book.fileSize ?? 0), 0)
  const epubCount = books.filter((book) => book.format === 'epub').length

  async function rebuild() {
    setProgress({ done: 0, total: epubCount })
    try {
      const result = await rebuildTextIndex(books, (done, total) => setProgress({ done, total }))
      onNotice(
        `Search index rebuilt for ${result.indexed} ${result.indexed === 1 ? 'book' : 'books'}${result.skipped ? ` (${result.skipped} skipped)` : ''}.`,
      )
    } catch {
      onNotice('The search index could not be rebuilt.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <>
      <Group title="Library">
        <Row title="Default sort" detail="How your library is ordered when you open it.">
          <Segmented
            label="Default sort"
            value={settings.library.defaultSort}
            onChange={(value) => set('library', 'defaultSort', value)}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'title', label: 'Title' },
              { value: 'progress', label: 'Progress' },
            ]}
          />
        </Row>
        <Row title="Index book text" detail="Lets search and Noema read your books.">
          <Toggle
            checked={settings.library.indexText}
            onChange={(value) => set('library', 'indexText', value)}
            label="Index book text"
          />
        </Row>
        <Row title="Confirm before removing a book">
          <Toggle
            checked={settings.library.confirmDelete}
            onChange={(value) => set('library', 'confirmDelete', value)}
            label="Confirm before removing a book"
          />
        </Row>
      </Group>
      <Group title="On this device">
        <Row
          title="Storage used"
          detail={
            usage
              ? `${formatBytes(usage.used)}${usage.quota ? ` of ${formatBytes(usage.quota)} available` : ''} · books: ${formatBytes(bookBytes)}`
              : `Books: ${formatBytes(bookBytes)}`
          }
        >
          <span className="setting-pill">
            {books.length} {books.length === 1 ? 'book' : 'books'}
          </span>
        </Row>
        <Row title="Rebuild search index" detail="Re-read your books so search and Noema can use their text.">
          <button
            className="secondary-button"
            onClick={() => void rebuild()}
            disabled={progress !== null || epubCount === 0}
          >
            {progress ? `Indexing ${progress.done}/${progress.total}…` : 'Rebuild'}
          </button>
        </Row>
      </Group>
    </>
  )
}

function AiSection({ settings, set }: { settings: Settings; set: SetFn }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'missing' | 'offline'>('checking')
  useEffect(() => {
    let cancelled = false
    void fetch('/api/health', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ geminiConfigured?: boolean }>)
      .then((body) => {
        if (!cancelled) setStatus(body.geminiConfigured ? 'ready' : 'missing')
      })
      .catch(() => {
        if (!cancelled) setStatus('offline')
      })
    return () => {
      cancelled = true
    }
  }, [])
  const ai = settings.ai
  return (
    <>
      <Group title="Noema">
        <Row
          title="Status"
          detail={
            status === 'checking'
              ? 'Checking…'
              : status === 'ready'
                ? 'Noema is connected.'
                : status === 'missing'
                  ? 'Noema is not configured on this server yet.'
                  : 'Could not reach the server.'
          }
        >
          <span className={`setting-pill${status === 'ready' ? ' setting-pill-good' : ''}`}>
            {status === 'ready' ? 'Ready' : status === 'checking' ? '…' : 'Unavailable'}
          </span>
        </Row>
        <Row title="Enable Noema" detail="When off, Noesis never sends anything to the AI.">
          <Toggle checked={ai.enabled} onChange={(value) => set('ai', 'enabled', value)} label="Enable Noema" />
        </Row>
        <Row title="Answer length">
          <Segmented
            label="Answer length"
            value={ai.length}
            onChange={(value) => set('ai', 'length', value)}
            options={[
              { value: 'concise', label: 'Concise' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />
        </Row>
      </Group>
      <Group title="What Noema can see">
        <Row
          title="The page I'm reading"
          detail="Visible text and any passage you select, plus relevant parts of the book."
        >
          <Toggle
            checked={ai.useReadingText}
            onChange={(value) => set('ai', 'useReadingText', value)}
            label="Share the page I'm reading"
          />
        </Row>
        <Row title="My notes" detail="Your Second Brain notes, so answers can connect to what you've saved.">
          <Toggle checked={ai.useNotes} onChange={(value) => set('ai', 'useNotes', value)} label="Share my notes" />
        </Row>
      </Group>
    </>
  )
}

function NotificationsSection({
  settings,
  set,
  dueCount,
  onNotice,
}: {
  settings: Settings
  set: SetFn
  dueCount: number
  onNotice: (message: string) => void
}) {
  const supported = typeof Notification !== 'undefined'
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied')

  async function toggle(value: boolean) {
    if (!value) {
      set('notifications', 'reviewReminders', false)
      return
    }
    if (!supported) {
      onNotice('This browser does not support notifications.')
      return
    }
    const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') set('notifications', 'reviewReminders', true)
    else onNotice('Notifications are blocked. Allow them in your browser settings for this site, then try again.')
  }

  return (
    <Group title="Reminders">
      <Row
        title="Review reminders"
        detail={
          !supported
            ? 'Not supported in this browser.'
            : permission === 'denied'
              ? 'Blocked by your browser. Allow notifications for this site to turn this on.'
              : 'Shows a notification once a day, when you open Noesis and review cards are due.'
        }
      >
        <Toggle
          checked={settings.notifications.reviewReminders && permission === 'granted'}
          onChange={(value) => void toggle(value)}
          label="Review reminders"
          disabled={!supported}
        />
      </Row>
      <Row title="Cards due now">
        <span className="setting-pill">{dueCount}</span>
      </Row>
      <Row title="Send a test notification">
        <button
          className="secondary-button"
          disabled={!supported || permission !== 'granted'}
          onClick={() =>
            new Notification('Noesis', { body: 'Notifications are working.', icon: '/icons/icon-192.png' })
          }
        >
          Test
        </button>
      </Row>
      <p className="setting-note">Reminders only appear while Noesis is open or installed.</p>
    </Group>
  )
}

function PrivacySection({
  email,
  onExport,
  onClearLocal,
}: {
  email?: string
  onExport: () => void
  onClearLocal: () => void
}) {
  const subject = encodeURIComponent('Noesis account deletion request')
  const body = encodeURIComponent(
    `Please delete my Noesis account${email ? ` (${email})` : ''} and the data stored with it.`,
  )
  return (
    <>
      <Group title="Your data">
        <Row
          title="Where it lives"
          detail="Stored in this browser. If you sign in, it also syncs to your account and any cloud you connect."
        >
          <a className="secondary-button" href="/privacy" target="_blank" rel="noreferrer">
            Privacy policy
          </a>
        </Row>
        <Row title="Download my data" detail="A ZIP with your books, notes, and learning paths.">
          <button className="secondary-button" onClick={onExport}>
            Export
          </button>
        </Row>
        <Row title="Terms of service">
          <a className="secondary-button" href="/terms" target="_blank" rel="noreferrer">
            Read terms
          </a>
        </Row>
      </Group>
      <Group title="Remove data">
        <Row
          title="Delete data on this device"
          detail="Removes your books, notes, settings, and review cards from this browser. Anything synced to your account or a cloud provider is kept."
        >
          <button className="secondary-button setting-danger" onClick={onClearLocal}>
            Delete
          </button>
        </Row>
        <Row title="Delete my account" detail="Email us and we'll remove your account and everything stored with it.">
          <a
            className="secondary-button setting-danger"
            href={`mailto:boleydavid7@gmail.com?subject=${subject}&body=${body}`}
          >
            Request deletion
          </a>
        </Row>
      </Group>
    </>
  )
}

function AboutSection() {
  return (
    <Group title="Noesis">
      <Row title="Version" detail={`Built ${__BUILD_DATE__}`}>
        <span className="setting-pill">{__APP_VERSION__}</span>
      </Row>
      <Row title="Made by" detail="Proairetos">
        <a className="secondary-button" href="mailto:boleydavid7@gmail.com">
          Contact
        </a>
      </Row>
      <Row title="Legal">
        <span className="setting-links">
          <a href="/privacy" target="_blank" rel="noreferrer">
            Privacy
          </a>
          <a href="/terms" target="_blank" rel="noreferrer">
            Terms
          </a>
        </span>
      </Row>
    </Group>
  )
}
