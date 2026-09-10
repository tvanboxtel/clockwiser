import { useState } from 'react'
import { FrogSvg } from './Frog'
import { PrefsCard, QUESTIONS } from './PrefsQuestions'
import type { Prefs } from './types'

/**
 * Asked once, on a first visit. Optimizing somebody's week without asking them
 * anything is a guess, but six questions in the middle of the app is clutter —
 * so they live here, two at a time, and the main screen stays quiet afterwards.
 */
const STEPS = [
  {
    title: 'First, your working day',
    blurb: 'When are you actually available? Nothing gets moved outside this.',
    fields: ['noMeetingsBefore', 'dayEnd', 'allowDayChange'],
  },
  {
    title: 'Now, your focus',
    blurb: 'How much uninterrupted time counts as real focus time — and how much room you need to breathe.',
    fields: ['minFocusBlock', 'breakAfterLongMeetings', 'longMeetingMinutes'],
  },
] as const

export function Onboarding({
  prefs,
  setPrefs,
  onDone,
}: {
  prefs: Prefs
  setPrefs: (p: Prefs) => void
  onDone: (skipped: boolean) => void
}) {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const here = STEPS[step]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-canvas/90 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        className="w-full max-w-2xl rounded-3xl border border-line bg-panel p-8 shadow-[0_30px_60px_-24px_rgba(0,0,0,0.35)]"
      >
        <div className="flex items-start gap-4">
          <span className="onboard-frog shrink-0">
            <FrogSvg />
          </span>
          <div>
            <h1 id="onboard-title" className="text-lg font-semibold text-fg">
              Let's clean your pond
            </h1>
            <p className="mt-1 text-sm text-muted">
              Your focus time isn't missing — it's in pieces. Answer this and I'll go and put it back together.
            </p>
          </div>
        </div>

        <div className="mt-7">
          <h2 className="text-sm font-semibold text-fg">{here.title}</h2>
          <p className="mt-0.5 text-xs text-muted">{here.blurb}</p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {here.fields.map((f) => (
              <PrefsCard
                key={f}
                question={QUESTIONS.find((q) => q.field === f)!}
                prefs={prefs}
                setPrefs={setPrefs}
              />
            ))}
          </div>
        </div>

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-body transition hover:bg-hover"
            >
              Back
            </button>
          )}

          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-accent' : 'w-1.5 bg-line'}`}
              />
            ))}
          </div>

          <button
            onClick={() => (last ? onDone(false) : setStep((s) => s + 1))}
            className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg shadow-[0_10px_22px_-8px_var(--accent-glow)] transition hover:bg-accent-hover"
          >
            {last ? 'Clean my pond →' : 'Next'}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[11px] text-subtle">
          <span>You can change any of this later — or just tell the frog.</span>
          <button onClick={() => onDone(true)} className="transition hover:text-body">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
