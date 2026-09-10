/**
 * Calendar domain model.
 *
 * Everything downstream (optimizer, UI) only knows about `CalEvent`, so any
 * source can feed the app: the hardcoded demo week, an .ics import, or a real
 * Google Calendar sync later on.
 */

export type PersonId = 'you' | 'sofia' | 'marc' | 'lena'

export const PEOPLE: Record<PersonId, { name: string; color: string }> = {
  you: { name: 'You', color: '#6366f1' },
  sofia: { name: 'Sofia', color: '#ec4899' },
  marc: { name: 'Marc', color: '#f59e0b' },
  lena: { name: 'Lena', color: '#10b981' },
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
