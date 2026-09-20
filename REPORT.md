# Build report — football squares web app

Built 2026-09-20, ahead of the 8:20pm ET Colts–Chiefs pool game (pool week 3).
Node 25.6.1, Express, no build step, vanilla front end.

---

## What works

**Live board.** The 10x10 owner grid with the week's digits on both axes, the
currently-winning square glowing gold, the halftime square locked with an `H`
once Q2 ends, the final square marked `F` once the game is over. Score, quarter
and clock across the top. Pregame, live, final, "no ESPN event yet" and TBD
games all render without blowing up.

**Delay.** 0–90s slider, default 15s, shared server-side. It holds the *score*
back while the quarter and clock stay live, so the square lights up when the
play reaches the TV. Ported from the iOS app's `applyDelayedScore`, with one
change: the server's buffer is non-destructive on read, because many clients
share it and the slider moves both ways. Sliding the delay up reaches further
back into the buffer; sliding it down catches up immediately.

**Shared state.** Week, game, delay and the tracked-player list all live on the
server. The phone changes them, the TV picks them up within ~3 seconds. Verified
in a browser: changing the week picker, dragging the slider and removing a
player each round-tripped to `/api/state` and came back in `/api/live`.

**Player tracking.** Search across all 100 names, multi-select, a colour each,
their square outlined on the board, and a sidebar row per person showing the
digit pair they need (`needs 8-4`), `LEADING NOW` when they hold the live
square, `won halftime $150` / `won final $150` when they cash, and their season
total. Brad's `brad mc` square carries a permanent orange outline and a badge in
the header.

**Season to date.** Every pool game whose date has passed is fetched, matched
and scored. As of this afternoon that is all five games of weeks 1 and 2,
resolving with zero errors and paying out exactly $1,500 (5 games x $300):

| Game | Halftime | Final |
|---|---|---|
| W1 Patriots 10 at Seahawks 13 | 7-0 → **dave b** | **pete/todd** |
| W1 49ers 27 at Rams 7 | 10-7 → **paige** | **carl/kurt/svenje 2** |
| W2 Cowboys 20 at Giants 28 | 7-14 → **bill 3** | **paul** |
| W2 Broncos 10 at Chiefs 31 | 7-14 → **bill 3** | **brian s** |
| W2 Lions 31 at Bills 41 | 10-27 → **brad mc** | **kelly a** |

So Brad is up $150 on the season already, and `bill 3` leads with $300.
Finished dates are cached to `data/cache/` and never re-fetched.

**Two views.** `/tv` is a 1920x1080 dark layout — measured at exactly 1080p it
fills the screen with a 956px board and no scrolling in either direction. `/`
is the phone/iPad page; on a 390px iPhone viewport the full 11-column board fits
without sideways scrolling, and tapping a square names its owner.

**Service.** `com.claude.squares` is installed in `~/Library/LaunchAgents`,
bootstrapped and running with `KeepAlive`, bound to `0.0.0.0:8097`.

## What I tested against live ESPN today

- Pulled the real scoreboard for all five completed pool dates (9/9, 9/10, 9/13,
  9/14, 9/17) plus today's 14-game slate, and recorded them as test fixtures.
- Confirmed every one of the five completed pool games is found by team name and
  produces the halftime and final winners above. The week 1 results were also
  worked out by hand off the sheet first, and matched.
- Confirmed ESPN's `?dates=YYYYMMDD` uses the US calendar date, not UTC — the
  Sunday night games carry a next-day UTC timestamp but appear under the Sunday
  date, which is what the pool sheet uses.
- Confirmed the Saints–Lions overtime game on 9/13 scores correctly: five
  linescore entries, final taken from the game total (31-30) rather than the
  4th-quarter cumulative, halftime still 7-0.
- **Resolved all 58 dated pool games across all 18 weeks against the live API —
  58/58, zero failures**, including the January 2027 games in week 18. Every
  matchup in the sheet is found by team name and parsed. This is repeatable:
  `node scripts/verify-schedule.js` (exits non-zero if any game stops
  resolving, and prints a note for any game where ESPN's home/away disagrees
  with the sheet). The remaining 6 games are the TBD ones with no date yet.
- Confirmed all three week 3 games (Colts–Chiefs, Giants–Rams, Falcons–Packers)
  resolve right now and report as scheduled with the right kickoff times, and
  that weeks 12, 17 and 18 render correctly in the app (7-game Thanksgiving
  week, and TBD games shown as TBD with no errors).
- **Watched the real 1:00pm slate go live.** All seven afternoon games were
  parsed from a genuinely live feed with zero failures: state `in`, period and
  clock correct, the delay buffer filling and switching from `ready=false` to
  `ready=true` after 15 seconds exactly as designed. The live payload is now a
  test fixture (`scoreboard-live-kickoff.json`).
