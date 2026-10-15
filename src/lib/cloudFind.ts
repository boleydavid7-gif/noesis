import { freshCloudConnection, type CloudConnection, type CloudProviderId } from './cloudProviders'

/*
 * Reading the person's own cloud folders (read only), beside the Noesis folder the backup writes to: choosing a
 * library folder, listing the books in it and below, finding one book by its file name and size wherever it is,
 * and fetching a file by its id. OneDrive and Google Drive see every folder once connected with `readsFolders`;
 * Dropbox's app sees its own app folder.
 */

export type CloudEntry = { id: string; name: string; size: number; isFolder: boolean; path?: string }
export type CloudFileFound = { id: string; path: string; size: number; download?: string }
export type LibraryFolder = { provider: CloudProviderId; id: string; name: string; path?: string }

const LABELS: Record<CloudProviderId, string> = {
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
}
export const cloudLabel = (provider: CloudProviderId) => LABELS[provider]

async function call(connection: CloudConnection, url: string, init: RequestInit = {}): Promise<Response> {
  const fresh = await freshCloudConnection(connection)
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${fresh.accessToken}` },
  })
  if (response.status === 401 || response.status === 403)
    throw new Error(`${LABELS[connection.provider]} asked to connect again, with leave to read your folders.`)
  if (!response.ok)
    throw new Error(
      response.status === 404 || response.status === 409
        ? 'That folder is no longer there. Choose it again.'
        : `${LABELS[connection.provider]} could not be reached. Try again.`,
    )
  return response
}

/** Dropbox's argument header takes ASCII only; other characters go as \\u escapes. */
export const dropboxArg = (value: unknown) =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

type Listed = CloudEntry & { download?: string }

async function list(connection: CloudConnection, id: string | undefined, deep = false): Promise<Listed[]> {
  const found: Listed[] = []
  if (connection.provider === 'onedrive') {
    let next: string | undefined =
      `https://graph.microsoft.com/v1.0${id ? `/me/drive/items/${encodeURIComponent(id)}` : '/me/drive/root'}/children?$top=200&$select=id,name,size,folder,file,@microsoft.graph.downloadUrl`
    while (next && found.length < 5000) {
      const page = (await (await call(connection, next)).json()) as {
        value: {
          id: string
          name: string
          size?: number
          folder?: unknown
          file?: unknown
          '@microsoft.graph.downloadUrl'?: string
        }[]
        '@odata.nextLink'?: string
      }
      for (const item of page.value)
        if (item.folder || item.file)
          found.push({
            id: item.id,
            name: item.name,
            size: item.size ?? 0,
            isFolder: Boolean(item.folder),
            download: item['@microsoft.graph.downloadUrl'],
          })
      next = page['@odata.nextLink']
    }
  } else if (connection.provider === 'google-drive') {
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({
        q: `'${(id ?? 'root').replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,size)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (pageToken) query.set('pageToken', pageToken)
      const page = (await (await call(connection, `https://www.googleapis.com/drive/v3/files?${query}`)).json()) as {
        files: { id: string; name: string; mimeType: string; size?: string }[]
        nextPageToken?: string
      }
      for (const item of page.files) {
        const isFolder = item.mimeType === 'application/vnd.google-apps.folder'
        // Google's own documents have no file to read; books are ordinary files.
        if (!isFolder && item.mimeType.startsWith('application/vnd.google-apps.')) continue
        found.push({ id: item.id, name: item.name, size: Number(item.size ?? 0), isFolder })
      }
      pageToken = page.nextPageToken
    } while (pageToken && found.length < 5000)
  } else {
    const post = (url: string, body: unknown) =>
      call(connection, url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    type Page = {
      entries: { '.tag': string; id: string; name: string; size?: number; path_display?: string }[]
      cursor: string
      has_more: boolean
    }
    let page = (await (
      await post('https://api.dropboxapi.com/2/files/list_folder', { path: id ?? '', recursive: deep, limit: 2000 })
    ).json()) as Page
    for (;;) {
      for (const item of page.entries)
        if (item['.tag'] === 'file' || item['.tag'] === 'folder')
          found.push({
            id: item.id,
            name: item.name,
            size: item.size ?? 0,
            isFolder: item['.tag'] === 'folder',
            path: item.path_display,
          })
      if (!page.has_more || found.length >= 10000) break
      page = (await (
        await post('https://api.dropboxapi.com/2/files/list_folder/continue', { cursor: page.cursor })
      ).json()) as Page
    }
  }
  return found
}

