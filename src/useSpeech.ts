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

/** How long a pause may last before we call the sentence finished. */
const SILENCE_MS = 4000
/** Hard ceiling, so a forgotten open mic can't listen forever. */
const MAX_MS = 60_000

/** Add ?micdebug to the URL to trace the recogniser in the console. */
const debug = (...args: unknown[]) => {
  if (typeof window !== 'undefined' && window.location.search.includes('micdebug')) {
    console.log('[mic]', ...args)
  }
}

/**
 * Wraps the browser's speech recognition. Chrome and Safari only — hence the
 * text input beside the mic in the UI, which is also what you want in a room
 * too loud to dictate into.
 *
 * `continuous` is on so a natural pause mid-sentence doesn't end the take,
 * which single-utterance mode does far too eagerly. What we deliberately do
 * NOT do is restart the recogniser when it ends: driving start() from onend
 * flaps the microphone and leaves it transcribing nothing at all. When the
 * browser says it's done, we take what we heard and submit it.
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
    try {
      recRef.current?.stop()
    } catch {
      // Already stopped; nothing to do.
    }
    setListening(false)

    const transcript = `${settledRef.current} ${liveRef.current}`.trim()
    setInterim('')
    debug('finish ->', JSON.stringify(transcript))
    if (transcript) onFinalRef.current(transcript)
  }, [])

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
      debug('result', { settled: settledRef.current, live })

      // Restart the clock on every word, so only a real pause ends the take.
      window.clearTimeout(silenceTimer.current)
      silenceTimer.current = window.setTimeout(finish, SILENCE_MS)
    }

    rec.onerror = (e) => {
      debug('error', e.error)
      if (e.error === 'not-allowed') setError('Microphone permission denied.')
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Mic error: ${e.error}`)
      // Whatever went wrong, don't leave the button stuck listening.
      finish()
    }

    // The browser deciding it's done is authoritative — submit, don't restart.
    rec.onend = () => {
      debug('end')
      finish()
    }

    recRef.current = rec
    rec.start()
    setListening(true)
    debug('start')
    capTimer.current = window.setTimeout(finish, MAX_MS)
  }, [finish])

  useEffect(
    () => () => {
      window.clearTimeout(silenceTimer.current)
      window.clearTimeout(capTimer.current)
      doneRef.current = true
      try {
        recRef.current?.stop()
      } catch {
        // Unmounting anyway.
      }
    },
    [],
  )

  // Pressing stop means "I'm done talking", so hand over what we heard.
  return { listening, interim, error, start, stop: finish }
}