- Found one real behaviour worth knowing: **ESPN briefly serves an in-progress
  game with no `linescores` array at all** (two games at the 1pm kickoff). The
  board degrades correctly — the running totals and the live winning square
  still work, halftime simply stays undecided until the array appears a few
  seconds later. There are now tests for that exact state.
- Ran the real service on :8097 and checked it answers on loopback,
  `192.168.10.189`, `brads-mac-mini.tail28aaa3.ts.net` and the tailnet IP —
  `/api/health` and `/tv` are 200 on all four.
- Drove both pages in a real browser at 1920x1080 and 390x844 and screenshotted
  them in pregame, mid-third-quarter and final states.

**123 tests**, `npm test`, no network required — they run off the recorded
fixtures. They cover the winning-square math and board orientation, pool-week
boundaries and the December→January year rollover, the digit axes being a valid
0–9 permutation in all 18 weeks, ESPN team matching (including a fixture with
the home/away flags deliberately flipped), cumulative quarters, halftime/final/OT
detection, the delay buffer, the season backfill and cache, and every HTTP route.

Eight of them are an end-to-end proof of the delay: a scripted game is fed
through the real poll loop at controlled times, and the tests assert that the
board shows the score from N seconds ago while the clock stays current, that
sliding the delay up and back down works over the same buffer, that the
winning square follows the delayed score rather than the live one, and that
the halftime winner is **not** revealed until the delay has elapsed even though
ESPN has already said "halftime". `node scripts/demo.js replay` runs the same
scripted game in real time on :8098 if you want to watch it happen.

## Known gaps

- **Tonight's game has not been watched live.** Everything downstream of "ESPN
  says the game is in progress" was exercised against recorded and synthesised
  payloads, not a real live feed. The shapes come from real ESPN responses, and
  the completed-game path is verified against five real games, but the first
  genuinely live transition happens at kickoff. `node scripts/demo.js q3`
  replays a third quarter if you want to see it move before then.
- **The halftime square depends on ESPN publishing a Q2 linescore.** If ESPN is
  slow to post it, the `H` marker appears late. The score and the live square are
  unaffected, and it self-corrects on the next poll.
- **TBD games** (2 in week 16, 2 in week 17, 2 in week 18) need their dates typed
  into `data/pool-2026.json` when the NFL schedules them — see the README. They
  are skipped cleanly until then. 58 of the 64 pool games have dates.
- **No auth**, by design — LAN and tailnet only, first names only.
- **The page cannot keep the iPad awake by itself.** The screen wake-lock API
  needs HTTPS and this serves plain HTTP on the LAN, so the call is a no-op
  (it fails safely, no error). Auto-Lock has to be set to Never on the iPad
  before mirroring, or it will sleep mid-game — this is in the README.
- **The delay is the slider value plus up to one poll interval.** We can only
  notice a score change at a poll, so a play that happens just after a poll is
  revealed slightly later than the slider says. Live games are polled every 10
  seconds, so a 15s setting behaves like 15–25s. Brad can just nudge the slider
  until the square changes when the TV does.
- **The delay says "syncing" for the first few seconds** after the server starts
  or the week changes, because the buffer has no sample old enough yet. It shows
  the freshest score it has rather than a blank board, and clears itself once the
  buffer fills. Start the service before kickoff and it is never visible.
- **The phone board's names are ~5px.** Deliberate — fitting all 11 columns on a
  phone matters more than reading the names, and tapping a square names it. On an
  iPad it is comfortable.
- **Season standings refresh every 15 minutes**, but any square decided in the
  week you are watching is folded into the totals immediately, so nothing lags
  during a game.

## Deliberate choices worth knowing

- Winners are computed from the **delayed** score, not the live one, so the TV
  never reveals a winner before the play shows. Only the clock and quarter come
  from the live sample.
- Which game the board shows is decided **on the server** (live game, else next
  to kick off, else last played), so the TV and the phone can never disagree.
  Picking a game on the phone overrides it.
- The app never trusts ESPN's `homeAway` flags; the pool sheet's visitor/home
  orientation is resolved by team name, and a game whose second team does not
  match is refused outright rather than rendered transposed.

---

## Critic fixes (2026-09-20, after `CRITIC.md`)

The review came back **PASS WITH FIXES** — the pool maths and the delay were
independently re-derived and confirmed, with six things to fix. All six are done.

