import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { filterCommands, type Command } from './lib/commands'

// A quick way to get anywhere: type to find a page, a book, a note or an action.
export function CommandBar({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const results = useMemo(() => filterCommands(commands, query), [commands, query])
  const active = Math.min(index, Math.max(0, results.length - 1))

  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    document.querySelector('.command-item-on')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (command: Command | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <div className="brain-backdrop command-backdrop" data-overlay onMouseDown={onClose}>
      <div
        className="command-bar panel-card"
        role="dialog"
        aria-label="Search everything"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex(Math.min(active + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex(Math.max(active - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(results[active])
              } else if (event.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Search books, notes and pages, or type an action"
            aria-label="Search everything"
          />
          <kbd>Esc</kbd>
        </div>
        <ul role="listbox">
          {results.length === 0 ? <li className="command-empty">Nothing matches that.</li> : null}
          {results.map((command, position) => {
            const heading = position === 0 || results[position - 1].group !== command.group ? command.group : ''
            return (
              <li key={command.id} role="presentation">
                {heading ? <div className="command-group">{heading}</div> : null}
                <button
                  role="option"
                  aria-selected={position === active}
                  className={position === active ? 'command-item command-item-on' : 'command-item'}
                  onMouseMove={() => setIndex(position)}
                  onClick={() => choose(command)}
                >
                  <span>{command.label}</span>
                  {command.hint ? <small>{command.hint}</small> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
