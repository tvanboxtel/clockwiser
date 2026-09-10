import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A small frog who lives in the bottom-right corner.
 *
 * He breathes, blinks, hops along the bottom of the page every so often, and
 * croaks when you poke him — and he is also the microphone: talking to him is
 * how you ask for a meeting or tell him how you like your week. Colours come
 * from the `--frog-*` variables in index.css so he re-skins with the theme,
 * and every animation is switched off under `prefers-reduced-motion`.
 */

const RIBBITS = ['ribbit', 'ribbit ribbit', 'brrp', 'croak', 'mrrp?']
const CHEERS = ['nice!', 'defragged 🎉', 'so much focus', 'ribbit yeah']
const BOOKED = ['booked!', 'got it 🎉', 'locked in', 'mine now']

/**
 * Somewhere for him to land, in viewport coordinates: `x` is where his middle
 * should end up, `y` where his feet should. `key` changes per request so the
 * same spot twice still triggers a leap.
 */
export interface Perch {
  x: number
  y: number
  key: number
}

/** How long he sits on a freshly booked meeting before hopping home. */
const PERCH_MS = 2800

/** How far left of home he is allowed to wander, in px. */
const ROAM = 220

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]

export function Frog({
  cheer = 0,
  perch = null,
  listening = false,
  heard = '',
  canHear = false,
  onTalk,
}: {
  cheer?: number
  perch?: Perch | null
  /** True while the recogniser is running, for the ripples and the ear bubble. */
  listening?: boolean
  /** Live transcript, shown in his bubble as you speak. */
  heard?: string
  /** False when the browser has no speech recognition — he's decorative then. */
  canHear?: boolean
  onTalk?: () => void
}) {
  // Bumping `hop` restarts the hop animation by remounting the animated node.
  const [hop, setHop] = useState(0)
  const [x, setX] = useState(0)
  const [lift, setLift] = useState(0)
  const [say, setSay] = useState<{ text: string; id: number } | null>(null)
  const calm = useRef(reducedMotion())
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // While he's sitting on a meeting, the idle wander leaves him alone.
  const perching = useRef(false)
  // Wandering off mid-sentence drags his speech bubble across the page, so he
  // sits still while he's listening.
  const hold = useRef(false)
  hold.current = listening
  // Mirrors the rendered transform. Effects read this instead of taking `x`
  // and `lift` as dependencies, which would re-run them on every hop and tear
  // down their timers.
  const posRef = useRef({ x: 0, lift: 0 })

  const speak = useCallback((text: string) => {
    setSay({ text, id: Date.now() })
  }, [])

  const place = useCallback((x: number, lift: number) => {
    posRef.current = { x, lift }
    setX(x)
    setLift(lift)
  }, [])

  const jump = useCallback(
    (drift: number) => {
      if (!calm.current) setHop((n) => n + 1)
      place(Math.min(0, Math.max(-ROAM, posRef.current.x + drift)), 0)
    },
    [place],
  )

  // Wander on his own, on a slightly irregular beat so he doesn't feel metronomic.
  useEffect(() => {
    if (calm.current) return
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (perching.current || hold.current) {
          schedule()
          return
        }
        // Turn around at the edges instead of pressing against them.
        const prev = posRef.current.x
        const away = prev < -ROAM + 60 ? 1 : prev > -60 ? -1 : Math.random() < 0.5 ? -1 : 1
        place(Math.min(0, Math.max(-ROAM, prev + away * (40 + Math.random() * 50))), 0)
        setHop((n) => n + 1)
        schedule()
      }, 6000 + Math.random() * 6000)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [place])

  // Celebrate an optimize run: a hop back towards home and a little cheer.
  const seen = useRef(cheer)
  useEffect(() => {
    if (cheer === seen.current) return
    seen.current = cheer
    jump(70)
    speak(pick(CHEERS))
  }, [cheer, jump, speak])

  // Come back to his spot when you start talking: mid-wander his transcript
  // bubble opens to the left and would run off the edge of the page.
  const wasListening = useRef(listening)
  useEffect(() => {
    if (listening === wasListening.current) return
    wasListening.current = listening
    if (listening && !perching.current && posRef.current.x !== 0) jump(-posRef.current.x)
  }, [listening, jump])

  // Leap onto a newly booked meeting, sit on it a moment, then hop home.
  const seenPerch = useRef(0)
  useEffect(() => {
    if (!perch || perch.key === seenPerch.current) return
    seenPerch.current = perch.key
    const wrap = wrapRef.current
    if (!wrap) return

    speak(pick(BOOKED))
    if (calm.current) return

    // The current transform is already baked into the rect, so subtract it to
    // recover where he sits untranslated.
    const r = wrap.getBoundingClientRect()
    const { x, lift } = posRef.current
    const homeX = r.left + r.width / 2 - x
    const homeFeet = r.bottom - lift

    perching.current = true
    place(perch.x - homeX, perch.y - homeFeet)
    setHop((n) => n + 1)

    const home = window.setTimeout(() => {
      perching.current = false
      place(0, 0)
      setHop((n) => n + 1)
    }, PERCH_MS)
    return () => window.clearTimeout(home)
  }, [perch, place, speak])

  return (
    <div
      ref={wrapRef}
      className={`frog-wrap${listening ? ' frog-wrap-listening' : ''}`}
      style={{ transform: `translate(${x}px, ${lift}px)` }}
    >
      {/* Listening beats a one-off croak: the live transcript replaces it. */}
      {listening ? (
        <span className="frog-hear" aria-live="polite">
          {heard || 'listening…'}
        </span>
      ) : (
        say && (
          <span key={say.id} className="frog-say" onAnimationEnd={() => setSay(null)}>
            {say.text}
          </span>
        )
      )}
      {listening && <span className="frog-ripple" aria-hidden />}
      <button
        type="button"
        className="frog"
        aria-label={
          !canHear
            ? 'A frog. Speech input needs Chrome — type your request instead.'
            : listening
              ? 'Stop listening'
              : 'Talk to the frog'
        }
        aria-pressed={canHear ? listening : undefined}
        title={
          !canHear
            ? 'Speech input needs Chrome — type it instead'
            : listening
              ? 'Listening… click when you\u2019re done'
              : 'Talk to me — ask for a meeting, or tell me how you like your week'
        }
        onClick={() => {
          // Poking a frog who can't hear you should still get you a ribbit.
          if (canHear && onTalk) {
            onTalk()
            return
          }
          jump(Math.random() < 0.5 ? -55 : 55)
          speak(pick(RIBBITS))
        }}
      >
        <span key={hop} className="frog-hopper">
          <FrogSvg />
        </span>
      </button>
    </div>
  )
}

