import { z } from 'zod'
import type { MeetingRequest } from './optimizer'
import {
  DAYS,
  HORIZON,
  HORIZON_DAYS,
  PEOPLE,
  TEAMMATES,
  fmt,
  fmtDuration,
  type PersonId,
  type Prefs,
  type Teammate,
} from './types'

/** Shared by the server-side Claude call and the client's type expectations. */
export const MeetingRequestSchema = z.object({
  title: z.string().describe('Short calendar title, e.g. "Sync with Sofia"'),
  attendees: z
    .array(z.enum(TEAMMATES))
    .describe('Everyone to invite besides the speaker. Empty if nobody was named.'),
  durationMinutes: z
    .number()
    .describe('Meeting length in minutes. Default to 30 if unstated.'),
  timeOfDay: z
    .enum(['morning', 'afternoon', 'any'])
    .describe('Time-of-day preference the speaker expressed.'),
  earliestDay: z
    .number()
    .describe('Earliest acceptable day, as an index into the horizon table.'),
  latestDay: z
    .number()
    .describe('Latest acceptable day, as an index into the horizon table.'),
})

export type ParsedRequest = z.infer<typeof MeetingRequestSchema>

/**
 * How you want the week optimized, rather than a thing to put in it. Every
 * field is nullable and means "leave this as it is" — a sentence about breaks
 * shouldn't silently rewrite your lunch.
 */
export const TuneSchema = z.object({
  noMeetingsBefore: z
    .number()
    .nullable()
    .describe('Earliest a meeting may start, as minutes from midnight (9am = 540). Null if unmentioned.'),
  dayEnd: z
    .number()
    .nullable()
    .describe('End of the working day, as minutes from midnight (6pm = 1080). Null if unmentioned.'),
  minFocusBlock: z
    .number()
    .nullable()
    .describe('Shortest gap that is actually useful for deep work, in minutes. Null if unmentioned.'),
  breakAfterLongMeetings: z
    .number()
    .nullable()
    .describe(
      'Minutes of breathing room to keep free after a long meeting. Use 0 when they explicitly do not want breaks, 15 for "a bit"/"a breather", 30 for "a proper break". Null if unmentioned.',
    ),
  longMeetingMinutes: z
    .number()
    .nullable()
    .describe('How long a meeting must be to count as "long", in minutes. Null unless they said so.'),
  lunchStart: z.number().nullable().describe('Start of protected lunch, minutes from midnight. Null if unmentioned.'),
  lunchEnd: z.number().nullable().describe('End of protected lunch, minutes from midnight. Null if unmentioned.'),
  allowDayChange: z
    .boolean()
    .nullable()
    .describe('Whether meetings may move to a different weekday. Null if unmentioned.'),
  summary: z
    .string()
    .describe('One short second-person sentence describing what you understood, e.g. "15 minutes to breathe after any meeting over an hour."'),
})

export type ParsedTune = z.infer<typeof TuneSchema>

/**
 * The input has two meanings — "find me a slot" and "here's how I like my week
 * to work" — and people won't tell you which one they're using, so Claude
 * decides. Nullable branches beat a discriminated union here: structured output
 * fills them reliably and the client just checks `kind`.
 */
export const IntentSchema = z.object({
  kind: z
    .enum(['meeting', 'tune'])
    .describe(
      '"meeting" when they want something scheduled. "tune" when they are describing how their calendar should be arranged, e.g. asking for breaks, protected mornings or an earlier finish.',
    ),
  meeting: MeetingRequestSchema.nullable().describe('Filled when kind is "meeting", otherwise null.'),
  tune: TuneSchema.nullable().describe('Filled when kind is "tune", otherwise null.'),
})

export type ParsedIntent = z.infer<typeof IntentSchema>

