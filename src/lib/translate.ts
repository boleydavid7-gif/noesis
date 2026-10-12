// Translating a selected passage on the device itself (Chrome's built-in Translator and Language Detector):
// nothing is sent anywhere. Offered only where the browser has them.

type Detector = { detect: (text: string) => Promise<Array<{ detectedLanguage: string; confidence: number }>> }
type Translator = { translate: (text: string) => Promise<string> }
type Api = {
  LanguageDetector?: { create: () => Promise<Detector> }
  Translator?: {
    availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
    create: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<Translator>
  }
}

const api = () => globalThis as unknown as Api

export const translateHere = () => Boolean(api().Translator && api().LanguageDetector)

export const myLanguage = () =>
  typeof navigator === 'undefined' ? 'en' : (navigator.language || 'en').split('-')[0].toLowerCase()

export const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export type Translation = { from: string; to: string; text: string } | { same: true } | { unavailable: true }

/** The passage in the reader's own language, or why not. */
export async function translatePassage(text: string): Promise<Translation> {
  const { LanguageDetector, Translator } = api()
  if (!LanguageDetector || !Translator) return { unavailable: true }
  const [best] = await (await LanguageDetector.create()).detect(text)
  const from = best?.detectedLanguage?.split('-')[0]
  const to = myLanguage()
  if (!from || from === 'und') return { unavailable: true }
  if (from === to) return { same: true }
  if ((await Translator.availability({ sourceLanguage: from, targetLanguage: to })) === 'unavailable')
    return { unavailable: true }
  const translator = await Translator.create({ sourceLanguage: from, targetLanguage: to })
  return { from, to, text: await translator.translate(text) }
}
