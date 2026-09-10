/**
 * Calendar domain model.
 *
 * Everything downstream (optimizer, UI) only knows about `CalEvent`, so any
 * source can feed the app: the hardcoded demo week, an .ics import, or a real
 * Google Calendar sync later on.
 */

export type PersonId = 'you' | 'sofia' | 'marc' | 'lena'

/** `color` is a CSS variable so each theme can retune the roster (see index.css). */
export const PEOPLE: Record<PersonId, { name: string; color: string }> = {
  you: { name: 'You', color: 'var(--person-you)' },
  sofia: { name: 'Sofia', color: 'var(--person-sofia)' },
  marc: { name: 'Marc', color: 'var(--person-marc)' },
  lena: { name: 'Lena', color: 'var(--person-lena)' },
}

export type EventKind = 'external' | 'internal' | 'oneonone' | 'focus' | 'personal'

export interface CalEvent {
  id: string
  title: string
  /** 0 = Monday … 4 = Friday */
  day: number
  /** minutes from midnight, e.g. 570 = 09:30 */
  start: number
  /** minutes */
  duration: number
  /** Flexible events are the ones the optimizer is allowed to move. */
  flexible: boolean
  attendees: PersonId[]
  kind: EventKind
}

/** The window the optimizer is allowed to schedule inside. */
export interface Prefs {
  dayStart: number
  dayEnd: number
  /** Meetings before this hurt the score (but aren't forbidden). */
  noMeetingsBefore: number
  lunchStart: number
  lunchEnd: number
  /** Minimum length of a gap that counts as usable focus time. */
  minFocusBlock: number
  /** Allow moving a flexible meeting to a different weekday. */
  allowDayChange: boolean
}

export const DEFAULT_PREFS: Prefs = {
  dayStart: 9 * 60,
  dayEnd: 18 * 60,
  noMeetingsBefore: 10 * 60,
  lunchStart: 12 * 60 + 30,
  lunchEnd: 13 * 60 + 15,
  minFocusBlock: 90,
  allowDayChange: true,
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** Two working weeks — enough to honour "sometime in the next two weeks". */
export const HORIZON_DAYS = 10

export const weekOf = (day: number) => Math.floor(day / 5)
export const daysInWeek = (week: number) => [0, 1, 2, 3, 4].map((d) => week * 5 + d)

/** Monday of next week, so every day in the horizon is in the future. */
const nextMonday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return d
}

export interface HorizonDay {
  day: number
  week: number
  weekday: string
  date: Date
  /** e.g. "Mon 14 Sep" */
  label: string
}

export const HORIZON: HorizonDay[] = Array.from({ length: HORIZON_DAYS }, (_, i) => {
  const date = new Date(nextMonday())
  date.setDate(date.getDate() + Math.floor(i / 5) * 7 + (i % 5))
  return {
    day: i,
    week: weekOf(i),
    weekday: DAYS[i % 5],
    date,
    label: `${DAYS[i % 5]} ${date.getDate()} ${date.toLocaleString('en', { month: 'short' })}`,
  }
})

export const fmt = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const fmtDuration = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
