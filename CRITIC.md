# CRITIC — football-squares-web, 2026-09-20 ~1pm ET

Adversarial review before tonight's 8:20pm Colts–Chiefs (pool week 3). Everything below was
executed. Service left as found: week 3, delay 15, no tracked players. No repo files changed.

## BLOCKER

**1. `/tv` on an iPad in landscape is unreadable — the README's #1 way to get it on the TV.**
`public/tv.html` reserves a fixed 880px for the sidebar:
`--cell: min((100vh-148px)/11, (100vw-880px)/11)`. At exactly 1920x1080 that is 85px cells /
13px names (excellent). At any iPad landscape size it collapses (playwright, `/tv`):
```
iPad 10.9  1180x820: cell=27px font=5px board=324px = 27% of screen width
iPad Pro11 1194x834: cell=29px font=5px board=338px = 28%
iPad Pro12 1366x1024: cell=44px font=7px board=510px = 37%
1366x768 → cell=44px font=6.8px;  1024x768 → cell=13px, names clip
```
Mirrored to the TV the grid is a postage stamp top-left and a mostly-empty "Watching with us"
panel eats the rest (`tv-ipad.png`). REPORT's "measured at exactly 1080p" is the only size it
works at. Fix: size the cell off a fraction of the viewport (`100vw*0.45/11`), or stack the
sidebar below when narrow.

