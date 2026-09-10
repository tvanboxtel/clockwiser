# Clockwiser

> Like clockwise but one better, innit?

Focus time, defragmented. A hackathon take on [Clockwise](https://www.getclockwise.com/):
give it a shredded week of meetings and it rearranges the *flexible* ones —
around everyone's real availability — into contiguous blocks you can actually
think in.

The pitch in one line: **total free time doesn't change, usable free time does.**
On the demo week, 25.5 hours are free either way. Before optimizing, 3 hours of
that sit in gaps long enough to use. After, 22h 45m do. Nothing was cancelled
and nothing was shortened.

## Run it

```bash
bun install
bun run dev
```

## How it works

| File | Role |
|---|---|
| `src/types.ts` | `CalEvent` + `Prefs` domain model — the seam any data source plugs into |
| `src/data.ts` | Demo week: 30 events plus teammate-only commitments that constrain moves |
| `src/optimizer.ts` | The scheduler |
| `src/App.tsx` | Week grid, animated moves, live focus-time stats |

Events are either **fixed** (customer calls, all-hands, standup — never touched)
or **flexible** (internal syncs, 1:1s). The optimizer places every flexible
event on a 15-minute grid, checking each candidate slot against the calendars of
*all* its attendees, not just yours. It runs a randomized greedy pass with 40
restarts and keeps the best schedule; a single greedy pass gets trapped by
whichever meeting happens to be placed first. ~70ms for the demo week.

The objective rewards focus minutes, pays a bonus for one genuinely long block
and for meeting-free days, and charges for fragmentation.

Working hours, protected mornings and lunch are **hard constraints on placement,
not scoring penalties**. Scored as penalties, the optimizer happily buys itself a
huge afternoon block by cramming meetings into the morning you asked it to
protect — it made mornings measurably worse than the input.

## Not done yet

- Natural-language constraints ("protect my mornings, I need 3 hours Thursday")
- `.ics` import — slots in behind `loadDemoWeek()` without touching optimizer or UI
- Optimizing for the *team's* total focus time rather than one person's
- Pin an event by dragging it, then re-optimize around it
