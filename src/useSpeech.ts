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

/** How long a pause may last before we decide the sentence is finished. */
const SILENCE_MS = 3000
/** Longer grace at the start — thinking about what to say takes a moment. */
const FIRST_SILENCE_MS = 10_000
/** Hard ceiling, so a forgotten open mic can't listen forever. */
const MAX_MS = 60_000

/**
 * Wraps the browser's speech recognition. Chrome and Safari only — hence the
 * text input beside the mic in the UI, which is also what you want in a room
 * too loud to dictate into.
 *
 * Runs in continuous mode and decides for itself when you've stopped talking,
 * because the default single-utterance mode ends at the first natural pause —
 * far too eager for a sentence like "half an hour with Sofia and Marc… before
 * Wednesday". Chrome also ends the session on its own periodically, so we
 * restart it underneath and only surface a result once you actually stop.
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

  // Phrases the browser has committed, plus whatever it's still guessing at.
  const settledRef = useRef('')
  const liveRef = useRef('')
  // Set once we've handed a transcript over, so a late onend can't fire twice.
  const doneRef = useRef(false)
  const silenceTimer = useRef(0)
  const capTimer = useRef(0)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    window.clearTimeout(silenceTimer.current)
    window.clearTimeout(capTimer.current)
    recRef.current?.stop()
    setListening(false)

    const transcript = `${settledRef.current} ${liveRef.current}`.trim()
    setInterim('')
    if (transcript) onFinalRef.current(transcript)
  }, [])

  const armSilence = useCallback(
    (ms: number) => {
      window.clearTimeout(silenceTimer.current)
      silenceTimer.current = window.setTimeout(finish, ms)
    },
    [finish],
  )

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      setError('This browser has no speech recognition — type it instead.')
      return
    }
    setError(null)
    setInterim('')
    settledRef.current = ''
    liveRef.current = ''
    doneRef.current = false

    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const text = result[0].transcript
        if (result.isFinal) settledRef.current += `${text} `
        else live += text
      }
      liveRef.current = live
      setInterim(`${settledRef.current}${live}`.trim())
      armSilence(SILENCE_MS)
    }

    rec.onerror = (e) => {
      // A silent stretch isn't a failure here — the silence timer owns that call.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Mic error: ${e.error}`)
      finish()
    }

    // Chrome ends a session on its own every so often. Unless we're done,
    // pick it straight back up so a long sentence survives.
    rec.onend = () => {
      if (doneRef.current) return
      try {
        rec.start()
      } catch {
        finish()
      }
    }

    recRef.current = rec
    rec.start()
    setListening(true)
    armSilence(FIRST_SILENCE_MS)
    capTimer.current = window.setTimeout(finish, MAX_MS)
  }, [armSilence, finish])

  useEffect(
    () => () => {
      window.clearTimeout(silenceTimer.current)
      window.clearTimeout(capTimer.current)
      doneRef.current = true
      recRef.current?.stop()
    },
    [],
  )

  // Pressing stop means "I'm done talking", so hand over what we heard.
  return { listening, interim, error, start, stop: finish }
}
