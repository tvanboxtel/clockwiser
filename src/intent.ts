import { z } from 'zod'
import type { MeetingRequest } from './optimizer'
import { DAYS, HORIZON, HORIZON_DAYS, PEOPLE, TEAMMATES, type PersonId, type Teammate } from './types'

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

/** The roster and calendar horizon Claude needs to resolve a spoken request. */
export const buildSystemPrompt = () => {
  const roster = TEAMMATES.map((id) => `  ${id} = ${PEOPLE[id].name}`).join('\n')
  const horizon = HORIZON.map((h) => `  ${h.day} = ${h.label}${h.week === 1 ? ' (next week)' : ' (this week)'}`).join('\n')

  return `You turn spoken scheduling requests into structured meeting requests.

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
  "Mister T" and "mr. t" all mean misterT — but return the id, not the name.`
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
