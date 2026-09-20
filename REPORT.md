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
- Confirmed all three week 3 games (Colts–Chiefs, Giants–Rams, Falcons–Packers)
  resolve against the live API right now and report as scheduled with the right
  kickoff times.
- Ran the real service on :8097 and checked it answers on loopback,
  `192.168.10.189`, `brads-mac-mini.tail28aaa3.ts.net` and the tailnet IP —
  `/api/health` and `/tv` are 200 on all four.
- Drove both pages in a real browser at 1920x1080 and 390x844 and screenshotted
  them in pregame, mid-third-quarter and final states.

**87 tests**, `npm test`, no network required — they run off the recorded
fixtures. They cover the winning-square math and board orientation, pool-week
boundaries and the December→January year rollover, the digit axes being a valid
0–9 permutation in all 18 weeks, ESPN team matching (including a fixture with
the home/away flags deliberately flipped), cumulative quarters, halftime/final/OT
detection, the delay buffer, the season backfill and cache, and every HTTP route.

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
