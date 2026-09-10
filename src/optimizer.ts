import { HORIZON_DAYS, daysInWeek, weekOf, type CalEvent, type PersonId, type Prefs } from './types'

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

/** Free gaps in a person's day, inside working hours. */
export const gapsForDay = (
  events: CalEvent[],
  day: number,
  prefs: Prefs,
  person: PersonId = 'you',
): Interval[] => {
  const busy = busyFor(person, events, day)
  const gaps: Interval[] = []
  let cursor = prefs.dayStart
  for (const b of busy) {
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, prefs.dayEnd) })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < prefs.dayEnd) gaps.push({ start: cursor, end: prefs.dayEnd })
  return gaps.filter((g) => g.end > g.start)
}

/**
 * A meeting long enough that the next thing shouldn't start the second it
 * ends. Long is a preference, not a constant — 45 minutes is a slog for some
 * people and a warm-up for others.
 */
const isLong = (e: { duration: number }, prefs: Prefs) =>
  prefs.breakAfterLongMeetings > 0 && e.duration >= prefs.longMeetingMinutes

/**
 * Would putting `slot` here leave a long meeting with no breathing room on
 * either side of it? Checked against everyone who shares the meeting, so a
 * back-to-back isn't quietly handed to an attendee instead of the organiser.
 */
const crampsABreak = (
  slot: { start: number; end: number; duration: number },
  neighbours: CalEvent[],
  prefs: Prefs,
): boolean => {
  const gap = prefs.breakAfterLongMeetings
  if (gap <= 0) return false
  return neighbours.some((n) => {
    const nEnd = n.start + n.duration
    // Landing inside the recovery window of a long meeting.
    if (isLong(n, prefs) && slot.start >= nEnd && slot.start < nEnd + gap) return true
    // Or being the long meeting whose own recovery window is already taken.
    if (isLong(slot, prefs) && n.start >= slot.end && n.start < slot.end + gap) return true
    return false
  })
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
  /** Long meetings with something jammed against them. Always 0 when off. */
  tightTurnarounds: number
}

export const measure = (events: CalEvent[], prefs: Prefs, person: PersonId = 'you'): Metrics => {
  const m: Metrics = {
    focusTime: 0,
    longestBlock: 0,
    fragments: 0,
    fragmentedMinutes: 0,
    earlyMeetings: 0,
    lunchClashes: 0,
    meetingFreeDays: 0,
    tightTurnarounds: 0,
  }

  for (let day = 0; day < HORIZON_DAYS; day++) {
    for (const g of gapsForDay(events, day, prefs, person)) {
      const len = g.end - g.start
      if (len >= prefs.minFocusBlock) {
        m.focusTime += len
        m.longestBlock = Math.max(m.longestBlock, len)
      } else {
        m.fragments++
        m.fragmentedMinutes += len
      }
    }
    const mine = events.filter((e) => e.day === day && e.attendees.includes(person))
    if (mine.length === 0) m.meetingFreeDays++
    for (const e of mine) {
      if (e.start < prefs.noMeetingsBefore) m.earlyMeetings++
      if (overlaps({ start: e.start, end: e.start + e.duration }, { start: prefs.lunchStart, end: prefs.lunchEnd }))
        m.lunchClashes++
      // Count the meeting that lost its recovery window, not the pair, so two
      // things stacked after one long meeting still reads as one problem.
      if (isLong(e, prefs)) {
        const end = e.start + e.duration
        if (mine.some((o) => o !== e && o.start >= end && o.start < end + prefs.breakAfterLongMeetings))
          m.tightTurnarounds++
      }
    }
  }
  return m
}

/**
 * Higher is better. Focus minutes are the point, but we pay extra for one
 * genuinely long block and charge for fragmentation, early meetings and
 * meetings that eat lunch.
 */
const score = (events: CalEvent[], prefs: Prefs, person: PersonId = 'you'): number => {
  const m = measure(events, prefs, person)
  return (
    m.focusTime +
    m.longestBlock * 0.6 +
    m.meetingFreeDays * 120 -
    m.fragments * 25 -
    m.earlyMeetings * 45 -
    m.lunchClashes * 60 -
    // Also priced in, not only forbidden: two fixed meetings can be jammed
    // together where nothing is movable, and the optimizer should still
    // prefer arrangements that add no more of them.
    m.tightTurnarounds * 50
  )
}

const SLOT = 15

