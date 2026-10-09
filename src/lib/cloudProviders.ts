export type CloudProviderId = 'google-drive' | 'onedrive' | 'dropbox'

export type CloudConnection = {
  provider: CloudProviderId
  accessToken: string
  expiresAt: number
  /** Lets the connection renew itself when the hour-long access token ends. */
  refreshToken?: string
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

const configs: Record<
  CloudProviderId,
  { clientId: string; scopes: string; authUrl: string; tokenUrl: string }
> = {
  'google-drive': {
    clientId: env('VITE_GOOGLE_DRIVE_CLIENT_ID'),
    scopes: 'https://www.googleapis.com/auth/drive.file',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
  onedrive: {
    clientId: env('VITE_ONEDRIVE_CLIENT_ID'),
    scopes: 'Files.ReadWrite.AppFolder User.Read offline_access',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
  dropbox: {
    clientId: env('VITE_DROPBOX_APP_KEY'),
    scopes: 'files.content.write files.content.read files.metadata.read',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  },
}

/**
 * Google only hands out renewable access to a server holding the client secret,
 * so its renewal runs through the Worker, and only when that secret is set there.
 */
let googleRenews = false

/**
 * Cloudflare can expose these public OAuth identifiers at runtime. This keeps
 * provider setup working when a host does not pass VITE_* values into the
 * Vite build environment. Build-time values still work as a fallback.
 */
export async function loadCloudProviderConfig(): Promise<CloudProviderInfo[]> {
  if (typeof window === 'undefined') return listCloudProviders()
  try {
    const response = await fetch('/api/config', { cache: 'no-store' })
    if (response.ok) {
      const body = (await response.json()) as {
        googleRenews?: unknown
        googleDriveClientId?: unknown
        oneDriveClientId?: unknown
        dropboxAppKey?: unknown
      }
      const runtimeValues: Record<CloudProviderId, unknown> = {
        'google-drive': body.googleDriveClientId,
        onedrive: body.oneDriveClientId,
        dropbox: body.dropboxAppKey,
      }
      googleRenews = body.googleRenews === true
      for (const id of Object.keys(configs) as CloudProviderId[]) {
        const value = runtimeValues[id]
        if (typeof value === 'string' && value.trim()) configs[id].clientId = value.trim()
      }
    }
  } catch {
    // The build-time configuration remains usable when runtime config is unavailable.
  }
  return listCloudProviders()
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
      code: query.get('code'),
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
      `Add the ${providerDetails[provider].label} client ID/app key as a Cloudflare build or Worker variable first.`,
    )
  const state = randomState()
  const renewable = canRenew(provider)
  const verifier = randomState() + randomState()
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: renewable ? 'code' : 'token',
    redirect_uri: redirectUri(provider),
    state,
    scope: provider === 'onedrive' && !renewable ? config.scopes.replace(' offline_access', '') : config.scopes,
  })
  if (renewable) {
    params.set('code_challenge', await challengeFor(verifier))
    params.set('code_challenge_method', 'S256')
    if (provider === 'dropbox') params.set('token_access_type', 'offline')
  }
  if (provider === 'google-drive') {
    params.set('access_type', renewable ? 'offline' : 'online')
    if (renewable) params.set('prompt', 'consent')
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
    const keep = (connection: CloudConnection) => {
      const next = [...readCloudConnections().filter((item) => item.provider !== provider), connection]
      writeCloudConnections(next)
      finish(() => resolve(connection))
    }
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'noesis-cloud-oauth' ||
        event.data?.state !== state
      )
        return
      if (event.data.error || !(event.data.accessToken || event.data.code)) {
        finish(() => reject(new Error(event.data.error || 'Cloud provider authorization was cancelled.')))
        return
      }
      if (event.data.code) {
        window.removeEventListener('message', onMessage)
        void exchangeCode(provider, String(event.data.code), verifier).then(
          (tokens) => {
            rememberRenewalWorked(provider)
            keep({
              provider,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: Date.now() + tokens.expiresIn * 1000,
              connectedAt: new Date().toISOString(),
              ownerUserId,
            })
          },
          () => {
            // Next time connects the one-hour way, which always works.
            rememberRenewalBroke(provider)
            finish(() =>
              reject(
                new Error(
                  `${providerDetails[provider].label} could not set up automatic renewal. Try connecting again.`,
                ),
              ),
            )
          },
        )
        return
      }
      keep({
        provider,
        accessToken: String(event.data.accessToken),
        expiresAt: Date.now() + Math.max(60, Number(event.data.expiresIn) || 3600) * 1000,
        connectedAt: new Date().toISOString(),
        ownerUserId,
      })
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

const BROKE_KEY = 'noesis:cloud-renewal-broke:v1'

function renewalBroke(provider: CloudProviderId): boolean {
  try {
    return (JSON.parse(localStorage.getItem(BROKE_KEY) ?? '[]') as string[]).includes(provider)
  } catch {
    return false
  }
}

function rememberRenewalBroke(provider: CloudProviderId): void {
  try {
    const now = new Set(JSON.parse(localStorage.getItem(BROKE_KEY) ?? '[]') as string[])
    now.add(provider)
    localStorage.setItem(BROKE_KEY, JSON.stringify([...now]))
  } catch {
    // Nothing to remember it with; the renewing way is tried again.
  }
}

function rememberRenewalWorked(provider: CloudProviderId): void {
  try {
    const now = new Set(JSON.parse(localStorage.getItem(BROKE_KEY) ?? '[]') as string[])
    now.delete(provider)
    localStorage.setItem(BROKE_KEY, JSON.stringify([...now]))
  } catch {
    // Same as above.
  }
}

function canRenew(provider: CloudProviderId): boolean {
  if (renewalBroke(provider)) return false
  return provider !== 'google-drive' || googleRenews
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let text = ''
  for (const byte of new Uint8Array(digest)) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

type Tokens = { accessToken: string; refreshToken?: string; expiresIn: number }

async function tokenRequest(provider: CloudProviderId, fields: Record<string, string>): Promise<Tokens> {
  const config = configs[provider]
  // Google's token call needs the client secret, which only the Worker holds.
  const response =
    provider === 'google-drive'
      ? await fetch('/api/cloud-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider, ...fields }),
        })
      : await fetch(config.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, ...fields }),
        })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const accessToken = (body.access_token ?? body.accessToken) as string | undefined
  if (!response.ok || !accessToken) {
    const error = new Error(String(body.error ?? `Token request failed (${response.status}).`))
    ;(error as Error & { rejected?: boolean }).rejected = response.status >= 400 && response.status < 500
    throw error
  }
  const refreshToken = (body.refresh_token ?? body.refreshToken) as string | undefined
  return {
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresIn: Math.max(60, Number(body.expires_in ?? body.expiresIn) || 3600),
  }
}

