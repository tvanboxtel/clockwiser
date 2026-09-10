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
import { parseLocally, toMeetingRequest, type ParsedRequest } from './intent'
import { speechSupported, useSpeech } from './useSpeech'
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

const EXAMPLES = [
  'I need 30 minutes with Sofia in the morning sometime in the next two weeks',
  'Book an hour with Marc and Lena next week, afternoons only',
  'Quick chat with Lena on Thursday',
]

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

export default function App() {
  const { theme, setTheme } = useTheme()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
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

  /** Parse a spoken/typed request, then rank slots for it. */
  const findSlots = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return
      setThinking(true)
      setNotice(null)
      setProposals(null)

      let p: ParsedRequest
      let src: 'claude' | 'local' = 'claude'
      try {
        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transcript }),
        })
        const payload = (await res.json()) as { parsed?: ParsedRequest; error?: string }
        if (!res.ok || !payload.parsed) throw new Error(payload.error ?? res.statusText)
        p = payload.parsed
      } catch (err) {
        // Never let a missing key or a dead network take the feature down.
        p = parseLocally(transcript)
        src = 'local'
        setNotice(err instanceof Error ? err.message : String(err))
      }

      setParsed(p)
      setSource(src)
      const slots = proposeSlots(events, prefs, toMeetingRequest(p), 3)
      setProposals(slots)
      if (slots.length > 0) setWeek(Math.floor(slots[0].day / 5))
      setThinking(false)
    },
    [events, prefs],
  )

  const { listening, interim, error: micError, start, stop } = useSpeech(
    useCallback((t: string) => { setText(t); void findSlots(t) }, [findSlots]),
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
    const raf = requestAnimationFrame(() => {
      const el = bookedElRef.current
      if (!el) return
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      const r = el.getBoundingClientRect()
      setPerch({ x: r.left + r.width / 2, y: r.top + 2, key: Date.now() })
    })
    return () => cancelAnimationFrame(raf)
  }, [justBooked])

  const run = () => {
    setRunning(true)
    // Defer a frame so the button's pressed state paints before we block.
    requestAnimationFrame(() => {
      const r = optimize(baseline, prefs)
      setResult(r)
      setEvents(r.events)
      setRunning(false)
      setCheer((n) => n + 1)
    })
  }

  const reset = () => {
    setEvents(loadDemoWeek())
    setBaseline(loadDemoWeek())
    setResult(null)
    setProposals(null)
    setParsed(null)
    setText('')
  }

  const hours: number[] = []
  for (let h = prefs.dayStart; h <= prefs.dayEnd; h += 60) hours.push(h)
  const visibleDays = daysInWeek(week)

  return (
    <div className="min-h-screen bg-canvas text-body">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* ---- header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-fg">
              Clockwiser <span className="font-normal text-subtle">· focus time, defragmented</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Fixed meetings stay put. Flexible ones get rearranged around everyone's real availability.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitch theme={theme} setTheme={setTheme} />
            <button
              onClick={reset}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-body transition hover:bg-hover"
            >
              Reset
            </button>
            <button
              onClick={run}
              disabled={running}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg shadow-[0_10px_22px_-8px_var(--accent-glow)] transition hover:bg-accent-hover disabled:opacity-60"
            >
              {running ? 'Optimizing…' : 'Optimize my weeks'}
            </button>
          </div>
        </div>

        {/* ---- ask for a meeting */}
        <div className="mt-5 rounded-2xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={listening ? stop : start}
              disabled={!speechSupported()}
              aria-label={listening ? 'Stop listening' : 'Speak a meeting request'}
              title={speechSupported() ? 'Speak a meeting request' : 'No speech recognition in this browser — type it instead'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg transition disabled:opacity-40 ${
                listening ? 'animate-pulse bg-bad text-canvas' : 'bg-hover text-body hover:bg-panel-soft'
              }`}
            >
              {listening ? '■' : '🎙'}
            </button>
            <input
              value={listening && interim ? interim : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void findSlots(text)}
              placeholder={EXAMPLES[0]}
              className="min-w-[280px] flex-1 rounded-lg border border-line bg-panel-soft px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => void findSlots(text)}
              disabled={thinking || !text.trim()}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              {thinking ? 'Thinking…' : 'Find a slot'}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-subtle">
            {listening ? (
              <span className="font-semibold text-bad">Listening…</span>
            ) : (
              <>
                <span>Try:</span>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => { setText(ex); void findSlots(ex) }}
                    className="rounded-md bg-panel-soft px-2 py-1 text-muted transition hover:bg-hover hover:text-body"
                  >
                    {ex}
                  </button>
                ))}
              </>
            )}
          </div>

          {(micError || notice) && (
            <div className="mt-2 text-[11px] text-warn">
              {micError ?? `Claude unavailable (${notice}) — parsed locally instead.`}
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

        {/* ---- stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Usable focus time"
            value={fmtDuration(Math.round(focusShown / 5) * 5)}
            delta={before ? Math.round((current.focusTime - before.focusTime) / 60 * 10) / 10 : undefined}
            good="up"
          />
          <Stat label="Longest block" value={fmtDuration(current.longestBlock)} good="up" />
          <Stat label="Dead fragments" value={String(current.fragments)} delta={before ? current.fragments - before.fragments : undefined} good="down" />
          <Stat label="Before 10:00" value={String(current.earlyMeetings)} delta={before ? current.earlyMeetings - before.earlyMeetings : undefined} good="down" />
          <Stat label="Lunch clashes" value={String(current.lunchClashes)} delta={before ? current.lunchClashes - before.lunchClashes : undefined} good="down" />
        </div>

        {/* ---- controls */}
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <div className="flex overflow-hidden rounded-lg border border-line">
            {[0, 1].map((w) => (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${week === w ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover'}`}
              >
                {w === 0 ? 'This week' : 'Next week'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.allowDayChange} onChange={(e) => setPrefs({ ...prefs, allowDayChange: e.target.checked })} className="accent-accent" />
            Move across days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} className="accent-accent" />
            Show teammate availability
          </label>
          <label className="flex items-center gap-2">
            Min focus block
            <select
              value={prefs.minFocusBlock}
              onChange={(e) => setPrefs({ ...prefs, minFocusBlock: Number(e.target.value) })}
              className="rounded-md border border-line bg-panel-soft px-2 py-1 text-body"
            >
              {[60, 90, 120, 180].map((v) => (
                <option key={v} value={v} className="bg-canvas text-body">{fmtDuration(v)}</option>
              ))}
            </select>
          </label>
          {result && (
            <span className="ml-auto text-muted">
              moved <span className="font-semibold text-fg">{result.moved}</span> of{' '}
              {baseline.filter((e) => e.flexible && e.attendees.includes('you')).length} flexible meetings
              {result.stuck.length > 0 && <span className="text-warn"> · {result.stuck.length} had nowhere to go</span>}
            </span>
          )}
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

      <Frog cheer={cheer} perch={perch} />
    </div>
  )
}
