export type CloudProviderId = 'google-drive' | 'onedrive' | 'dropbox'

export type CloudConnection = {
  provider: CloudProviderId
  accessToken: string
  expiresAt: number
  connectedAt: string
  /**
   * The Noesis account that authorized this browser connection. Older
   * connections do not have this field and are claimed by the first account
   * that signs in after the migration.
   */
  ownerUserId?: string
  fileIds?: Record<string, string>
}

export type CloudProviderInfo = {
  id: CloudProviderId
  label: string
  description: string
  setupUrl: string
  configured: boolean
}

const CONNECTIONS_KEY = 'noesis:cloud-connections:v1'

function env(name: string): string {
  return (import.meta.env[name] as string | undefined)?.trim() ?? ''
}

const configs: Record<CloudProviderId, { clientId: string; scopes: string; authUrl: string }> = {
  'google-drive': {
    clientId: env('VITE_GOOGLE_DRIVE_CLIENT_ID'),
    scopes: 'https://www.googleapis.com/auth/drive.file',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  },
  onedrive: {
    clientId: env('VITE_ONEDRIVE_CLIENT_ID'),
    scopes: 'Files.ReadWrite.AppFolder User.Read',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  },
  dropbox: {
    clientId: env('VITE_DROPBOX_APP_KEY'),
    scopes: 'files.content.write files.content.read files.metadata.read',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
  },
}

const providerDetails: Record<CloudProviderId, Omit<CloudProviderInfo, 'configured'>> = {
  'google-drive': {
    id: 'google-drive',
    label: 'Google Drive',
    description: 'Your Drive app folder',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  onedrive: {
    id: 'onedrive',
    label: 'OneDrive',
    description: 'Your OneDrive app folder',
    setupUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
  dropbox: {
    id: 'dropbox',
    label: 'Dropbox',
    description: 'Your Dropbox app folder',
    setupUrl: 'https://www.dropbox.com/developers/apps',
  },
}

export function listCloudProviders(): CloudProviderInfo[] {
  return (Object.keys(providerDetails) as CloudProviderId[]).map((id) => ({
    ...providerDetails[id],
    configured: Boolean(configs[id].clientId),
  }))
}

export function readCloudConnections(): CloudConnection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONNECTIONS_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CloudConnection => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return (
        typeof value.provider === 'string' &&
        typeof value.accessToken === 'string' &&
        typeof value.expiresAt === 'number'
      )
    })
  } catch {
    return []
  }
}

function writeCloudConnections(connections: CloudConnection[]): void {
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections))
}

export function disconnectCloudProvider(provider: CloudProviderId): CloudConnection[] {
  const next = readCloudConnections().filter((connection) => connection.provider !== provider)
  writeCloudConnections(next)
  return next
}

export function clearCloudConnections(): void {
  localStorage.removeItem(CONNECTIONS_KEY)
}

/**
 * Keep a provider connection available after logout so the same account can
 * restore its local book files when it signs back in. The connection is bound
 * to the account id before it is used; another account on the same browser
 * cannot accidentally sync against it.
 */
export function bindCloudConnectionsToUser(userId: string): CloudConnection[] {
  if (typeof window === 'undefined' || !userId) return []
  const current = readCloudConnections()
  let changed = false
  const next = current.map((connection) => {
    if (connection.ownerUserId || !connection.accessToken) return connection
    changed = true
    return { ...connection, ownerUserId: userId }
  })
  if (changed) writeCloudConnections(next)
  return next
}

export function cloudConnectionForUser(
  connections: CloudConnection[],
  userId: string | undefined,
): CloudConnection | undefined {
  if (!userId) return undefined
  return connections.find((connection) => connection.ownerUserId === userId)
}

const PROVIDER_IDS: CloudProviderId[] = ['google-drive', 'onedrive', 'dropbox']

// Microsoft rejects redirect URIs with query strings for apps that allow
// personal accounts, so every provider uses a clean path: /oauth/<provider>.
export function oauthRedirectPath(provider: CloudProviderId): string {
  return `/oauth/${provider}`
}

export function oauthProviderFromPath(pathname: string): CloudProviderId | null {
  const match = pathname.match(/^\/oauth\/([a-z-]+)\/?$/)
  return PROVIDER_IDS.find((id) => id === match?.[1]) ?? null
}

function redirectUri(provider: CloudProviderId): string {
  return `${window.location.origin}${oauthRedirectPath(provider)}`
}

