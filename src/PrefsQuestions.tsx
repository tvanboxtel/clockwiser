import type { Prefs } from './types'

/**
 * The questions Clockwiser asks before it rearranges anything, and the only
 * place they're defined. Each maps to a single preference, which is what keeps
 * this honest: every answer visibly changes a constraint the optimizer has to
 * respect. Asked once at onboarding, changeable forever after in Preferences.
 */
export const QUESTIONS: Array<{
  q: string
  hint: string
  field: keyof Prefs
  opts: Array<{ label: string; value: number | boolean }>
}> = [
  {
    q: 'Earliest a meeting may start',
    hint: 'Mornings are protected before this.',
    field: 'noMeetingsBefore',
    opts: [
      { label: '9:00', value: 9 * 60 },
      { label: '10:00', value: 10 * 60 },
      { label: '11:00', value: 11 * 60 },
    ],
  },
  {
    q: 'Your day ends at',
    hint: 'Nothing gets moved past it.',
    field: 'dayEnd',
    opts: [
      { label: '17:00', value: 17 * 60 },
      { label: '18:00', value: 18 * 60 },
      { label: '19:00', value: 19 * 60 },
    ],
  },
  {
    q: 'May meetings move to another day?',
    hint: 'Off keeps everything on its own day.',
    field: 'allowDayChange',
    opts: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
  {
    q: 'Shortest block worth having',
    hint: 'Gaps under this count as dead time.',
    field: 'minFocusBlock',
    opts: [
      { label: '1 hr', value: 60 },
      { label: '1 hr 30', value: 90 },
      { label: '2 hr', value: 120 },
    ],
  },
  {
    q: 'Breathing room after a long meeting',
    hint: 'Kept clear, never booked over.',
    field: 'breakAfterLongMeetings',
    opts: [
      { label: 'None', value: 0 },
      { label: '15 min', value: 15 },
      { label: '30 min', value: 30 },
    ],
  },
  {
    q: 'A meeting is “long” from',
    hint: 'Only matters with breaks on.',
    field: 'longMeetingMinutes',
    opts: [
      { label: '45 min', value: 45 },
      { label: '1 hr', value: 60 },
      { label: '1 hr 30', value: 90 },
    ],
  },
]

/** One question. Rendered by both the onboarding and the Preferences popover. */
export function PrefsCard({
  question,
  prefs,
  setPrefs,
}: {
  question: (typeof QUESTIONS)[number]
  prefs: Prefs
  setPrefs: (p: Prefs) => void
}) {
  // Asking what counts as "long" is noise until breaks are switched on.
  const moot = question.field === 'longMeetingMinutes' && prefs.breakAfterLongMeetings === 0

  return (
    <div className={`rounded-xl border border-line bg-panel-soft px-4 py-3 transition ${moot ? 'opacity-40' : ''}`}>
      <div className="text-xs font-semibold text-body">{question.q}</div>
      <div className="mt-0.5 text-[11px] text-subtle">{question.hint}</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {question.opts.map((o) => {
          const active = prefs[question.field] === o.value
          return (
            <button
              key={String(o.value)}
              disabled={moot}
              aria-pressed={active}
              // The field/value pairing is checked in QUESTIONS above; the
              // spread just can't prove it to the compiler.
              onClick={() => setPrefs({ ...prefs, [question.field]: o.value } as Prefs)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                active ? 'bg-accent text-accent-fg' : 'bg-hover text-muted hover:text-body'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PrefsGrid({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {QUESTIONS.map((q) => (
        <PrefsCard key={q.field} question={q} prefs={prefs} setPrefs={setPrefs} />
      ))}
    </div>
  )
}