/** The roster and calendar horizon Claude needs to resolve a spoken request. */
export const buildSystemPrompt = () => {
  const roster = TEAMMATES.map((id) => `  ${id} = ${PEOPLE[id].name}`).join('\n')
  const horizon = HORIZON.map((h) => `  ${h.day} = ${h.label}${h.week === 1 ? ' (next week)' : ' (this week)'}`).join('\n')

  return `You turn spoken calendar requests into structured data. A request is
either a meeting to schedule ("kind": "meeting") or a change to how the week
should be optimized ("kind": "tune").

People who can be invited:
${roster}

The calendar horizon is ${HORIZON_DAYS} working days. Resolve all dates to these indices:
${horizon}

Rules:
- "next two weeks" or no stated timeframe spans the whole horizon: 0 to ${HORIZON_DAYS - 1}.
- "this week" is 0-4. "next week" is 5-9.
- A bare weekday ("on Thursday") means the soonest matching day; if the speaker
  also says "or later" or "any", widen the range to every matching weekday.
- Default duration is 30 minutes. "quick" means 15, "a chat" means 30, "a
  workshop" or "deep dive" means 90.
- Only choose "morning" or "afternoon" if the speaker actually expressed a
  preference; otherwise "any".
- Never invent an attendee who was not named. Match names loosely — "Mr T",
  "Mister T" and "mr. t" all mean misterT — but return the id, not the name.

Rules for "tune":
- Set only the fields they actually talked about; leave the rest null.
- All times are minutes from midnight in their local working day.
- "breaks after long meetings" with no length given means 15 minutes after
  meetings of 60 minutes or more.
- "protect my mornings" means noMeetingsBefore 660 (11:00) unless they name a time.
- "I want to finish early" means dayEnd 1020 (17:00) unless they name a time.
- Asking to optimize, defragment or clean up the calendar is "tune" even when
  no specific preference is attached — return an empty-ish tune with a summary.
- A sentence can mention a person and still be "tune" ("stop stacking Sofia's
  reviews back to back"); what matters is whether they want something booked.`
}

/** Resolve a parsed request into the optimizer's input shape. */
export const toMeetingRequest = (p: ParsedRequest): MeetingRequest => ({
  title: p.title,
  attendees: p.attendees as PersonId[],
  durationMinutes: Math.min(240, Math.max(15, Math.round(p.durationMinutes / 15) * 15)),
  timeOfDay: p.timeOfDay,
  earliestDay: Math.max(0, Math.min(HORIZON_DAYS - 1, p.earliestDay)),
  latestDay: Math.max(0, Math.min(HORIZON_DAYS - 1, p.latestDay)),
})

// ---------------------------------------------------------------------------
// Local fallback parser
// ---------------------------------------------------------------------------

/**
 * Deliberately dumb, and deliberately present: it covers the phrasings a demo
 * actually uses so a missing API key, a cold network or a rate limit can't take
 * the feature down mid-presentation. Claude handles everything this misses.
 */
const NAME_PATTERNS: Record<Teammate, RegExp> = {
  sofia: /\bsofia\b/,
  marc: /\bmarc\b/,
  lena: /\blena\b/,
  // Speech-to-text renders this any number of ways.
  misterT: /\b(?:mister|mr\.?)\s*t\b/,
  laura: /\blaura\b/,
  nadine: /\bnadine\b/,
}

export const parseLocally = (text: string): ParsedRequest => {
  const t = text.toLowerCase()

  const attendees = TEAMMATES.filter((id) => NAME_PATTERNS[id].test(t))

  let durationMinutes = 30
  const mins = t.match(/(\d+)\s*(?:min|minute)/)
  const hrs = t.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hr|hour)/)
  if (mins) durationMinutes = Number(mins[1])
  else if (hrs) durationMinutes = Math.round(Number(hrs[1]) * 60)
  else if (/half an hour/.test(t)) durationMinutes = 30
  else if (/\ban hour\b/.test(t)) durationMinutes = 60
  else if (/\bquick\b/.test(t)) durationMinutes = 15
  else if (/workshop|deep dive/.test(t)) durationMinutes = 90

  const timeOfDay = /morning/.test(t)
    ? 'morning'
    : /afternoon|after lunch/.test(t)
      ? 'afternoon'
      : 'any'

  let earliestDay = 0
  let latestDay = HORIZON_DAYS - 1
  if (/next week/.test(t)) {
    earliestDay = 5
    latestDay = 9
  } else if (/this week/.test(t)) {
    earliestDay = 0
    latestDay = 4
  }

  // A named weekday narrows to that column across whatever range we settled on.
  const weekdayIdx = DAYS.findIndex((d, i) =>
    new RegExp(`\\b${d.toLowerCase()}|${['monday', 'tuesday', 'wednesday', 'thursday', 'friday'][i]}\\b`).test(t),
  )
  if (weekdayIdx >= 0) {
    const match = HORIZON.filter(
      (h) => h.day % 5 === weekdayIdx && h.day >= earliestDay && h.day <= latestDay,
    )
    if (match.length > 0) {
      earliestDay = match[0].day
      latestDay = match[match.length - 1].day
    }
  }

  const names = attendees.map((a) => PEOPLE[a].name).join(' & ')
  return {
    title: names ? `Meeting with ${names}` : 'New meeting',
    attendees: [...attendees],
    durationMinutes,
    timeOfDay,
    earliestDay,
    latestDay,
  }
}

