# Clockwiser

> Like clockwise but one better, innit?

Focus time, defragmented. A hackathon take on [Clockwise](https://www.getclockwise.com/):
give it a shredded week of meetings and it rearranges the *flexible* ones —
around everyone's real availability — into contiguous blocks you can actually
think in.

The pitch in one line: **total free time doesn't change, usable free time does.**
Across the demo's two weeks, 67 hours are free either way. Before optimizing,
29h 30m of that sits in gaps long enough to use. After, 54h do. Nothing was
cancelled and nothing was shortened.

## Run it

```bash
bun install
bun run dev
```

Voice parsing needs a key — without one the app falls back to a local parser
and still works:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run dev
```

## How it works

| File | Role |
|---|---|
| `src/types.ts` | `CalEvent` + `Prefs` domain model — the seam any data source plugs into |
| `src/data.ts` | Demo week: 30 events plus teammate-only commitments that constrain moves |
| `src/optimizer.ts` | The scheduler |
| `src/App.tsx` | Week grid, animated moves, live focus-time stats |
| `src/intent.ts` | Spoken-request schema, Claude prompt, local fallback parser |
| `src/useSpeech.ts` | Web Speech API hook |
| `server/parse-plugin.ts` | Dev endpoint that calls Claude, keeping the key server-side |

Events are either **fixed** (customer calls, all-hands, standup — never touched)
or **flexible** (internal syncs, 1:1s). The optimizer places every flexible
event on a 15-minute grid, checking each candidate slot against the calendars of
*all* its attendees, not just yours. It runs a randomized greedy pass with 40
restarts and keeps the best schedule; a single greedy pass gets trapped by
whichever meeting happens to be placed first. ~70ms for the demo week.

### Ask for a meeting out loud

> *"I need 30 minutes with Sofia in the morning sometime in the next two weeks"*

Speech goes through the Web Speech API to `POST /api/parse`, where **Claude
Opus 5** turns it into a structured `MeetingRequest` via structured outputs
(`output_config.format` + a Zod schema) — attendees, duration, time-of-day, and
a resolved day range over the two-week horizon.

Claude parses the language; **it never picks the slot.** That's deliberate — slot
selection is a search problem with hard constraints, and code does it exactly.
`proposeSlots()` enumerates every legal 15-minute slot and ranks the top three by
what each one *costs*: a meeting dropped into the middle of someone's
three-hour block destroys the whole block, while the same meeting butted against
an existing one costs nothing. The cost is summed across everyone attending, so
"a slot that works for us" means one that's cheap for the whole group, not just
free on your calendar. Booking pins the event so a later Optimize works around
it.

If the API key is missing, the network is down, or Claude refuses, the client
silently falls back to a regex parser in `parseLocally()` that covers the demo
phrasings. A live demo should not have a single point of failure.

### The defrag

The objective rewards focus minutes, pays a bonus for one genuinely long block
and for meeting-free days, and charges for fragmentation.

Working hours, protected mornings and lunch are **hard constraints on placement,
not scoring penalties**. Scored as penalties, the optimizer happily buys itself a
huge afternoon block by cramming meetings into the morning you asked it to
protect — it made mornings measurably worse than the input.

## Not done yet

- Natural-language *preferences* ("protect my mornings, I need 3 hours Thursday")
  — currently only meeting requests are parsed, not `Prefs` changes
- `.ics` import — slots in behind `loadDemoWeek()` without touching optimizer or UI
- Optimizing for the *team's* total focus time rather than one person's
- Pin an event by dragging it, then re-optimize around it