/** Also used at twice the size on the onboarding screen. */
export function FrogSvg() {
  return (
    <svg width="56" height="50" viewBox="0 0 64 56" fill="none" aria-hidden>
      {/* back feet, planted */}
      <ellipse cx="15" cy="50" rx="9" ry="4" fill="var(--frog-body-dark)" />
      <ellipse cx="49" cy="50" rx="9" ry="4" fill="var(--frog-body-dark)" />

      <g className="frog-breathe">
        {/* body */}
        <ellipse cx="32" cy="35" rx="22" ry="17" fill="var(--frog-body)" />
        <ellipse cx="32" cy="41" rx="14" ry="9" fill="var(--frog-belly)" />

        {/* eye bumps */}
        <circle cx="20" cy="18" r="9.5" fill="var(--frog-body)" />
        <circle cx="44" cy="18" r="9.5" fill="var(--frog-body)" />

        {/* eyes */}
        <circle cx="20" cy="18" r="6" fill="var(--frog-eye-white)" />
        <circle cx="44" cy="18" r="6" fill="var(--frog-eye-white)" />
        <circle cx="21.5" cy="18.5" r="3" fill="var(--frog-eye)" />
        <circle cx="45.5" cy="18.5" r="3" fill="var(--frog-eye)" />
        <circle cx="20" cy="16.5" r="1.1" fill="var(--frog-eye-white)" />
        <circle cx="44" cy="16.5" r="1.1" fill="var(--frog-eye-white)" />

        {/* eyelids — scaled flat until a blink */}
        <circle className="frog-lid" cx="20" cy="18" r="6.4" fill="var(--frog-body)" />
        <circle className="frog-lid frog-lid-b" cx="44" cy="18" r="6.4" fill="var(--frog-body)" />

        {/* cheeks + a smug little smile */}
        <ellipse cx="15" cy="34" rx="3.5" ry="2.5" fill="var(--frog-cheek)" />
        <ellipse cx="49" cy="34" rx="3.5" ry="2.5" fill="var(--frog-cheek)" />
        <path
          d="M23 31q9 7 18 0"
          stroke="var(--frog-line)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* front toes */}
        <ellipse cx="25" cy="50" rx="6" ry="3.5" fill="var(--frog-body)" />
        <ellipse cx="39" cy="50" rx="6" ry="3.5" fill="var(--frog-body)" />
      </g>
    </svg>
  )
}