// ---------------------------------------------------------------------------
// Applying a tune
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Everything in this app lives on a 15-minute grid; keep spoken values on it. */
const grid = (v: number) => Math.round(v / 15) * 15

/** Fold the fields Claude actually filled in over the current preferences. */
export const applyTune = (prefs: Prefs, t: ParsedTune): Prefs => {
  const next = { ...prefs }
  if (t.noMeetingsBefore != null) next.noMeetingsBefore = clamp(grid(t.noMeetingsBefore), 6 * 60, 14 * 60)
  if (t.dayEnd != null) next.dayEnd = clamp(grid(t.dayEnd), 13 * 60, 22 * 60)
  if (t.minFocusBlock != null) next.minFocusBlock = clamp(grid(t.minFocusBlock), 30, 240)
  if (t.breakAfterLongMeetings != null) next.breakAfterLongMeetings = clamp(grid(t.breakAfterLongMeetings), 0, 60)
  if (t.longMeetingMinutes != null) next.longMeetingMinutes = clamp(grid(t.longMeetingMinutes), 30, 240)
  if (t.lunchStart != null) next.lunchStart = clamp(grid(t.lunchStart), 11 * 60, 14 * 60)
  if (t.lunchEnd != null) next.lunchEnd = clamp(grid(t.lunchEnd), next.lunchStart + 15, 15 * 60)
  if (t.allowDayChange != null) next.allowDayChange = t.allowDayChange
  // The day has to stay wide enough to hold a working day.
  next.dayStart = Math.min(next.dayStart, next.noMeetingsBefore)
  return next
}

/** What actually changed, in words — for when the model's summary is missing. */
export const describeTune = (before: Prefs, after: Prefs): string => {
  const bits: string[] = []
  if (after.breakAfterLongMeetings !== before.breakAfterLongMeetings)
    bits.push(
      after.breakAfterLongMeetings === 0
        ? 'no breaks needed'
        : `${fmtDuration(after.breakAfterLongMeetings)} after meetings over ${fmtDuration(after.longMeetingMinutes)}`,
    )
  else if (after.longMeetingMinutes !== before.longMeetingMinutes)
    bits.push(`"long" now means over ${fmtDuration(after.longMeetingMinutes)}`)
  if (after.noMeetingsBefore !== before.noMeetingsBefore) bits.push(`nothing before ${fmt(after.noMeetingsBefore)}`)
  if (after.dayEnd !== before.dayEnd) bits.push(`done by ${fmt(after.dayEnd)}`)
  if (after.minFocusBlock !== before.minFocusBlock) bits.push(`focus blocks of ${fmtDuration(after.minFocusBlock)}+`)
  if (after.lunchStart !== before.lunchStart || after.lunchEnd !== before.lunchEnd)
    bits.push(`lunch ${fmt(after.lunchStart)}–${fmt(after.lunchEnd)}`)
  if (after.allowDayChange !== before.allowDayChange)
    bits.push(after.allowDayChange ? 'may move across days' : 'same day only')
  return bits.length > 0 ? bits.join(' · ') : 'nothing new — re-running with your current preferences'
}

// ---------------------------------------------------------------------------
// Local fallback: which kind of request is this, and what did it say?
// ---------------------------------------------------------------------------

/** "half four" is beyond us, but "4pm", "16:00" and "at 10" are not. */
const clockTime = (t: string): number | null => {
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.)?/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const suffix = m[3]?.[0]
  if (h > 23 || min > 59) return null
  if (suffix === 'p' && h < 12) h += 12
  else if (suffix === 'a' && h === 12) h = 0
  // No am/pm and an implausibly early hour: a working day means the afternoon.
  else if (!suffix && h < 7) h += 12
  return h * 60 + min
}

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60, ninety: 90,
}
const num = (word: string): number | null => {
  const n = Number(word)
  return Number.isFinite(n) ? n : (WORD_NUM[word.replace(/[\s-]/g, '')] ?? null)
}