/** Every legal (day, start) this event could move to, given who's attending. */
const candidateSlots = (
  event: CalEvent,
  others: CalEvent[],
  prefs: Prefs,
): Array<{ day: number; start: number }> => {
  // Moves stay inside the event's own week — nobody wants this week's sync
  // silently pushed to next week.
  const days = prefs.allowDayChange ? daysInWeek(weekOf(event.day)) : [event.day]
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
      const slot = { start, end: start + event.duration, duration: event.duration }
      if (overlaps(slot, lunch)) continue
      if (blocking.some((b) => overlaps(slot, { start: b.start, end: b.start + b.duration }))) continue
      if (crampsABreak(slot, blocking, prefs)) continue
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

// ---------------------------------------------------------------------------
// Booking a new meeting: "find a slot that works for us"
// ---------------------------------------------------------------------------

export interface MeetingRequest {
  title: string
  /** Everyone besides you. */
  attendees: PersonId[]
  durationMinutes: number
  timeOfDay: 'morning' | 'afternoon' | 'any'
  /** Inclusive horizon day indices. */
  earliestDay: number
  latestDay: number
}

export interface SlotProposal {
  day: number
  start: number
  /** Usable focus minutes this booking destroys, summed over all attendees. */
  focusCost: number
  perPerson: Array<{ person: PersonId; cost: number }>
}

/** Usable focus minutes in one person's day. */
const dayFocus = (events: CalEvent[], day: number, prefs: Prefs, person: PersonId): number =>
  gapsForDay(events, day, prefs, person)
    .map((g) => g.end - g.start)
    .filter((len) => len >= prefs.minFocusBlock)
    .reduce((a, b) => a + b, 0)

const window = (timeOfDay: MeetingRequest['timeOfDay'], prefs: Prefs): Interval =>
  timeOfDay === 'morning'
    ? { start: prefs.dayStart, end: prefs.lunchStart }
    : timeOfDay === 'afternoon'
      ? { start: prefs.lunchEnd, end: prefs.dayEnd }
      : { start: prefs.dayStart, end: prefs.dayEnd }

/**
 * Ranks every legal slot by what it *costs* rather than taking the first gap.
 * A meeting dropped into the middle of someone's three-hour block destroys the
 * whole block; the same meeting butted against an existing one costs nothing.
 * That difference is the entire point — so we score candidates by the focus
 * time they destroy across everyone attending, not just the requester.
 */
export const proposeSlots = (
  events: CalEvent[],
  prefs: Prefs,
  req: MeetingRequest,
  limit = 3,
): SlotProposal[] => {
  const people: PersonId[] = ['you', ...req.attendees.filter((a) => a !== 'you')]
  const win = window(req.timeOfDay, prefs)
  const earliest = Math.max(win.start, prefs.dayStart, prefs.noMeetingsBefore)
  const lunch = { start: prefs.lunchStart, end: prefs.lunchEnd }

  const lo = Math.max(0, Math.min(req.earliestDay, req.latestDay))
  const hi = Math.min(HORIZON_DAYS - 1, Math.max(req.earliestDay, req.latestDay))

  const out: SlotProposal[] = []

  for (let day = lo; day <= hi; day++) {
    const dayEvents = events.filter((e) => e.day === day)
    const focusBefore = new Map(people.map((p) => [p, dayFocus(events, day, prefs, p)]))

    for (let start = earliest; start + req.durationMinutes <= win.end; start += SLOT) {
      const slot = { start, end: start + req.durationMinutes }
      if (overlaps(slot, lunch)) continue

      const ours = dayEvents.filter((e) => e.attendees.some((a) => people.includes(a)))
      if (ours.some((e) => overlaps(slot, { start: e.start, end: e.start + e.duration }))) continue
      // Booking mustn't create the very back-to-back the optimizer just removed.
      if (crampsABreak({ ...slot, duration: req.durationMinutes }, ours, prefs)) continue

      const booked: CalEvent[] = [
        ...events,
        {
          id: '__proposed',
          title: req.title,
          day,
          start,
          duration: req.durationMinutes,
          flexible: true,
          attendees: people,
          kind: 'internal',
        },
      ]

      const perPerson = people.map((person) => ({
        person,
        cost: focusBefore.get(person)! - dayFocus(booked, day, prefs, person),
      }))

      out.push({
        day,
        start,
        focusCost: perPerson.reduce((a, b) => a + b.cost, 0),
        perPerson,
      })
    }
  }

  // Cheapest first; among equals, the soonest slot wins — a free slot two weeks
  // out is worse than an equally free one on Monday.
  out.sort((a, b) => a.focusCost - b.focusCost || a.day - b.day || a.start - b.start)
  return out.slice(0, limit)
}
