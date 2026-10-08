// Background sound made in the browser, so there are no audio files to download.

export type AmbientKind = 'rain' | 'fire' | 'wind' | 'room'
export const AMBIENT_OPTIONS: Array<{ id: AmbientKind; label: string }> = [
  { id: 'rain', label: 'Rain' },
  { id: 'fire', label: 'Fireplace' },
  { id: 'wind', label: 'Wind' },
  { id: 'room', label: 'Quiet room' },
]

const KEY = 'noesis:ambient:v1'
export function readAmbient(): { kind: AmbientKind | null; volume: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { kind?: string; volume?: number } | null
    const kind = AMBIENT_OPTIONS.some((item) => item.id === parsed?.kind) ? (parsed?.kind as AmbientKind) : null
    const volume = typeof parsed?.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.4
    return { kind, volume }
  } catch {
    return { kind: null, volume: 0.4 }
  }
}
export function writeAmbient(value: { kind: AmbientKind | null; volume: number }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // The choice just isn't remembered.
  }
}

export type AmbientPlayer = { setVolume: (volume: number) => void; stop: () => void }

function noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  const length = ctx.sampleRate * 4
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1
    if (kind === 'white') data[i] = white
    else {
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
  }
  return buffer
}

export const canPlayAmbient = () => typeof window !== 'undefined' && 'AudioContext' in window

export function startAmbient(kind: AmbientKind, volume: number): AmbientPlayer {
  const ctx = new AudioContext()
  const master = ctx.createGain()
  master.gain.value = volume * 0.5
  master.connect(ctx.destination)
  const stops: Array<() => void> = []

  const loop = (type: 'white' | 'brown') => {
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx, type)
    source.loop = true
    source.start()
    stops.push(() => source.stop())
    return source
  }

  if (kind === 'rain') {
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 3200
    filter.Q.value = 0.5
    loop('white').connect(filter).connect(master)
  } else if (kind === 'wind') {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 500
    const sweep = ctx.createOscillator()
    const depth = ctx.createGain()
    sweep.frequency.value = 0.12
    depth.gain.value = 320
    sweep.connect(depth).connect(filter.frequency)
    sweep.start()
    stops.push(() => sweep.stop())
    loop('brown').connect(filter).connect(master)
  } else if (kind === 'room') {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 180
    const quiet = ctx.createGain()
    quiet.gain.value = 0.6
    loop('brown').connect(filter).connect(quiet).connect(master)
  } else {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    loop('brown').connect(filter).connect(master)
    // Now and then a short, bright crackle.
    const crackle = window.setInterval(() => {
      if (Math.random() < 0.35) return
      const burst = ctx.createBufferSource()
      burst.buffer = noiseBuffer(ctx, 'white')
      const gain = ctx.createGain()
      const high = ctx.createBiquadFilter()
      high.type = 'highpass'
      high.frequency.value = 1800 + Math.random() * 2000
      const now = ctx.currentTime
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.3, now + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03 + Math.random() * 0.05)
      burst.connect(high).connect(gain).connect(master)
      burst.start(now)
      burst.stop(now + 0.1)
    }, 140)
    stops.push(() => window.clearInterval(crackle))
  }

  return {
    setVolume: (next) => {
      master.gain.value = Math.max(0, Math.min(1, next)) * 0.5
    },
    stop: () => {
      for (const stop of stops) {
        try {
          stop()
        } catch {
          // Already stopped.
        }
      }
      void ctx.close()
    },
  }
}
