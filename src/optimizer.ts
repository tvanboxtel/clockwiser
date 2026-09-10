import type { CalEvent, PersonId, Prefs } from './types'

interface Interval {
  start: number
  end: number
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

const busyFor = (person: PersonId, events: CalEvent[], day: number): Interval[] =>
  events
    .filter((e) => e.day === day && e.attendees.includes(person))
    .map((e) => ({ start: e.start, end: e.start + e.duration }))
    .sort((x, y) => x.start - y.start)

/** Free gaps in `you`'s day, inside working hours. */
export const gapsForDay = (events: CalEvent[], day: number, prefs: Prefs): Interval[] => {
  const busy = busyFor('you', events, day)
  const gaps: Interval[] = []
  let cursor = prefs.dayStart
  for (const b of busy) {
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, prefs.dayEnd) })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < prefs.dayEnd) gaps.push({ start: cursor, end: prefs.dayEnd })
  return gaps.filter((g) => g.end > g.start)
}

export interface Metrics {
  /** Minutes sitting in gaps long enough to actually be usable. */
  focusTime: number
  /** Longest single uninterrupted block in the week. */
  longestBlock: number
  /** Gaps too short to use — the context-switch tax. */
  fragments: number
  fragmentedMinutes: number
  earlyMeetings: number
  lunchClashes: number
  /** Days with zero meetings for you. */
  meetingFreeDays: number
}

export const measure = (events: CalEvent[], prefs: Prefs): Metrics => {
  const m: Metrics = {
    focusTime: 0,
    longestBlock: 0,
    fragments: 0,
    fragmentedMinutes: 0,
    earlyMeetings: 0,
    lunchClashes: 0,
    meetingFreeDays: 0,
  }

  for (let day = 0; day < 5; day++) {
    for (const g of gapsForDay(events, day, prefs)) {
      const len = g.end - g.start
      if (len >= prefs.minFocusBlock) {
        m.focusTime += len
        m.longestBlock = Math.max(m.longestBlock, len)
      } else {
        m.fragments++
        m.fragmentedMinutes += len
      }
    }
    const mine = events.filter((e) => e.day === day && e.attendees.includes('you'))
    if (mine.length === 0) m.meetingFreeDays++
    for (const e of mine) {
      if (e.start < prefs.noMeetingsBefore) m.earlyMeetings++
      if (overlaps({ start: e.start, end: e.start + e.duration }, { start: prefs.lunchStart, end: prefs.lunchEnd }))
        m.lunchClashes++
    }
  }
  return m
}

/**
 * Higher is better. Focus minutes are the point, but we pay extra for one
 * genuinely long block and charge for fragmentation, early meetings and
 * meetings that eat lunch.
 */
const score = (events: CalEvent[], prefs: Prefs): number => {
  const m = measure(events, prefs)
  return (
    m.focusTime +
    m.longestBlock * 0.6 +
    m.meetingFreeDays * 120 -
    m.fragments * 25 -
    m.earlyMeetings * 45 -
    m.lunchClashes * 60
  )
}

const SLOT = 15

/** Every legal (day, start) this event could move to, given who's attending. */
const candidateSlots = (
  event: CalEvent,
  others: CalEvent[],
  prefs: Prefs,
): Array<{ day: number; start: number }> => {
  const days = prefs.allowDayChange ? [0, 1, 2, 3, 4] : [event.day]
  const out: Array<{ day: number; start: number }> = []

  for (const day of days) {
    const blocking = others.filter(
      (o) => o.day === day && o.attendees.some((a) => event.attendees.includes(a)),
    )
    // Preferences are hard constraints here, not fines. Scored as penalties
    // instead, the optimizer happily buys a huge afternoon block by cramming
    // meetings into the morning you asked it to protect.
    const earliest = Math.max(prefs.dayStart, prefs.noMeetingsBefore)
    const lunch = { start: prefs.lunchStart, end: prefs.lunchEnd }

    for (let start = earliest; start + event.duration <= prefs.dayEnd; start += SLOT) {
      const slot = { start, end: start + event.duration }
      if (overlaps(slot, lunch)) continue
      if (!blocking.some((b) => overlaps(slot, { start: b.start, end: b.start + b.duration })))
        out.push({ day, start })
    }
  }
  return out
}

const shuffled = <T,>(xs: T[]): T[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface OptimizeResult {
  events: CalEvent[]
  before: Metrics
  after: Metrics
  moved: number
  /** Flexible events that had nowhere legal to go and stayed put. */
  stuck: string[]
}

/**
 * Randomized greedy with restarts. For ~20 flexible meetings on a 15-minute
 * grid this converges in well under a second, and unlike a single greedy pass
 * it doesn't get trapped by whichever meeting happened to be placed first.
 */
export const optimize = (all: CalEvent[], prefs: Prefs, restarts = 40): OptimizeResult => {
  const fixed = all.filter((e) => !e.flexible)
  const flex = all.filter((e) => e.flexible)

  let bestSchedule: CalEvent[] | null = null
  let bestScore = -Infinity
  let bestStuck: string[] = []

  for (let r = 0; r < restarts; r++) {
    // First restart: longest meetings first — the classic bin-packing warm start.
    const order =
      r === 0 ? [...flex].sort((a, b) => b.duration - a.duration) : shuffled(flex)

    const placed: CalEvent[] = []
    const stuck: string[] = []

    for (const e of order) {
      const others = [...fixed, ...placed]
      const candidates = candidateSlots(e, others, prefs)
      if (candidates.length === 0) {
        placed.push({ ...e })
        stuck.push(e.title)
        continue
      }

      let bestCand = candidates[0]
      let bestCandScore = -Infinity
      for (const c of candidates) {
        const trial = [...others, { ...e, day: c.day, start: c.start }]
        // Tiny jitter breaks ties differently across restarts.
        const s = score(trial, prefs) + Math.random() * 0.5
        if (s > bestCandScore) {
          bestCandScore = s
          bestCand = c
        }
      }
      placed.push({ ...e, day: bestCand.day, start: bestCand.start })
    }

    const schedule = [...fixed, ...placed]
    const s = score(schedule, prefs)
    if (s > bestScore) {
      bestScore = s
      bestSchedule = schedule
      bestStuck = stuck
    }
  }

  const result = bestSchedule ?? all
  const byId = new Map(result.map((e) => [e.id, e]))
  const moved = all.filter((e) => {
    const after = byId.get(e.id)
    return after && (after.day !== e.day || after.start !== e.start)
  }).length

  return {
    // Preserve original ordering so React keys/animations stay stable.
    events: all.map((e) => byId.get(e.id) ?? e),
    before: measure(all, prefs),
    after: measure(result, prefs),
    moved,
    stuck: bestStuck,
  }
}