/** "90 minutes", "two-hour", "an hour", "half an hour" → minutes. */
const duration = (t: string): number | null => {
  if (/half an hour/.test(t)) return 30
  const m = t.match(
    /(\d+(?:\.\d+)?|a|an|one|two|three|four|fifteen|twenty|thirty|forty[\s-]?five|sixty|ninety)[\s-]*(h\b|hrs?\b|hours?\b|min\w*)/,
  )
  if (!m) return null
  const n = num(m[1])
  if (n == null) return null
  return /^m/.test(m[2]) ? Math.round(n) : Math.round(n * 60)
}

/**
 * People say two things in one breath — "protect my mornings and finish by 5"
 * — so each rule reads only its own clause. Scanning the whole sentence lets
 * the time from one preference land on another.
 */
const clauses = (t: string): string[] =>
  t.split(/[,;.]|\band\b|\bbut\b|\balso\b|\bplus\b/).map((c) => c.trim()).filter(Boolean)

/** The tune half of the local parser. Returns null if it heard no preference. */
export const parseTuneLocally = (text: string): ParsedTune | null => {
  const whole = text.toLowerCase()
  const out: ParsedTune = {
    noMeetingsBefore: null,
    dayEnd: null,
    minFocusBlock: null,
    breakAfterLongMeetings: null,
    longMeetingMinutes: null,
    lunchStart: null,
    lunchEnd: null,
    allowDayChange: null,
    summary: '',
  }
  let hit = false

  for (const c of clauses(whole)) {
    if (/break|breath|buffer|back.to.back|recover|decompress|gap between/.test(c)) {
      hit = true
      if (/\b(?:no|without|don'?t (?:want|need)|skip|zero)\b/.test(c)) {
        out.breakAfterLongMeetings = 0
      } else {
        // "30 minutes to breathe after anything over an hour" holds two
        // durations: the break, then what counts as long.
        const over = c.match(/(?:longer than|more than|over|above|beyond|from)\s+(.*)$/)
        const gapText = over ? c.slice(0, c.indexOf(over[0])) : c
        out.breakAfterLongMeetings =
          duration(gapText) ?? (/proper|decent|real|long break/.test(c) ? 30 : 15)
        const long = over ? duration(over[1]) : null
        out.longMeetingMinutes = long ?? out.longMeetingMinutes ?? 60
      }
    }

    if (/protect (?:my )?morning|keep (?:my )?morning|(?:no meetings?|nothing|anything|meetings?)\s*(?:starting )?before|not before|start(?:ing)? (?:at|from)/.test(c)) {
      hit = true
      out.noMeetingsBefore = clockTime(c) ?? 11 * 60
    }

    if (/finish\w*\s*(?:by|at|early)|done\s*(?:by|at)|wrap up|nothing after|no meetings? after|end (?:my|the) day/.test(c)) {
      hit = true
      out.dayEnd = clockTime(c) ?? 17 * 60
    }

    if (/focus|block|chunk|stretch|deep work/.test(c)) {
      const d = duration(c)
      if (d != null) {
        hit = true
        out.minFocusBlock = d
      }
    }

    if (/lunch/.test(c)) {
      const at = clockTime(c)
      if (at != null) {
        hit = true
        out.lunchStart = at
        out.lunchEnd = at + 45
      }
    }

    if (/same day|don'?t move|stay(?: on)? (?:the )?same|keep (?:them|things|it) where/.test(c)) {
      hit = true
      out.allowDayChange = false
    } else if (/any day|move (?:them|things|meetings|stuff) (?:across|between|to another)/.test(c)) {
      hit = true
      out.allowDayChange = true
    }
  }

  // "optimize my calendar" on its own is still a tune — just an empty one.
  if (!hit && /optimi[sz]e|defrag|clean up|rearrange|sort out|tidy/.test(whole)) hit = true
  return hit ? out : null
}

const BOOKING =
  /\b(?:book|schedule|set up|invite|find (?:me )?(?:a |some )?(?:slot|time)|slot|meet|meeting|catch ?up|sync|chat|call|workshop|one on one|1:1)\b/

/**
 * Routes locally the same way the prompt asks Claude to: a preference beats a
 * booking only when nothing about the sentence asks for a meeting.
 */
export const parseIntentLocally = (text: string): ParsedIntent => {
  const t = text.toLowerCase()
  const tune = parseTuneLocally(t)
  const wantsBooking = BOOKING.test(t) && TEAMMATES.some((id) => NAME_PATTERNS[id].test(t))
  if (tune && !wantsBooking) return { kind: 'tune', meeting: null, tune }
  return { kind: 'meeting', meeting: parseLocally(text), tune: null }
}
