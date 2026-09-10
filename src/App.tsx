import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDemoWeek } from './data'
import {
  gapsForDay,
  measure,
  optimize,
  proposeSlots,
  type Metrics,
  type OptimizeResult,
  type SlotProposal,
} from './optimizer'
import {
  applyTune,
  describeTune,
  parseIntentLocally,
  toMeetingRequest,
  type ParsedIntent,
  type ParsedRequest,
} from './intent'
import { speechSupported, useSpeech } from './useSpeech'
import { Onboarding } from './Onboarding'
import { PrefsGrid } from './PrefsQuestions'
import { THEMES, useTheme, type ThemeId } from './theme'
import { Frog, type Perch } from './Frog'
import {
  DEFAULT_PREFS,
  HORIZON,
  PEOPLE,
  TEAMMATES,
  daysInWeek,
  fmt,
  fmtDuration,
  type CalEvent,
  type PersonId,
  type Prefs,
} from './types'

const HOUR_PX = 68
const y = (min: number, prefs: Prefs) => ((min - prefs.dayStart) / 60) * HOUR_PX

/** Colour lives in index.css (`.ev-*`) so it can change per theme. */
const KIND_STYLE: Record<string, string> = {
  external: 'ev ev-external',
  internal: 'ev ev-internal',
  oneonone: 'ev ev-oneonone',
  focus: 'ev ev-focus',
  personal: 'ev ev-personal',
}

/** Short labels, real sentences — the box takes bookings and preferences. */
const EXAMPLES = [
  { chip: '30 min with Sofia', say: 'I need 30 minutes with Sofia in the morning sometime in the next two weeks' },
  { chip: 'An hour with Marc & Lena', say: 'Book an hour with Marc and Lena next week, afternoons only' },
  { chip: 'Breaks after long meetings', say: 'I want some breaks after my long meetings, help me optimize my calendar for that' },
  { chip: 'Protect my mornings', say: 'Protect my mornings and get me finished by 5' },
]

/**
 * Preferences are answered once at onboarding and remembered, so the demo
 * doesn't interrogate you on every reload.
 */
const PREFS_KEY = 'clockwiser:prefs'

const loadPrefs = (): { prefs: Prefs; onboarded: boolean } => {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { prefs: DEFAULT_PREFS, onboarded: false }
    // Merge over the defaults so a preference added later doesn't arrive undefined.
    return { prefs: { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }, onboarded: true }
  } catch {
    return { prefs: DEFAULT_PREFS, onboarded: false }
  }
}