function exchangeCode(provider: CloudProviderId, code: string, verifier: string): Promise<Tokens> {
  return tokenRequest(provider, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(provider),
  })
}

/** True when the connection is good now, or can renew itself without the person doing anything. */
export function cloudConnectionUsable(connection: CloudConnection): boolean {
  return Boolean(connection.accessToken) && (connection.expiresAt > Date.now() + 30_000 || Boolean(connection.refreshToken))
}

const renewing = new Map<string, Promise<CloudConnection>>()

/** The connection with a working access token, renewed and kept if the old one ended. */
export async function freshCloudConnection(connection: CloudConnection): Promise<CloudConnection> {
  const stored = readCloudConnections().find(
    (item) => item.provider === connection.provider && item.ownerUserId === connection.ownerUserId,
  )
  const current = stored && stored.expiresAt >= connection.expiresAt ? stored : connection
  if (current.accessToken && current.expiresAt > Date.now() + 30_000) return current
  if (!current.refreshToken) throw new Error('Your cloud connection has expired. Reconnect it from Cloud Backup.')
  const running = renewing.get(current.provider)
  if (running) return running
  const job = (async () => {
    try {
      const tokens = await tokenRequest(current.provider, {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken as string,
      })
      const next: CloudConnection = {
        ...current,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? current.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
      }
      writeCloudConnections(
        readCloudConnections().map((item) =>
          item.provider === next.provider && item.ownerUserId === next.ownerUserId ? next : item,
        ),
      )
      return next
    } catch (reason) {
      // Only a refusal ends the renewal; a network hiccup leaves it to try again later.
      if ((reason as { rejected?: boolean }).rejected) {
        writeCloudConnections(
          readCloudConnections().map((item) =>
            item.provider === current.provider && item.ownerUserId === current.ownerUserId
              ? { ...item, refreshToken: undefined }
              : item,
          ),
        )
        throw new Error('Your cloud connection has expired. Reconnect it from Cloud Backup.')
      }
      throw new Error('Could not reach your cloud to renew the connection. It will try again.')
    } finally {
      renewing.delete(current.provider)
    }
  })()
  renewing.set(current.provider, job)
  return job
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

const googleFolders = new Map<string, string>()

/** The visible "Noesis" folder in the person's Drive, created on first use. */
async function googleFolderId(connection: CloudConnection): Promise<string> {
  const known = googleFolders.get(connection.accessToken)
  if (known) return known
  const query = encodeURIComponent(
    `name = 'Noesis' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`,
  )
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id)&pageSize=1`,
    { headers: { authorization: `Bearer ${connection.accessToken}` } },
  )
  if (found.ok) {
    const id = ((await found.json()) as { files?: Array<{ id?: string }> }).files?.[0]?.id
    if (id) {
      googleFolders.set(connection.accessToken, id)
      return id
    }
  }
  const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Noesis', mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!created.ok) throw new Error(`Google Drive could not create the Noesis folder (${created.status}).`)
  const id = ((await created.json()) as { id?: string }).id
  if (!id) throw new Error('Google Drive could not create the Noesis folder.')
  googleFolders.set(connection.accessToken, id)
  return id
}

async function googleWrite(connection: CloudConnection, path: string, data: Blob, contentType: string): Promise<void> {
  const folder = await googleFolderId(connection)
  const metadata = JSON.stringify({ name: cloudFileName(path), mimeType: contentType, parents: [folder] })
  const existing = await googleFileId(connection, path)
  let response: Response
  if (existing) {
    // A file saved by an older version is updated where it is; new files go in the Noesis folder.
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
  connection = await freshCloudConnection(connection)
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
  connection = await freshCloudConnection(connection)
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