function randomState(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function consumeCloudOAuthRedirect(): void {
  if (typeof window === 'undefined') return
  const query = new URLSearchParams(window.location.search)
  // The legacy ?noesis-oauth=1&provider=... form is still accepted so a
  // redirect URI registered earlier keeps working.
  const provider =
    oauthProviderFromPath(window.location.pathname) ??
    (query.has('noesis-oauth') ? (query.get('provider') as CloudProviderId | null) : null)
  if (!provider) return
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const error = hash.get('error') || query.get('error')
  if (!window.opener) {
    // Nothing to hand the token to (the popup lost its opener or the page was
    // opened directly). Drop it from the address bar instead of leaving it there.
    window.history.replaceState(null, '', '/')
    return
  }
  window.opener.postMessage(
    {
      type: 'noesis-cloud-oauth',
      state: hash.get('state') || query.get('state'),
      provider,
      accessToken: hash.get('access_token'),
      expiresIn: Number(hash.get('expires_in') || 3600),
      error,
    },
    window.location.origin,
  )
  window.close()
}

export async function connectCloudProvider(provider: CloudProviderId, ownerUserId?: string): Promise<CloudConnection> {
  if (typeof window === 'undefined') throw new Error('Cloud connections are only available in a browser.')
  const config = configs[provider]
  if (!config.clientId)
    throw new Error(
      `Add the ${providerDetails[provider].label} client ID/app key as a Cloudflare build variable first.`,
    )
  const state = randomState()
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'token',
    redirect_uri: redirectUri(provider),
    state,
    scope: config.scopes,
  })
  if (provider === 'google-drive') {
    params.set('access_type', 'online')
    params.set('include_granted_scopes', 'true')
  }
  const popup = window.open(
    `${config.authUrl}?${params.toString()}`,
    'noesis-cloud-auth',
    'popup=yes,width=520,height=700',
  )
  if (!popup) throw new Error('Your browser blocked the sign-in popup. Allow popups for Noesis and try again.')
  return new Promise<CloudConnection>((resolve, reject) => {
    let finished = false
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      window.clearTimeout(timeout)
    }
    const finish = (callback: () => void) => {
      if (finished) return
      finished = true
      cleanup()
      callback()
    }
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'noesis-cloud-oauth' ||
        event.data?.state !== state
      )
        return
      if (event.data.error || !event.data.accessToken) {
        finish(() => reject(new Error(event.data.error || 'Cloud provider authorization was cancelled.')))
        return
      }
      const connection: CloudConnection = {
        provider,
        accessToken: String(event.data.accessToken),
        expiresAt: Date.now() + Math.max(60, Number(event.data.expiresIn) || 3600) * 1000,
        connectedAt: new Date().toISOString(),
        ownerUserId,
      }
      const next = [...readCloudConnections().filter((item) => item.provider !== provider), connection]
      writeCloudConnections(next)
      finish(() => resolve(connection))
    }
    const timer = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new Error('Cloud provider authorization was cancelled.')))
    }, 500)
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Cloud provider authorization timed out.'))),
      5 * 60 * 1000,
    )
    window.addEventListener('message', onMessage)
  })
}

function requireToken(connection: CloudConnection): void {
  if (!connection.accessToken || connection.expiresAt <= Date.now() + 30_000)
    throw new Error('Your cloud connection has expired. Reconnect it from Cloud Backup.')
}

function cloudFileName(path: string): string {
  return `noesis-${path.replaceAll('/', '--')}`
}

async function googleFileId(connection: CloudConnection, path: string): Promise<string | null> {
  const known = connection.fileIds?.[path]
  if (known) return known
  const query = encodeURIComponent(`name = '${cloudFileName(path)}' and trashed = false`)
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1`,
    { headers: { authorization: `Bearer ${connection.accessToken}` } },
  )
  if (!response.ok) throw new Error(`Google Drive could not list Noesis files (${response.status}).`)
  const body = (await response.json()) as { files?: Array<{ id?: string }> }
  return body.files?.[0]?.id ?? null
}

async function googleWrite(connection: CloudConnection, path: string, data: Blob, contentType: string): Promise<void> {
  const metadata = JSON.stringify({ name: cloudFileName(path), mimeType: contentType })
  const existing = await googleFileId(connection, path)
  let response: Response
  if (existing) {
    response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing)}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${connection.accessToken}`, 'content-type': contentType },
        body: data,
      },
    )
  } else {
    const boundary = `noesis-${crypto.randomUUID()}`
    const body = new Blob(
      [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        data,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` },
    )
    response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
  }
  if (!response.ok) throw new Error(`Google Drive could not save ${path} (${response.status}).`)
}

async function googleRead(connection: CloudConnection, path: string): Promise<ArrayBuffer | null> {
  const id = await googleFileId(connection, path)
  if (!id) return null
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers: { authorization: `Bearer ${connection.accessToken}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Google Drive could not read ${path} (${response.status}).`)
  return response.arrayBuffer()
}

async function oneDriveRequest(connection: CloudConnection, path: string, init: RequestInit = {}): Promise<Response> {
  const filename = encodeURIComponent(cloudFileName(path))
  return fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${filename}:/content`, {
    ...init,
    headers: { authorization: `Bearer ${connection.accessToken}`, ...(init.headers ?? {}) },
  })
}

function dropboxPath(path: string): string {
  return `/Noesis/${cloudFileName(path)}`
}

export async function writeCloudFile(
  connection: CloudConnection,
  path: string,
  data: Blob,
  contentType: string,
): Promise<void> {
  requireToken(connection)
  if (connection.provider === 'google-drive') {
    await googleWrite(connection, path, data, contentType)
    return
  }
  if (connection.provider === 'onedrive') {
    const response = await oneDriveRequest(connection, path, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: data,
    })
    if (!response.ok) throw new Error(`OneDrive could not save ${path} (${response.status}).`)
    return
  }
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.accessToken}`,
      'content-type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath(path), mode: 'overwrite', autorename: false, mute: true }),
    },
    body: data,
  })
  if (!response.ok) throw new Error(`Dropbox could not save ${path} (${response.status}).`)
}

export async function readCloudFile(connection: CloudConnection, path: string): Promise<ArrayBuffer | null> {
  requireToken(connection)
  if (connection.provider === 'google-drive') return googleRead(connection, path)
  if (connection.provider === 'onedrive') {
    const response = await oneDriveRequest(connection, path)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`OneDrive could not read ${path} (${response.status}).`)
    return response.arrayBuffer()
  }
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath(path) }),
    },
  })
  if (response.status === 409) return null
  if (!response.ok) throw new Error(`Dropbox could not read ${path} (${response.status}).`)
  return response.arrayBuffer()
}