/** Tweens a number so the headline stat visibly climbs when you optimize. */
function useTween(value: number, ms = 700) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(a + (value - a) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

function ThemeIcon({ theme }: { theme: ThemeId }) {
  const common = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (theme === 'dark') return <svg {...common}><path d="M20.8 13.2A8.5 8.5 0 1 1 10.8 3.2a6.6 6.6 0 0 0 10 10z" /></svg>
  if (theme === 'light')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    )
  return (
    <svg {...common}>
      <path d="M11 3.5l1.5 3.9L16.4 9l-3.9 1.6L11 14.4 9.4 10.6 5.5 9l3.9-1.6z" />
      <path d="M17.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  )
}

function ThemeSwitch({ theme, setTheme }: { theme: ThemeId; setTheme: (t: ThemeId) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-panel-soft p-1" role="group" aria-label="Colour theme">
      {THEMES.map((t) => {
        const active = theme === t.id
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            title={`${t.label} theme`}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover hover:text-body'
            }`}
          >
            <ThemeIcon theme={t.id} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function Stat({ label, value, delta, good }: { label: string; value: string; delta?: number; good?: 'up' | 'down' }) {
  const sign = delta === undefined || delta === 0 ? null : delta > 0 ? '+' : '−'
  const improved = delta === undefined || delta === 0 ? null : good === 'up' ? delta > 0 : delta < 0
  return (
    <div className="rounded-xl border border-line bg-panel-soft px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-fg">{value}</span>
        {sign && (
          <span className={`text-xs font-semibold tabular-nums ${improved ? 'text-good' : 'text-bad'}`}>
            {sign}
            {Math.abs(delta!)}
          </span>
        )}
      </div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-hover px-2 py-0.5 text-[11px] text-body">{children}</span>
}

/**
 * The same questions the onboarding asks, reachable forever after. A popover
 * rather than a panel in the flow: preferences are occasional, and the main
 * screen has enough on it.
 */
function PrefsPopover({
  prefs,
  setPrefs,
  onRun,
  onReset,
  onClose,
  running,
}: {
  prefs: Prefs
  setPrefs: (p: Prefs) => void
  onRun: () => void
  onReset: () => void
  onClose: () => void
  running: boolean
}) {
  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,34rem)] rounded-2xl border border-line bg-panel p-5 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.35)]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">How you like your week</h2>
          <p className="mt-0.5 text-[11px] text-muted">Hard constraints, not hints. Change one and the plan changes.</p>
        </div>
        <button onClick={onClose} className="text-xs text-subtle transition hover:text-body">
          Close
        </button>
      </div>

      <div className="mt-4">
        <PrefsGrid prefs={prefs} setPrefs={setPrefs} />
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <button onClick={onReset} className="text-[11px] text-subtle transition hover:text-body">
          Reset the demo calendar
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-60"
        >
          {running ? 'Optimizing…' : 'Optimize with these'}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { theme, setTheme } = useTheme()
  // Read once: a first visit gets the onboarding, a return visit gets its answers.
  const saved = useRef(loadPrefs())
  const [prefs, setPrefs] = useState<Prefs>(saved.current.prefs)
  const [onboarding, setOnboarding] = useState(!saved.current.onboarded)
  const [events, setEvents] = useState<CalEvent[]>(loadDemoWeek)
  // Stateful, because booking a meeting has to survive a later Optimize.
  const [baseline, setBaseline] = useState<CalEvent[]>(loadDemoWeek)
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [showTeam, setShowTeam] = useState(false)
  const [running, setRunning] = useState(false)
  const [week, setWeek] = useState(0)
  // Bumped whenever a run finishes, so the frog has something to cheer about.
  const [cheer, setCheer] = useState(0)

  // --- spoken meeting requests
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedRequest | null>(null)
  const [source, setSource] = useState<'claude' | 'local' | null>(null)
  const [proposals, setProposals] = useState<SlotProposal[] | null>(null)
  const [thinking, setThinking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [justBooked, setJustBooked] = useState<string | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [tuneNote, setTuneNote] = useState<string | null>(null)
  const [perch, setPerch] = useState<Perch | null>(null)
  const bookedElRef = useRef<HTMLDivElement | null>(null)

  const current: Metrics = useMemo(() => measure(events, prefs), [events, prefs])
  const before = result?.before ?? null
  const movedIds = useMemo(() => {
    if (!result) return new Set<string>()
    const base = new Map(baseline.map((e) => [e.id, e]))
    return new Set(events.filter((e) => { const b = base.get(e.id); return b && (b.day !== e.day || b.start !== e.start) }).map((e) => e.id))
  }, [events, baseline, result])

  const focusShown = useTween(current.focusTime)
  const proposedDuration = parsed ? toMeetingRequest(parsed).durationMinutes : 30

  // Remember the answers, but only once they've actually been given — writing
  // the defaults early would make the next visit look like a return visit.
  useEffect(() => {
    if (onboarding) return
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // Private browsing, a full quota — not worth breaking the app over.
    }
  }, [prefs, onboarding])

  /**
   * Optimize with an explicit set of preferences rather than whatever is in
   * state — applying a spoken preference and re-optimizing happen in the same
   * tick, and `prefs` wouldn't have caught up yet.
   */
  const run = useCallback(
    (using: Prefs = prefs) => {
      setRunning(true)
      // Defer a frame so the button's pressed state paints before we block.
      requestAnimationFrame(() => {
        const r = optimize(baseline, using)
        setResult(r)
        setEvents(r.events)
        setRunning(false)
        setCheer((n) => n + 1)
      })
    },
    [baseline, prefs],
  )

  /**
   * One input, two meanings: "find me a slot" and "here's how I like my week".
   * Claude labels which it heard; the local parser routes the same way so a
   * missing key doesn't turn a preference into a mystery meeting.
   */
  const handleInput = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return
      setThinking(true)
      setNotice(null)
      setProposals(null)

      let intent: ParsedIntent
      let src: 'claude' | 'local' = 'claude'
      try {
        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transcript }),
        })
        const payload = (await res.json()) as { parsed?: ParsedIntent; error?: string }
        if (!res.ok || !payload.parsed) throw new Error(payload.error ?? res.statusText)
        intent = payload.parsed
      } catch (err) {
        // Never let a missing key or a dead network take the feature down.
        intent = parseIntentLocally(transcript)
        src = 'local'
        setNotice(err instanceof Error ? err.message : String(err))
      }

      setSource(src)
      setThinking(false)

      if (intent.kind === 'tune' && intent.tune) {
        const next = applyTune(prefs, intent.tune)
        setPrefs(next)
        setParsed(null)
        // Prefer Claude's own sentence, but never trust it over the diff we
        // actually applied — the clamps in applyTune can overrule it.
        setTuneNote(`${intent.tune.summary?.trim() || 'Got it.'} → ${describeTune(prefs, next)}`)
        run(next)
        return
      }

      const p = intent.meeting ?? parseIntentLocally(transcript).meeting!
      setTuneNote(null)
      setParsed(p)
      const slots = proposeSlots(events, prefs, toMeetingRequest(p), 3)
      setProposals(slots)
      if (slots.length > 0) setWeek(Math.floor(slots[0].day / 5))
    },
    [events, prefs, run],
  )

  const { listening, interim, error: micError, start, stop } = useSpeech(
    useCallback((t: string) => { setText(t); void handleInput(t) }, [handleInput]),
  )

  const book = (slot: SlotProposal) => {
    if (!parsed) return
    const req = toMeetingRequest(parsed)
    const booked: CalEvent = {
      id: `booked-${Date.now()}`,
      title: req.title,
      day: slot.day,
      start: slot.start,
      duration: req.durationMinutes,
      // Pinned: we chose this slot deliberately, so a later Optimize works
      // around it instead of undoing the decision.
      flexible: false,
      attendees: ['you', ...req.attendees.filter((a) => a !== 'you')],
      kind: 'internal',
    }
    setEvents((prev) => [...prev, booked])
    setBaseline((prev) => [...prev, booked])
    setWeek(Math.floor(slot.day / 5))
    setProposals(null)
    setParsed(null)
    setJustBooked(booked.id)
    setTimeout(() => setJustBooked(null), 6000)
  }

  // Send the frog to whatever we just booked, once it has actually painted.
  useEffect(() => {
    if (!justBooked) return
    let raf = 0
    let cancelled = false

    // Centre it rather than merely nudging it into view, so there's room for a
    // frog underneath wherever the meeting sits in the day.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bookedElRef.current?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })

    // Smooth scrolling is asynchronous: measuring now would aim him at where
    // the meeting used to be, which is exactly the off-screen case. Wait for
    // the rect to stop moving, with a deadline in case it never settles.
    let lastTop = Number.NaN
    let steady = 0
    const deadline = performance.now() + 1500

    const settle = () => {
      if (cancelled) return
      const el = bookedElRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      steady = Math.abs(r.top - lastTop) < 0.5 ? steady + 1 : 0
      lastTop = r.top

      if (steady < 3 && performance.now() < deadline) {
        raf = requestAnimationFrame(settle)
        return
      }

      // If it still can't be fully scrolled to, put him at the nearest edge
      // rather than somewhere nobody can see.
      const margin = 56
      setPerch({
        x: Math.min(window.innerWidth - margin, Math.max(margin, r.left + r.width / 2)),
        y: Math.min(window.innerHeight - 12, Math.max(margin, r.top + 2)),
        key: Date.now(),
      })
    }

    raf = requestAnimationFrame(settle)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [justBooked])

  const reset = () => {
    setEvents(loadDemoWeek())
    setBaseline(loadDemoWeek())
    setResult(null)
    setProposals(null)
    setParsed(null)
    setText('')
    setTuneNote(null)
  }

  const hours: number[] = []
  for (let h = prefs.dayStart; h <= prefs.dayEnd; h += 60) hours.push(h)
  const visibleDays = daysInWeek(week)

  return (
    <div className="min-h-screen bg-canvas text-body">
      {onboarding && (
        <Onboarding
          prefs={prefs}
          setPrefs={setPrefs}
          onDone={(skipped) => {
            setOnboarding(false)
            // "Clean my pond" is a request, not just a dialog dismissal.
            if (!skipped) run(prefs)
          }}
        />
      )}

      <div className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8">
        {/* ---- header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-fg">
            Clockwiser <span className="font-normal text-subtle">· focus time, defragmented</span>
          </h1>
          <div className="relative flex items-center gap-2">
            <ThemeSwitch theme={theme} setTheme={setTheme} />
            <button
              onClick={() => setPrefsOpen((v) => !v)}
              aria-expanded={prefsOpen}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                prefsOpen ? 'border-accent text-fg' : 'border-line text-body hover:bg-hover'
              }`}
            >
              Preferences
            </button>
            <button
              onClick={() => run()}
              disabled={running}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg shadow-[0_10px_22px_-8px_var(--accent-glow)] transition hover:bg-accent-hover disabled:opacity-60"
            >
              {running ? 'Optimizing…' : 'Optimize my weeks'}
            </button>

            {prefsOpen && (
              <PrefsPopover
                prefs={prefs}
                setPrefs={setPrefs}
                onRun={() => { setPrefsOpen(false); run() }}
                onReset={() => { setPrefsOpen(false); reset() }}
                onClose={() => setPrefsOpen(false)}
                running={running}
              />
            )}
          </div>
        </div>

        {/* ---- ask for a meeting, or for a different kind of week */}
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={listening && interim ? interim : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleInput(text)}
              placeholder={
                speechSupported()
                  ? 'Ask for a meeting, or talk to the frog in the corner →'
                  : 'Ask for a meeting, or tell me how you like your week'
              }
              className="min-w-[280px] flex-1 rounded-lg border border-line bg-panel-soft px-3.5 py-3 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => void handleInput(text)}
              disabled={thinking || !text.trim()}
              className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              {thinking ? 'Thinking…' : 'Go'}
            </button>
          </div>

          {/* Examples only until you've actually used it — then they're noise. */}
          {!parsed && !tuneNote && !listening && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-subtle">
              <span>Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.chip}
                  onClick={() => { setText(ex.say); void handleInput(ex.say) }}
                  title={ex.say}
                  className="rounded-md bg-panel-soft px-2.5 py-1 text-muted transition hover:bg-hover hover:text-body"
                >
                  {ex.chip}
                </button>
              ))}
            </div>
          )}

          {(micError || notice) && (
            <div className="mt-2 text-[11px] text-warn">
              {micError ?? `Claude unavailable (${notice}) — parsed locally instead.`}
            </div>
          )}

          {/* a spoken preference, and what it changed */}
          {tuneNote && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-xs text-muted">Tuned:</span>
              <Chip>{tuneNote}</Chip>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${source === 'claude' ? 'bg-accent text-accent-fg' : 'bg-warn/20 text-warn'}`}>
                {source === 'claude' ? 'Claude' : 'local parser'}
              </span>
            </div>
          )}

          {/* parsed request + ranked slots */}
          {parsed && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Understood:</span>
                <Chip>{parsed.title}</Chip>
                <Chip>{fmtDuration(proposedDuration)}</Chip>
                {parsed.attendees.length > 0 && <Chip>with {parsed.attendees.map((a) => PEOPLE[a].name).join(', ')}</Chip>}
                {parsed.timeOfDay !== 'any' && <Chip>{parsed.timeOfDay}</Chip>}
                <Chip>{HORIZON[parsed.earliestDay]?.label} → {HORIZON[parsed.latestDay]?.label}</Chip>
                <span className={`ml-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${source === 'claude' ? 'bg-accent text-accent-fg' : 'bg-warn/20 text-warn'}`}>
                  {source === 'claude' ? 'Claude' : 'local parser'}
                </span>
              </div>

              {proposals && proposals.length === 0 && (
                <div className="mt-3 text-sm text-warn">
                  No slot works for everyone in that window. Try widening the range or dropping an attendee.
                </div>
              )}

              {proposals && proposals.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {proposals.map((s, i) => (
                    <button
                      key={`${s.day}-${s.start}`}
                      onClick={() => book(s)}
                      className={`group rounded-xl border px-3 py-3 text-left transition ${
                        i === 0 ? 'border-good bg-focus-bg hover:bg-hover' : 'border-line bg-panel-soft hover:bg-hover'
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-fg">{HORIZON[s.day]?.label}</span>
                        {i === 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-good">best</span>}
                      </div>
                      <div className="mt-0.5 text-sm tabular-nums text-body">
                        {fmt(s.start)}–{fmt(s.start + proposedDuration)}
                      </div>
                      <div className={`mt-2 text-[11px] ${s.focusCost === 0 ? 'text-good' : 'text-warn'}`}>
                        {s.focusCost === 0 ? 'costs nobody any focus time' : `costs ${fmtDuration(s.focusCost)} of focus time`}
                      </div>
                      {s.focusCost > 0 && (
                        <div className="mt-1 text-[10px] text-subtle">
                          {s.perPerson.filter((p) => p.cost > 0).map((p) => `${PEOPLE[p.person].name} −${fmtDuration(p.cost)}`).join(' · ')}
                        </div>
                      )}
                      <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted group-hover:text-fg">
                        Book it →
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- stats: three that matter, the rest kept quiet */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Usable focus time"
            value={fmtDuration(Math.round(focusShown / 5) * 5)}
            delta={before ? Math.round((current.focusTime - before.focusTime) / 60 * 10) / 10 : undefined}
            good="up"
          />
          <Stat label="Longest block" value={fmtDuration(current.longestBlock)} good="up" />
          <Stat label="Dead fragments" value={String(current.fragments)} delta={before ? current.fragments - before.fragments : undefined} good="down" />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[11px] text-subtle">
          <span>
            {current.earlyMeetings} before {fmt(prefs.noMeetingsBefore)}
          </span>
          <span>{current.lunchClashes} over lunch</span>
          {prefs.breakAfterLongMeetings > 0 && (
            <span>
              {current.tightTurnarounds} with no room to breathe
              {before && before.tightTurnarounds !== current.tightTurnarounds && (
                <span className="text-good"> (was {before.tightTurnarounds})</span>
              )}
            </span>
          )}
          {result && (
            <span className="ml-auto">
              moved <span className="font-semibold text-body">{result.moved}</span> of{' '}
              {baseline.filter((e) => e.flexible && e.attendees.includes('you')).length} flexible meetings
              {result.stuck.length > 0 && <span className="text-warn"> · {result.stuck.length} had nowhere to go</span>}
            </span>
          )}
        </div>

        {/* ---- controls: the two that change what you're looking at */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex overflow-hidden rounded-lg border border-line">
            {[0, 1].map((w) => (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={`px-4 py-2 text-xs font-semibold transition ${week === w ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover'}`}
              >
                {w === 0 ? 'This week' : 'Next week'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} className="accent-accent" />
            Show teammate availability
          </label>
        </div>

        {/* ---- calendar */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="grid" style={{ gridTemplateColumns: `64px repeat(5, minmax(0,1fr))` }}>
            <div className="border-b border-line px-2 py-2" />
            {visibleDays.map((day) => (
              <div key={day} className="border-b border-l border-line px-3 py-2 text-sm font-semibold text-body">
                {HORIZON[day].weekday} <span className="font-normal text-subtle">{HORIZON[day].date.getDate()}</span>
              </div>
            ))}

            {/* time gutter */}
            <div className="relative" style={{ height: y(prefs.dayEnd, prefs) }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-subtle" style={{ top: y(h, prefs) }}>
                  {fmt(h)}
                </div>
              ))}
            </div>

            {visibleDays.map((day) => {
              const dayEvents = events.filter((e) => e.day === day)
              const mine = dayEvents.filter((e) => e.attendees.includes('you'))
              const theirs = dayEvents.filter((e) => !e.attendees.includes('you'))
              const focusBlocks = gapsForDay(events, day, prefs).filter((g) => g.end - g.start >= prefs.minFocusBlock)
              const proposedHere = (proposals ?? []).filter((s) => s.day === day)
              // One lane per teammate who is busy today, so six people don't
              // all draw on top of each other in the same strip.
              const lanes = TEAMMATES.filter((p) => theirs.some((e) => e.attendees[0] === p))
              const railWidth = showTeam && lanes.length > 0 ? lanes.length * 6 + 2 : 0

              return (
                <div key={day} className="relative border-l border-line" style={{ height: y(prefs.dayEnd, prefs) }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-line-soft" style={{ top: y(h, prefs) }} />
                  ))}

                  {/* lunch */}
                  <div
                    className="absolute inset-x-0 bg-lunch"
                    style={{ top: y(prefs.lunchStart, prefs), height: y(prefs.lunchEnd, prefs) - y(prefs.lunchStart, prefs) }}
                  />

                  {/* recovered focus blocks */}
                  {focusBlocks.map((g) => (
                    <div
                      key={`f${g.start}`}
                      className="absolute inset-x-1 rounded-lg border border-dashed border-focus-line bg-focus-bg transition-all duration-700 ease-out"
                      style={{ top: y(g.start, prefs), height: y(g.end, prefs) - y(g.start, prefs) }}
                    >
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-focus-fg">
                        Focus · {fmtDuration(g.end - g.start)}
                      </div>
                    </div>
                  ))}

                  {/* candidate slots for the pending request */}
                  {proposedHere.map((s) => (
                    <div
                      key={`p${s.start}`}
                      className="pointer-events-none absolute inset-x-1 z-10 animate-pulse rounded-lg border-2 border-dashed border-accent bg-accent/25"
                      style={{ top: y(s.start, prefs), height: Math.max(20, y(s.start + proposedDuration, prefs) - y(s.start, prefs) - 2) }}
                    />
                  ))}

                  {/* teammate-only commitments */}
                  {showTeam &&
                    theirs.map((e) => {
                      const lane = lanes.indexOf(e.attendees[0] as (typeof lanes)[number])
                      if (lane === -1) return null
                      return (
                        <div
                          key={e.id}
                          className="absolute w-1 rounded-full opacity-60"
                          style={{
                            top: y(e.start, prefs),
                            height: y(e.start + e.duration, prefs) - y(e.start, prefs),
                            right: 4 + lane * 6,
                            background: PEOPLE[e.attendees[0] as PersonId]?.color,
                          }}
                          title={`${PEOPLE[e.attendees[0] as PersonId]?.name}: ${e.title}`}
                        />
                      )
                    })}

                  {/* your meetings */}
                  {mine.map((e) => {
                    const moved = movedIds.has(e.id)
                    const fresh = justBooked === e.id
                    return (
                      <div
                        key={e.id}
                        ref={fresh ? bookedElRef : undefined}
                        className={`absolute left-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] leading-tight backdrop-blur-sm transition-all duration-700 ease-out ${KIND_STYLE[e.kind]} ${e.flexible ? 'border-dashed' : ''} ${moved ? 'ring-2 ring-good' : ''} ${fresh ? 'just-booked' : ''}`}
                        style={{
                          top: y(e.start, prefs),
                          height: Math.max(20, y(e.start + e.duration, prefs) - y(e.start, prefs) - 2),
                          right: railWidth + 4,
                        }}
                        title={`${e.title} · ${fmt(e.start)}–${fmt(e.start + e.duration)} · ${e.attendees.map((a) => PEOPLE[a].name).join(', ')}`}
                      >
                        <div className="flex items-center gap-1 font-semibold">
                          {!e.flexible && <span className="opacity-60">🔒</span>}
                          <span className="truncate">{e.title}</span>
                          {fresh && <span className="just-booked-tag">new</span>}
                        </div>
                        {e.duration >= 30 && <div className="tabular-nums opacity-70">{fmt(e.start)}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-subtle">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-muted" /> flexible — optimizer may move</span>
          <span className="flex items-center gap-1.5">🔒 fixed — never moved</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-focus-line bg-focus-bg" /> usable focus block</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border-2 border-dashed border-accent bg-accent/25" /> proposed slot</span>
          {Object.entries(PEOPLE).filter(([k]) => k !== 'you').map(([k, p]) => (
            <span key={k} className="flex items-center gap-1.5"><span className="inline-block h-3 w-1.5 rounded-full" style={{ background: p.color }} /> {p.name}</span>
          ))}
        </div>
      </div>

      <Frog
        cheer={cheer}
        perch={perch}
        listening={listening}
        heard={interim}
        canHear={speechSupported()}
        onTalk={listening ? stop : start}
      />
    </div>
  )
}
