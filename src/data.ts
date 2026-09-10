import { TEAMMATES, type CalEvent, type EventKind, type PersonId } from './types'

let n = 0
const ev = (
  title: string,
  day: number,
  start: number,
  duration: number,
  flexible: boolean,
  attendees: PersonId[],
  kind: EventKind = 'internal',
): CalEvent => ({ id: `e${n++}`, title, day, start, duration, flexible, attendees: [...attendees], kind })

const at = (h: number, m = 0) => h * 60 + m

/** The meetings the whole team sits in. */
const ALL: PersonId[] = ['you', ...TEAMMATES]

/**
 * A deliberately shredded week: 30 meetings, almost no contiguous focus time.
 * Roughly half are `flexible`, which is what gives the optimizer room to work.
 */
export const DEMO_WEEK: CalEvent[] = [
  // ---- Monday
  ev('Standup', 0, at(9, 30), 15, false, ALL),
  ev('Design review', 0, at(10, 30), 45, true, ['you', 'sofia']),
  ev('Sync w/ Marc', 0, at(12, 0), 30, true, ['you', 'marc'], 'oneonone'),
  ev('Acme customer call', 0, at(14, 0), 60, false, ['you', 'sofia'], 'external'),
  ev('Sprint planning', 0, at(15, 0), 60, true, ['you', 'sofia', 'marc', 'lena']),
  ev('Bug triage', 0, at(17, 0), 30, true, ['you', 'marc']),

  // ---- Tuesday
  ev('Standup', 1, at(9, 30), 15, false, ALL),
  ev('1:1 Sofia', 1, at(10, 0), 30, true, ['you', 'sofia'], 'oneonone'),
  ev('Roadmap sync', 1, at(11, 15), 45, true, ['you', 'lena']),
  ev('Interview: candidate', 1, at(13, 30), 60, false, ['you'], 'external'),
  ev('Infra review', 1, at(15, 30), 45, true, ['you', 'misterT']),
  ev('Support handoff', 1, at(14, 30), 30, true, ['you', 'marc']),
  ev('Vendor demo', 1, at(16, 30), 45, false, ['you', 'lena'], 'external'),

  // ---- Wednesday
  ev('Standup', 2, at(9, 30), 15, false, ALL),
  ev('Architecture review', 2, at(10, 45), 60, true, ['you', 'marc', 'lena']),
  ev('Lunch & learn', 2, at(12, 0), 45, false, ['you', 'sofia', 'marc']),
  ev('Metrics review', 2, at(14, 0), 30, true, ['you', 'sofia']),
  ev('Partner call', 2, at(15, 15), 60, false, ['you'], 'external'),
  ev('1:1 Lena', 2, at(17, 0), 30, true, ['you', 'lena'], 'oneonone'),

  // ---- Thursday
  ev('Standup', 3, at(9, 30), 15, false, ALL),
  ev('All-hands', 3, at(10, 0), 45, false, ALL),
  ev('Experiment review', 3, at(11, 30), 30, true, ['you', 'sofia']),
  ev('Onboarding buddy sync', 3, at(13, 0), 30, true, ['you', 'lena']),
  ev('Security review', 3, at(14, 30), 60, true, ['you', 'lena']),
  ev('Investor update prep', 3, at(15, 30), 45, true, ['you', 'sofia']),

  // ---- Friday
  ev('Standup', 4, at(9, 30), 15, false, ALL),
  ev('Retro', 4, at(11, 0), 45, true, ['you', 'sofia', 'marc', 'lena']),
  ev('Board deck review', 4, at(12, 0), 60, false, ['you', 'sofia'], 'external'),
  ev('1:1 Marc', 4, at(14, 0), 30, true, ['you', 'marc'], 'oneonone'),
  ev('Demo Friday', 4, at(15, 0), 60, false, ALL),
  ev('Weekly wrap', 4, at(16, 0), 30, true, ['you', 'marc']),

  // ---- Teammate-only commitments: invisible on your calendar, but they
  // constrain where a shared meeting can legally move to.
  ev('Sofia: recruiting', 0, at(11, 30), 90, false, ['sofia']),
  ev('Sofia: brand workshop', 2, at(9, 45), 120, false, ['sofia']),
  ev('Sofia: offsite prep', 3, at(13, 0), 120, false, ['sofia']),
  ev('Marc: on-call review', 1, at(9, 45), 60, false, ['marc']),
  ev('Marc: deep work', 2, at(13, 0), 180, false, ['marc']),
  ev('Marc: hiring loop', 4, at(12, 0), 90, false, ['marc']),
  ev('Lena: legal review', 0, at(16, 30), 90, false, ['lena']),
  ev('Lena: conference talk', 3, at(11, 0), 90, false, ['lena']),
  ev('Lena: budget planning', 4, at(13, 0), 120, false, ['lena']),
  ev('Mister T: security audit', 0, at(10, 0), 90, false, ['misterT']),
  ev('Mister T: pen test window', 1, at(10, 30), 120, false, ['misterT']),
  ev('Mister T: vendor assessment', 3, at(11, 0), 120, false, ['misterT']),
  ev('Laura: customer onboarding', 0, at(13, 30), 90, false, ['laura']),
  ev('Laura: QBR prep', 2, at(10, 0), 150, false, ['laura']),
  ev('Laura: partner escalation', 4, at(10, 0), 90, false, ['laura']),
  ev('Nadine: research interviews', 1, at(10, 0), 120, false, ['nadine']),
  ev('Nadine: usability sessions', 2, at(13, 0), 120, false, ['nadine']),
  ev('Nadine: design system audit', 3, at(13, 30), 150, false, ['nadine']),

  // ================= Week 2 — emptier, which is where a "next two weeks"
  // request usually finds room.
  ev('Standup', 5, at(9, 30), 15, false, ALL),
  ev('Q3 planning kickoff', 5, at(11, 0), 90, false, ['you', 'sofia', 'marc', 'lena']),
  ev('Pipeline review', 5, at(15, 0), 45, true, ['you', 'sofia']),

  ev('Standup', 6, at(9, 30), 15, false, ALL),
  ev('Onboarding review', 6, at(11, 0), 45, true, ['you', 'laura']),
  ev('Design crit', 6, at(13, 30), 60, true, ['you', 'sofia']),
  ev('Renewal call: Globex', 6, at(16, 0), 45, false, ['you'], 'external'),

  ev('Standup', 7, at(9, 30), 15, false, ALL),
  ev('Incident postmortem', 7, at(11, 0), 60, true, ['you', 'marc', 'lena']),
  ev('Research readout', 7, at(13, 30), 60, true, ['you', 'nadine']),
  ev('Hiring sync', 7, at(15, 30), 30, true, ['you', 'lena']),

  ev('Standup', 8, at(9, 30), 15, false, ALL),
  ev('All-hands', 8, at(10, 0), 45, false, ALL),
  ev('Roadmap deep dive', 8, at(14, 0), 90, true, ['you', 'sofia', 'marc']),

  ev('Standup', 9, at(9, 30), 15, false, ALL),
  ev('Retro', 9, at(11, 0), 45, true, ['you', 'sofia', 'marc', 'lena']),
  ev('Demo Friday', 9, at(15, 0), 60, false, ALL),

  // teammate-only, week 2
  ev('Sofia: customer visit', 6, at(9, 45), 150, false, ['sofia']),
  ev('Sofia: content review', 8, at(11, 0), 90, false, ['sofia']),
  ev('Marc: platform migration', 5, at(13, 0), 180, false, ['marc']),
  ev('Marc: on-call', 7, at(13, 0), 120, false, ['marc']),
  ev('Lena: compliance audit', 6, at(11, 0), 120, false, ['lena']),
  ev('Lena: 1:1s block', 9, at(13, 0), 120, false, ['lena']),
  ev('Mister T: infra migration', 5, at(13, 0), 180, false, ['misterT']),
  ev('Mister T: incident drill', 8, at(11, 0), 90, false, ['misterT']),
  ev('Laura: renewals push', 5, at(10, 0), 60, false, ['laura']),
  ev('Laura: forecast review', 7, at(10, 0), 120, false, ['laura']),
  ev('Laura: pipeline review', 9, at(13, 0), 90, false, ['laura']),
  ev('Nadine: user research synthesis', 6, at(10, 0), 90, false, ['nadine']),
  ev('Nadine: portfolio review', 8, at(13, 0), 90, false, ['nadine']),
  ev('Nadine: interview panel', 9, at(10, 0), 120, false, ['nadine']),
]

export const loadDemoWeek = (): CalEvent[] => DEMO_WEEK.map((e) => ({ ...e }))