**2. Changing the week mid-game wipes the delay buffer; the board jumps to the live score.**
`setState` → `weekChanged` → `buffers.clear()` (`lib/store.js`); `DelayBuffer.select()` then
falls back to the *newest* sample. On `node scripts/demo.js replay` at delay 60:
```
t=82  shown 0-7   P2 5:03  ready=true    <- correctly 60s behind
>>> week flipped to 2 and back to 3 (t=90)
t=98  shown 10-14 P2 5:03  ready=false   <- jumped 60s of game, two scores spoiled
```
One tap on the week picker reveals a touchdown before it reaches the TV — the one thing this app
exists to prevent. Same on every restart (KeepAlive, or the README's own "restart after editing
pool-2026.json"). `(syncing)` is displayed but the score is fully live. Fix: while `ready=false`,
hold `current`/`halftime` back instead of showing the freshest sample.

## FIX

**3. An ESPN outage mid-game freezes the board silently.** `refresh()` only sets `gameErrors` for
a game it has *never* scored (`if (!this.live.has(g.id))`). Six minutes of failures produce no
signal anywhere in the snapshot:
```
HEALTHY  : in {home:17,away:17} clock 3 11:18 error=null
ESPN DOWN 6 min later: in {home:17,away:17} clock 3 11:18 error=null hasData true
```
`dateMeta.lastError` is captured and never exposed. And `/api/health`'s `lastPoll` is stamped at
the end of every 5s tick whether a fetch happened or succeeded — it reads healthy while every
request fails. Surface "last good score N min ago" on /tv.

**4. No state file — nothing survives a restart.** No persistence anywhere (`grep -rn
writeFileSync lib/` → only `data/cache/*.json`). A restart resets the delay to 15 and drops every
tracked player off the TV mid-game, plus triggers #2.

**5. `cumulativeQuarters` reads only `linescores[].value`; ESPN already ships payloads without
it.** The summary endpoint returns `{displayValue:"7"}`, no `value`:
```
node -e "console.log(JSON.stringify(require('./lib/espn').cumulativeQuarters(
  [{displayValue:'0'},{displayValue:'0'}],[{displayValue:'0'},{displayValue:'7'}])))"
[{"quarter":1,"home":0,"away":0},{"quarter":2,"home":0,"away":0}]   # away should be 7
```
If the scoreboard endpoint ever matches that shape, halftime computes 0-0 and pays the wrong
square with no error. Use `x.value ?? x.displayValue`.

**6. The README's own TBD example puts a week-18 game in pool week 17.** `poolWeekForDate` keys
off each week's first dated game; the README says to enter `"1/2"` for week 18's Jets–Bills, but
week 18 starts 1/3 — so `currentPoolWeek(2027-01-02)` → **17**, and the game is invisible unless
you pick week 18 by hand.

## NOTE

7. Server poll loop has no in-flight guard (the browsers got one in c86ab31, the server didn't).
   ESPN hanging → 30 fetches started in 60s, peak 8 concurrent, all aborted at 12s, snapshot
   still renders, RSS flat. Bounded, but ~2x request amplification.
8. `clampDelay` maps `"NaN"`, `-500` and `1e400` all to **0** — a bad value silently removes the
   delay rather than keeping it (`curl -d '{"delaySeconds":"NaN"}' .../api/state` → `0`).
9. Two browsers at once: last-write-wins per field, no corruption; a phone posting a stale
   `tracked` list clobbers the other phone's.
10. Malformed JSON body → 400 plus a stack trace in `squares.error.log` (no error handler).
11. README says ESPN is polled "every 20 seconds while a game is live"; `LIVE_MS` is 10s.
12. Long names break mid-word on /tv (`brooke/mike/l | arry`). `(syncing)` never clears on a
    completed/past week.

## Verified clean

- **Pool math.** 10 random (week, home, away) combos re-derived from the JSON independently of
  `lib/pool.js` — 0 mismatches. Digits are a valid 0–9 permutation in all 18 weeks; 100 squares,
  100 distinct owners, `brad mc` exactly once at row 7 col 4. **Week 3: away[7]=8, home[4]=4 —
  "Colts end in 8, Chiefs end in 4" is correct.**
- **Season backfill.** All five completed games re-pulled from ESPN scoreboard + summary and
  rescored by hand: halftime *and* final winners match the API exactly (dave b/pete-todd,
  paige/carl-kurt-svenje 2, bill 3/paul, bill 3/brian s, brad mc/kelly a); quarter sums equal the
  finals. **$1,500 confirmed. No disagreement.**
- **Delay.** Replay at 30: every score change surfaced 31s late while the clock stayed live, and
  the halftime square did **not** appear until 31s after ESPN said HALFTIME. Set to 0 → caught up
  instantly and tracked live.
- **Live path.** 1:03pm ET, 8 live 1pm games inside the 9/20 payload the poller reads:
  `/api/health` ok, empty stderr, w3g0 correctly still `pre`. No leak — under forced GC heapUsed
  flat at 3.8MB for 4 min, buffer prunes at 15 samples; 2 sockets, 22 fds.
- **Robustness.** Empty/null/HTML/garbage payloads, 503, DNS failure → per-game error string,
  never a throw. TBD weeks render as TBD; week 18 resolves 2027-01-03/04; Thanksgiving week 12
  shows all 7 games incl. 1:00 PM and 4:30 PM; `<script>` in `tracked` rejected. Sun 7pm and 9pm
  ET both → week 3, Sat 11pm → week 2, DST fine.
- `npm test` 97/97; `scripts/verify-schedule.js` 58/58. UI: phone 390x844 no horizontal scroll;
  /tv 1920x1080 no scroll, no clipped cells; week picker, delay slider and tracked selection all
  round-trip through the server; tracked survives a reload and reaches /tv within one poll;
  Brad's orange outline visible; 0 console/page errors.

---

**PASS WITH FIXES** — the money is right and the delay works. Fix #1 and #2 before kickoff, or
drive the TV from a real 1920x1080 browser and do not touch the week picker after 8:20pm.

---

# Round 2 — 2026-09-20 ~1:40pm ET

Re-review of the six round-1 fixes. Everything below was executed. Service left as found:
week 3, delay 15, tracked = `brad mc`. No repo files changed except this section.

## 1 — /tv at four sizes: **FIXED**

Headless Chrome screenshots at 1920x1080, 1194x834, 1180x820, 1024x768, each one looked at,
plus playwright layout measurement:

| viewport | cell | name font | board % of width | clipped cells | page scroll |
|---|---|---|---|---|---|
| 1920x1080 | 83.5px | 12.9px | 49% (height-bound) | 0 | none |
| 1194x834  | 64.0px | ~9.9px | **61%** | 0 | none |
| 1180x820  | 63.3px | ~9.7px | **61%** | 0 | none |
| 1024x768  | 55.9px | ~8.7px | **62%** | 0 | none |

Names legible at all four, `brooke/mike/ larry` wraps at the slash, Brad's orange outline
visible at row 8 every time, banner text readable. Round-1's postage-stamp grid is gone.

## 2 — delay survives a week change and a cold start: **FIXED**

`node scripts/demo.js replay` on :8098, delay 45:

```
t=  0 shown=--   Q1 10:22 syncing=true  syncS=17   <- cold start holds EVERYTHING back
t= 15 shown=--   Q1  3:09 syncing=true  syncS=2
t= 18 shown=0-0  Q1  3:09 syncing=false             <- revealed only after the delay
t= 30 shown=0-0 ... >>> flipped to week 2 and back to week 3
t= 36 shown=0-0  Q2 12:41 syncing=false             <- NO jump; still 45s behind
t= 39 shown=0-7  Q2 12:41   t=60 shown=7-7   t=78 shown=7-14   t=105 shown=10-14
```

Cold-start path verified live, not just read: `board.describeGame` returns `score=null,
current=null, halftime=null, final=null` while `ready=false` and a counting-down banner.
`data/state.json` + the 13:24 boot line agree (`restored state: week=… delay=… tracked=…`).

## 3 — ESPN outage signal: **FIXED**

No env knob to kill the fetch, so: `npm test` (123/123, incl. the four FIX-3 tests) plus a
live harness — real `server.js` on :8099 with a throwing `fetchImpl` and an aged buffer:

```
HEALTHY  health.ok=true  failing=false lastError=null agoS=0
DOWN 3m  health.ok=false failing=true  lastError=ENOTFOUND agoS=180  game.stale={ms:180002}
DOWN 3m  banner -> "Scores stale since 1:32 PM — ESPN is not answering. The board is frozen,
                    the pool is fine."
```

`noticeFor()` is shared, so both views show it (`#notice` on /tv, `#banner` in app.js).

## 4 — BLOCKER (new): **any second Store overwrites the live `data/state.json`**

`scripts/demo.js` sets `SQUARES_CACHE_DIR` but not `SQUARES_STATE_FILE`, and it `require`s the
real `server.js`, so its `setState` writes the production state file:

```
prod :8097  -> {"week":3,"delaySeconds":15,"tracked":["brad mc"]}
node scripts/demo.js replay   (the README tells Brad to run this)
data/state.json -> {"week":3,"delaySeconds":15,"tracked":[6 demo names],"gameId":"w3g0"}
```

This already happened in production: at the start of this review the file held **week 5, delay
90, tracked 0** while the service ran week 3 / 15 / brad mc, and `squares.log` contains
`[squares] restored state: week=5 delay=90s tracked=0`. One KeepAlive restart during tonight's
game and the TV comes back **on the wrong week with the delay changed** — precisely what fix #4
existed to prevent. One-line fix: set `SQUARES_STATE_FILE` in `scripts/demo.js` (and in any
throwaway harness). File restored to week 3 / 15 / `brad mc` at the end of this review.

Otherwise fix #4 is sound: POST → file updated atomically, valid JSON, `.tmp` cleaned up,
malformed body → 400 with an empty `squares.error.log`, and the 12-hour rule executes as
documented (saved 1h/11.9h ago → week 9 restored; 12.1h/48h ago → week 9 dropped, delay and
tracked still restored).

## 5 — `cumulativeQuarters` displayValue fallback: **FIXED**

```
displayValue-only -> [{q1,0,0},{q2,home:0,away:7}]   (round 1 returned away:0)
value 0 + displayValue mix -> {home:3,away:7}        (a real 0 stays 0)
junk ("x", {}) -> 0, never NaN
```

## 6 — README TBD example: **FIXED**

`1/9` lands in week 18; the test regex-parses README.md itself, so the doc cannot drift.

## Also checked

- 10 random (week, score) pairs through `pool.winnerForScore` vs hand-indexed `pool-2026.json`
  — 0 mismatches. 100 cells, 100 distinct owners, `brad mc` once at [7][4] (8-4 in week 3).
- Season standings still total exactly **$1,500** across 9 owners; brad mc $150, bill 3 $300.
- Tonight resolves to **ESPN event 401872945** (Colts at Chiefs, `pre`, "9/20 - 8:20 PM EDT")
  and /tv shows pregame: 0-0, "not started", halftime/final "not yet".
- `npm test` 123/123. `squares.error.log` still 0 bytes.

## NOTE

- A restart inside the delay window **just after** a game goes final reveals the final square
  instantly (`describeGame` holds back only `state === 'in'`; it cannot tell "finished 2s ago"
  from "finished last week"). Narrow, but tonight has KeepAlive.
- The `--cell` formula reserves 26px of chrome and ignores `#notice`; with the banner showing
  the grid clears the viewport bottom by only 3-4px at 1194x834 and 1920x1080. It does not
  clip today (the banner is height-clamped even at 3 lines), but there is no margin left.
- The phone's `#banner` is styled red-on-dark-red for every notice, including the benign
  "Syncing with your TV" one.

---

**PASS WITH FIXES** — all six round-1 findings are genuinely fixed and independently
re-verified. One new blocker before kickoff: stop `scripts/demo.js` writing the live
`data/state.json`, and check the file says week 3 / delay 15 / `brad mc` before 8:20pm.
