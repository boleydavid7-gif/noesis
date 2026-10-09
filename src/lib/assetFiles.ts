// The person's own font and pictures: copied to their account and to the Noesis folder of each connected
// cloud, and fetched from there on a device that does not have them.

import { downloadAccountAsset, uploadAccountAsset } from './accountLibrary'
import { readCloudConnections, readCloudFile, writeCloudFile } from './cloudProviders'
import { loadEpubFile, saveEpubFile } from './library'

const FONT_FILE = 'font:custom'
const FONT_ASSET = 'font.bin'
const MARK = 'noesis:assets-uploaded'

function marks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MARK) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function setMark(name: string, value: string) {
  try {
    localStorage.setItem(MARK, JSON.stringify({ ...marks(), [name]: value }))
  } catch {
    // Without the note the file is simply sent again next time.
  }
}

function fingerprint(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return `${text.length}:${hash}`
}

async function toClouds(path: string, bytes: ArrayBuffer, contentType: string) {
  for (const connection of readCloudConnections()) {
    try {
      await writeCloudFile(connection, path, new Blob([bytes], { type: contentType }), contentType)
    } catch {
      // An expired cloud is skipped; the account copy is the one the app relies on.
    }
  }
}

/** The font file from the account or a connected cloud, kept on this device for next time. */
export async function fetchFont(): Promise<ArrayBuffer | null> {
  let bytes: ArrayBuffer | null = null
  try {
    bytes = await downloadAccountAsset(FONT_ASSET)
  } catch {
    bytes = null
  }
  if (!bytes) {
    for (const connection of readCloudConnections()) {
      try {
        bytes = await readCloudFile(connection, `assets/${FONT_ASSET}`)
        if (bytes) break
      } catch {
        // Try the next cloud.
      }
    }
  }
  if (bytes) await saveEpubFile(FONT_FILE, bytes).catch(() => undefined)
  return bytes
}

/** Sends the font and any uploaded pictures to the account and the connected clouds, once each. */
export async function backUpAssets(): Promise<void> {
  const done = marks()
  const fontMeta = localStorage.getItem('noesis:font:v1')
  if (fontMeta) {
    const font = await loadEpubFile(FONT_FILE).catch(() => null)
    if (font && done.font !== String(font.byteLength)) {
      if (await uploadAccountAsset(FONT_ASSET, font, 'application/octet-stream')) {
        await toClouds(`assets/${FONT_ASSET}`, font, 'application/octet-stream')
        setMark('font', String(font.byteLength))
      }
    }
  }
  // Uploaded pictures travel inside the preferences; this also leaves a plain image file in each cloud's folder.
  try {
    const images = JSON.parse(localStorage.getItem('noesis:images:v1') ?? '{}') as Record<string, unknown>
    for (const slot of ['banner', 'sidebar']) {
      const value = images[slot]
      if (typeof value !== 'string' || !value.startsWith('data:image/')) continue
      const print = fingerprint(value)
      if (done[`image-${slot}`] === print) continue
      const bytes = await (await fetch(value)).arrayBuffer()
      await toClouds(`assets/image-${slot}.jpg`, bytes, 'image/jpeg')
      setMark(`image-${slot}`, print)
    }
  } catch {
    // Pictures are a convenience.
  }
}