/** One level of the storage, folders first, for choosing the library folder (`id` absent: the top). */
export async function browseCloud(connection: CloudConnection, id?: string): Promise<CloudEntry[]> {
  return (await list(connection, id))
    .filter((item) => !item.name.startsWith('.'))
    .map(({ id: itemId, name, size, isFolder, path }) => ({ id: itemId, name, size, isFolder, path }))
    .sort(
      (a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
}

/** The folder all these paths sit in ("/Books/a.epub", "/Books/b/c.pdf" → "/Books"). */
export function commonFolder(paths: readonly string[]): string {
  if (!paths.length) return ''
  const parts = paths.map((path) => path.split('/').slice(0, -1))
  const shared: string[] = []
  for (let at = 0; at < parts[0].length; at += 1) {
    if (parts.every((each) => each[at] === parts[0][at])) shared.push(parts[0][at])
    else break
  }
  return shared.join('/')
}

/** Every file in the library folder and below, with its path inside the folder (hidden files left out). */
export async function filesInFolder(connection: CloudConnection, folder: LibraryFolder): Promise<CloudFileFound[]> {
  if (connection.provider === 'dropbox') {
    const items = await list(connection, folder.id, true)
    const files = items.filter(
      (item) => !item.isFolder && item.path && !item.path.split('/').some((part) => part.startsWith('.')),
    )
    const base =
      folder.path ?? items.find((item) => item.id === folder.id)?.path ?? commonFolder(files.map((item) => item.path!))
    return files
      .slice(0, 3000)
      .map((item) => ({ id: item.id, path: item.path!.slice(base.length).replace(/^\//, ''), size: item.size }))
  }
  const found: CloudFileFound[] = []
  const walk = async (id: string, prefix: string, depth: number) => {
    if (depth > 6) return
    for (const item of await list(connection, id)) {
      if (item.name.startsWith('.') || found.length >= 3000) continue
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isFolder) await walk(item.id, path, depth + 1)
      else found.push({ id: item.id, path, size: item.size, download: item.download })
    }
  }
  await walk(folder.id, '', 0)
  return found
}

/** The same name (case aside), and the same size when the book's size is known. */
export function pickMatch<T extends { name: string; size?: number }>(
  found: readonly T[],
  name: string,
  size?: number,
): T | undefined {
  const named = found.filter((item) => item.name.toLowerCase() === name.toLowerCase())
  return size ? named.find((item) => item.size === size) : named[0]
}

/** The file of that name (and size, when known) anywhere in the storage; undefined when none matches. */
export async function findInStorage(
  connection: CloudConnection,
  name: string,
  size?: number,
): Promise<{ id: string; download?: string } | undefined> {
  let found: { id: string; name: string; size?: number; download?: string }[] = []
  if (connection.provider === 'onedrive') {
    const query = encodeURIComponent(name.replace(/'/g, "''"))
    const page = (await (
      await call(
        connection,
        `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${query}')?$top=50&$select=id,name,size,file,@microsoft.graph.downloadUrl`,
      )
    ).json()) as {
      value: { id: string; name: string; size?: number; file?: unknown; '@microsoft.graph.downloadUrl'?: string }[]
    }
    found = page.value
      .filter((item) => item.file)
      .map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        download: item['@microsoft.graph.downloadUrl'],
      }))
  } else if (connection.provider === 'google-drive') {
    const query = new URLSearchParams({
      q: `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id,name,size)',
      pageSize: '50',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    const page = (await (await call(connection, `https://www.googleapis.com/drive/v3/files?${query}`)).json()) as {
      files: { id: string; name: string; size?: string }[]
    }
    found = page.files.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size === undefined ? undefined : Number(item.size),
    }))
  } else {
    const response = await call(connection, 'https://api.dropboxapi.com/2/files/search_v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: name, options: { filename_only: true, max_results: 50 } }),
    })
    const page = (await response.json()) as {
      matches: { metadata: { metadata: { '.tag': string; id: string; name: string; size?: number } } }[]
    }
    found = page.matches
      .map((match) => match.metadata.metadata)
      .filter((item) => item['.tag'] === 'file')
      .map((item) => ({ id: item.id, name: item.name, size: item.size }))
  }
  const match = pickMatch(found, name, size)
  return match ? { id: match.id, download: match.download } : undefined
}

/** A file's bytes by its id in the storage. */
export async function downloadById(
  connection: CloudConnection,
  file: { id: string; download?: string },
): Promise<ArrayBuffer> {
  let response: Response
  if (connection.provider === 'onedrive') {
    response = file.download
      ? await fetch(file.download)
      : await call(connection, `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(file.id)}/content`)
  } else if (connection.provider === 'google-drive') {
    response = await call(
      connection,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    )
  } else {
    response = await call(connection, 'https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': dropboxArg({ path: file.id }) },
    })
  }
  if (!response.ok) throw new Error(`${LABELS[connection.provider]} did not give the file.`)
  return response.arrayBuffer()
}
