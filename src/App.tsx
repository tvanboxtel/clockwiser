import { useEffect, useMemo, useRef, useState } from 'react'
import { loadDemoWeek } from './data'
import { gapsForDay, measure, optimize, type Metrics, type OptimizeResult } from './optimizer'
import { DAYS, DEFAULT_PREFS, PEOPLE, fmt, fmtDuration, type CalEvent, type PersonId, type Prefs } from './types'

const HOUR_PX = 68
const y = (min: number, prefs: Prefs) => ((min - prefs.dayStart) / 60) * HOUR_PX

const KIND_STYLE: Record<string, string> = {
  external: 'bg-rose-500/25 border-rose-400/70 text-rose-50',
  internal: 'bg-indigo-500/25 border-indigo-400/70 text-indigo-50',
  oneonone: 'bg-violet-500/25 border-violet-400/70 text-violet-50',
  focus: 'bg-emerald-500/25 border-emerald-400/70 text-emerald-50',
  personal: 'bg-slate-500/25 border-slate-400/70 text-slate-50',
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

function Stat({ label, value, delta, good }: { label: string; value: string; delta?: number; good?: 'up' | 'down' }) {
  const sign = delta === undefined || delta === 0 ? null : delta > 0 ? '+' : '−'
  const improved = delta === undefined || delta === 0 ? null : good === 'up' ? delta > 0 : delta < 0
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-white">{value}</span>
        {sign && (
          <span className={`text-xs font-semibold tabular-nums ${improved ? 'text-emerald-400' : 'text-rose-400'}`}>
            {sign}
            {Math.abs(delta!)}
          </span>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [events, setEvents] = useState<CalEvent[]>(loadDemoWeek)
  const [baseline] = useState<CalEvent[]>(loadDemoWeek)
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [showTeam, setShowTeam] = useState(false)
  const [running, setRunning] = useState(false)

  const current: Metrics = useMemo(() => measure(events, prefs), [events, prefs])
  const before = result?.before ?? null
  const movedIds = useMemo(() => {
    if (!result) return new Set<string>()
    const base = new Map(baseline.map((e) => [e.id, e]))
    return new Set(events.filter((e) => { const b = base.get(e.id); return b && (b.day !== e.day || b.start !== e.start) }).map((e) => e.id))
  }, [events, baseline, result])

  const focusShown = useTween(current.focusTime)

  const run = () => {
    setRunning(true)
    // Defer a frame so the button's pressed state paints before we block.
    requestAnimationFrame(() => {
      const r = optimize(baseline, prefs)
      setResult(r)
      setEvents(r.events)
      setRunning(false)
    })
  }

  const reset = () => {
    setEvents(loadDemoWeek())
    setResult(null)
  }

  const hours: number[] = []
  for (let h = prefs.dayStart; h <= prefs.dayEnd; h += 60) hours.push(h)

  return (
    <div className="min-h-screen bg-[#0b0d14] text-slate-200">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* ---- header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              Clockwiser <span className="font-normal text-slate-500">· focus time, defragmented</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Fixed meetings stay put. Flexible ones get rearranged around everyone's real availability.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
            >
              Reset week
            </button>
            <button
              onClick={run}
              disabled={running}
              className="rounded-lg bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400 disabled:opacity-60"
            >
              {running ? 'Optimizing…' : 'Optimize my week'}
            </button>
          </div>
        </div>

        {/* ---- stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.allowDayChange} onChange={(e) => setPrefs({ ...prefs, allowDayChange: e.target.checked })} className="accent-indigo-500" />
            Move across days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} className="accent-indigo-500" />
            Show teammate availability
          </label>
          <label className="flex items-center gap-2">
            Min focus block
            <select
              value={prefs.minFocusBlock}
              onChange={(e) => setPrefs({ ...prefs, minFocusBlock: Number(e.target.value) })}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1"
            >
              {[60, 90, 120, 180].map((v) => (
                <option key={v} value={v} className="bg-[#0b0d14]">{fmtDuration(v)}</option>
              ))}
            </select>
          </label>
          {result && (
            <span className="ml-auto text-slate-400">
              moved <span className="font-semibold text-white">{result.moved}</span> of{' '}
              {baseline.filter((e) => e.flexible && e.attendees.includes('you')).length} flexible meetings
              {result.stuck.length > 0 && <span className="text-amber-400"> · {result.stuck.length} had nowhere to go</span>}
            </span>
          )}
        </div>

        {/* ---- calendar */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <div className="grid" style={{ gridTemplateColumns: `64px repeat(5, minmax(0,1fr))` }}>
            <div className="border-b border-white/10 px-2 py-2" />
            {DAYS.map((d) => (
              <div key={d} className="border-b border-l border-white/10 px-3 py-2 text-sm font-semibold text-slate-300">
                {d}
              </div>
            ))}

            {/* time gutter */}
            <div className="relative" style={{ height: y(prefs.dayEnd, prefs) }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-slate-500" style={{ top: y(h, prefs) }}>
                  {fmt(h)}
                </div>
              ))}
            </div>

            {DAYS.map((_, day) => {
              const dayEvents = events.filter((e) => e.day === day)
              const mine = dayEvents.filter((e) => e.attendees.includes('you'))
              const theirs = dayEvents.filter((e) => !e.attendees.includes('you'))
              const focusBlocks = gapsForDay(events, day, prefs).filter((g) => g.end - g.start >= prefs.minFocusBlock)

              return (
                <div key={day} className="relative border-l border-white/10" style={{ height: y(prefs.dayEnd, prefs) }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-white/[0.06]" style={{ top: y(h, prefs) }} />
                  ))}

                  {/* lunch */}
                  <div
                    className="absolute inset-x-0 bg-amber-400/[0.05]"
                    style={{ top: y(prefs.lunchStart, prefs), height: y(prefs.lunchEnd, prefs) - y(prefs.lunchStart, prefs) }}
                  />

                  {/* recovered focus blocks */}
                  {focusBlocks.map((g) => (
                    <div
                      key={`f${g.start}`}
                      className="absolute inset-x-1 rounded-lg border border-dashed border-emerald-400/40 bg-emerald-400/[0.07] transition-all duration-700 ease-out"
                      style={{ top: y(g.start, prefs), height: y(g.end, prefs) - y(g.start, prefs) }}
                    >
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
                        Focus · {fmtDuration(g.end - g.start)}
                      </div>
                    </div>
                  ))}

                  {/* teammate-only commitments */}
                  {showTeam &&
                    theirs.map((e) => (
                      <div
                        key={e.id}
                        className="absolute right-1 w-2 rounded-full opacity-50"
                        style={{
                          top: y(e.start, prefs),
                          height: y(e.start + e.duration, prefs) - y(e.start, prefs),
                          background: PEOPLE[e.attendees[0] as PersonId]?.color,
                        }}
                        title={e.title}
                      />
                    ))}

                  {/* your meetings */}
                  {mine.map((e) => {
                    const moved = movedIds.has(e.id)
                    return (
                      <div
                        key={e.id}
                        className={`absolute left-1 ${showTeam ? 'right-4' : 'right-1'} overflow-hidden rounded-lg border px-2 py-1 text-[11px] leading-tight backdrop-blur-sm transition-all duration-700 ease-out ${KIND_STYLE[e.kind]} ${e.flexible ? 'border-dashed' : ''} ${moved ? 'ring-2 ring-emerald-400/80' : ''}`}
                        style={{ top: y(e.start, prefs), height: Math.max(20, y(e.start + e.duration, prefs) - y(e.start, prefs) - 2) }}
                        title={`${e.title} · ${fmt(e.start)}–${fmt(e.start + e.duration)} · ${e.attendees.map((a) => PEOPLE[a].name).join(', ')}`}
                      >
                        <div className="flex items-center gap-1 font-semibold">
                          {!e.flexible && <span className="opacity-60">🔒</span>}
                          <span className="truncate">{e.title}</span>
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

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-white/40" /> flexible — optimizer may move</span>
          <span className="flex items-center gap-1.5">🔒 fixed — never moved</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded border border-dashed border-emerald-400/40 bg-emerald-400/10" /> usable focus block</span>
          {Object.entries(PEOPLE).filter(([k]) => k !== 'you').map(([k, p]) => (
            <span key={k} className="flex items-center gap-1.5"><span className="inline-block h-3 w-1.5 rounded-full" style={{ background: p.color }} /> {p.name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