**1. BLOCKER — `/tv` was only readable at exactly 1920x1080.** The sidebar
reserved a fixed 880px, so on an iPad in landscape (the README's own first
choice for getting it on the TV) the grid collapsed to a postage stamp. The
sidebar is now proportional — the board takes 60% of the width or all the
height it can get, whichever runs out first — and every type size scales with
viewport height instead of being pinned in pixels.

| | before | after |
|---|---|---|
| 1920x1080 TV | 85px cells, 13px names | **86px cells, 12.9px names** |
| iPad Pro 11 (1194x834) | 29px cells, 5px names, board 28% of width | **66px cells, 9.9px names, board 61%** |
| iPad 10.9 (1180x820) | 27px cells, 5px names, board 27% | **65px cells, 9.7px names, board 61%** |
| iPad 9.7 (1024x768) | 13px cells, names clipped | **58px cells, 8.7px names, board 62%** |

All four were screenshotted and looked at: no overflow in either direction, no
clipped cells, no truncated labels. Shared squares now wrap at the slash
("brooke/mike/ larry") instead of mid-word.

**2. BLOCKER — a week change or a restart bypassed the delay.** Two separate
holes, both fixed:

- Changing the week called `buffers.clear()`, so the board fell back to the
  newest sample and jumped to the live score. One tap on the week picker could
  reveal a touchdown before it reached the TV. Buffers are keyed by game id,
  which is unique across the season, so they are simply **no longer cleared** —
  flipping to another week and back preserves the delay exactly.
- On a restart the first sample *is* the live score, and the board showed it.
  `ready=false` now means **hold everything back**: no score, no highlighted
  square, no halftime or final winner, and a counting-down "Syncing with your
  TV — showing the score in 12s" banner. The clock and quarter stay live so the
  room can see the game is running. Pregame boards (0-0 cannot spoil anything)
  and games that finished long before the restart are still shown instantly, so
  browsing past weeks is not affected.

Confirmed in production: restarted the service mid-afternoon against a live
game, and the board withheld the score for 15 seconds, counting down, then
showed it.

**3. An ESPN outage was invisible.** `lastPoll` was stamped at the end of every
tick whether or not a fetch succeeded, and `dateMeta.lastError` was captured and
never exposed. Now only a **successful** fetch advances `lastPoll`; failures are
recorded on `store.lastError`; the snapshot carries `espn.{lastPoll, lastError,
staleMs, failing}`; a live game with no fresh score for over a minute is flagged
`stale`; and both views show *"Scores stale since 1:42 — ESPN is not answering.
The board is frozen, the pool is fine."* `/api/health` reports `lastError`,
`espnFailing` and `lastPollAgoSeconds`, and flips `ok` to false after a minute
of failures instead of reading green through an outage.

**4. Nothing survived a restart.** Week, delay, tracked players and the pinned
game are now written to `data/state.json` atomically (temp file then rename) on
every change, and restored on start. A saved week is only restored if it was
chosen within 12 hours — after a reboot days later the app opens on the week it
actually is — but the delay and the tracked players always come back. Everything
loads back through `setState`, so a corrupt or hand-edited file cannot put the
store in a bad state.

**5. `cumulativeQuarters` read only `linescores[].value`.** ESPN's summary
endpoint ships `{displayValue:"7"}` with no `value`, which scored silently as
0 — a wrong halftime square with no error. It now reads `value ?? displayValue`,
carefully enough that a real `0` stays `0` rather than falling through.

**6. The README's own TBD example was in the wrong week.** It told Brad to type
`"1/2"` for a week-18 game, but week 18 starts 1/3, so the game would have been
filed under week 17 and been invisible. The example is now `"1/9"`, and the
README spells out the date range each of the three TBD weeks has to fall inside.
There is a test that parses the README's example and asserts it lands in week 18,
so the docs cannot drift out of sync with the code again.

**Also fixed from the review's notes:** the server poll loop had no in-flight
guard (a hanging ESPN caused ~2x request amplification — now strictly one
refresh at a time); a garbage `delaySeconds` silently reset the delay to 0
instead of keeping the current value, which would have quietly un-synced the TV;
a malformed JSON body returned a stack trace in `squares.error.log` (now a clean
`400`); and the README said ESPN was polled every 20s when it is 10s.

**Not addressed** (noted, judged not worth the risk today): two phones editing
the tracked list at once is last-write-wins per field. Nobody is editing from two
phones mid-game, and the fix is a bigger change than tonight warrants.

**23 new tests** cover fixes 2, 3, 4, 5 and 6 — including the restart-mid-game
hold-back, the week round-trip preserving the delay, a failing ESPN not looking
healthy, the state file surviving corrupt/hostile/missing input with no temp
files left behind, `displayValue`-only linescores scoring halftime correctly,
and the README example landing in week 18. **123 tests, all passing.**
