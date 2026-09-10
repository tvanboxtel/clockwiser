import { useCallback, useEffect, useRef, useState } from 'react'

/** Minimal shape of the bits of the Web Speech API we touch. */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

const getCtor = (): (new () => SpeechRecognitionLike) | undefined => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined
}

export const speechSupported = () => typeof window !== 'undefined' && !!getCtor()

/**
 * Wraps the browser's speech recognition. Chrome and Safari only — hence the
 * text input beside the mic in the UI, which is also what you want in a room
 * too loud to dictate into.
 */
export const useSpeech = (onFinal: (transcript: string) => void) => {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Keep the latest callback without restarting recognition on every render.
  const onFinalRef = useRef(onFinal)
  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  const stop = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      setError('This browser has no speech recognition — type it instead.')
      return
    }
    setError(null)
    setInterim('')

    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = true

    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          setInterim('')
          onFinalRef.current(text.trim())
          return
        }
        live += text
      }
      setInterim(live)
    }
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Mic error: ${e.error}`)
      setListening(false)
    }
    rec.onend = () => setListening(false)

    recRef.current = rec
    rec.start()
    setListening(true)
  }, [])

  useEffect(() => () => recRef.current?.stop(), [])

  return { listening, interim, error, start, stop }
}
