import { useEffect, useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import { browseCloud, cloudLabel, type CloudEntry, type LibraryFolder } from './lib/cloudFind'
import type { CloudConnection } from './lib/cloudProviders'

/** Folders of a connected storage, one level at a time, to choose the library folder. */
export function LibraryFolderPicker({
  connection,
  onChosen,
  onClose,
}: {
  connection: CloudConnection
  onChosen: (folder: LibraryFolder) => void
  onClose: () => void
}) {
  const label = cloudLabel(connection.provider)
  const [trail, setTrail] = useState<{ id?: string; name: string; path?: string }[]>([{ name: label }])
  const [entries, setEntries] = useState<CloudEntry[]>()
  const [problem, setProblem] = useState<string>()
  const here = trail[trail.length - 1]
  useEffect(() => {
    let live = true
    setEntries(undefined)
    setProblem(undefined)
    browseCloud(connection, here.id)
      .then((found) => live && setEntries(found))
      .catch((error: unknown) => live && setProblem(error instanceof Error ? error.message : 'That did not open.'))
    return () => {
      live = false
    }
  }, [connection, here.id])
  const folders = entries?.filter((entry) => entry.isFolder) ?? []
  const books =
    entries?.filter((entry) => !entry.isFolder && /\.(epub|pdf|mobi|azw3|docx|txt|md|html?|fb2|cbz)$/i.test(entry.name))
      .length ?? 0
  const canUse = here.id !== undefined || connection.provider === 'dropbox'
  return (
    <div className="folder-picker">
      <nav className="folder-picker-trail" aria-label="Where">
        {trail.map((step, index) => (
          <button
            key={`${step.id ?? 'top'}-${index}`}
            type="button"
            disabled={index === trail.length - 1}
            onClick={() => setTrail(trail.slice(0, index + 1))}
          >
            {step.name}
          </button>
        ))}
      </nav>
      {problem ? <p className="setting-note">{problem}</p> : null}
      {!entries && !problem ? <p className="setting-note">Opening…</p> : null}
      {entries ? (
        <ul className="folder-picker-list">
          {folders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                onClick={() => setTrail([...trail, { id: folder.id, name: folder.name, path: folder.path }])}
              >
                <Folder size={16} /> <span>{folder.name}</span> <ChevronRight size={15} />
              </button>
            </li>
          ))}
          {!folders.length ? <li className="folder-picker-empty">No folders inside.</li> : null}
        </ul>
      ) : null}
      {entries ? (
        <p className="setting-note">
          {books === 0
            ? 'No books directly in this folder.'
            : books === 1
              ? 'One book directly in this folder.'
              : `${books} books directly in this folder.`}{' '}
          Folders inside are read too.
        </p>
      ) : null}
      <div className="folder-picker-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        {canUse ? (
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onChosen({
                provider: connection.provider,
                id: here.id ?? '',
                name: here.name,
                path: here.path ?? (connection.provider === 'dropbox' && !here.id ? '' : undefined),
              })
            }
          >
            Use “{here.name}”
          </button>
        ) : null}
      </div>
    </div>
  )
}
