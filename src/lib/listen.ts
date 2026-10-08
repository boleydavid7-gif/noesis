// Read-aloud with the browser's own voice. Nothing is sent anywhere.

import { wordAt } from './wordRange'

// Browsers cut off long utterances, so text is read in short pieces at sentence ends.
export function splitSpeech(text: string, max = 220): string[] {
  const sentences =
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[^.!?…]+(?:[.!?…]+["”’')\]]*|$)\s*/g) ?? []
  const pieces: string[] = []
  let current = ''
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    if (current && current.length + sentence.length + 1 > max) {
      pieces.push(current)
      current = ''
    }
    if (sentence.length > max) {
      // A very long sentence is cut at spaces.
      for (let rest = sentence; rest.length > 0;) {
        const cut = rest.length <= max ? rest.length : Math.max(rest.lastIndexOf(' ', max), 1)
        pieces.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      continue
    }
    current = current ? `${current} ${sentence}` : sentence
  }
  if (current) pieces.push(current)
  return pieces
}

export type ListenBlock = { text: string; element?: Element }
export type ListenController = { pause: () => void; resume: () => void; stop: () => void }

export const canListen = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// Reads each block in turn, telling the caller which one is being read.
export function startListening(
  blocks: ListenBlock[],
  options: {
    rate: number
    onBlock?: (block: ListenBlock) => void
    onWord?: (block: ListenBlock, start: number, end: number) => void
    onDone?: () => void
  },
): ListenController {
  const synth = window.speechSynthesis
  let stopped = false
  let index = 0
  synth.cancel()

  const speakBlock = () => {
    if (stopped) return
    const block = blocks[index]
    if (!block) {
      options.onDone?.()
      return
    }
    options.onBlock?.(block)
    const pieces = splitSpeech(block.text)
    const flat = block.text.replace(/\s+/g, ' ').trim()
    let searchFrom = 0
    let piece = 0
    const nextPiece = () => {
      if (stopped) return
      if (piece >= pieces.length) {
        index += 1
        speakBlock()
        return
      }
      const utterance = new SpeechSynthesisUtterance(pieces[piece])
      const pieceStart = Math.max(0, flat.indexOf(pieces[piece], searchFrom))
      searchFrom = pieceStart + pieces[piece].length
      utterance.rate = options.rate
      // Browsers that report each spoken word let the page mark it.
      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return
        const from = pieceStart + event.charIndex
        const word = wordAt(flat, from)
        options.onWord?.(block, word.start, word.end)
      }
      utterance.onend = () => {
        piece += 1
        nextPiece()
      }
      utterance.onerror = (event) => {
        if (event.error === 'canceled' || event.error === 'interrupted') return
        piece += 1
        nextPiece()
      }
      synth.speak(utterance)
    }
    nextPiece()
  }
  speakBlock()

  return {
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    stop: () => {
      stopped = true
      synth.cancel()
    },
  }
}
