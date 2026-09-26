# Football Squares — live board for the pool

A live squares board for Dave's 2026 NFL pool, running on the Mac Mini.
One screen for the basement TV, one for your phone. The phone drives the TV.

**$150 to the halftime square, $150 to the final square, every game. 64 pool games.**

---

## URLs

| What | URL |
|---|---|
| Phone / iPad control page | `http://brads-mac-mini.tail28aaa3.ts.net:8097/` |
| TV board (full screen) | `http://brads-mac-mini.tail28aaa3.ts.net:8097/tv` |
| On the house LAN | `http://192.168.10.189:8097/` and `/tv` |
| On the Mini itself | `http://127.0.0.1:8097/` |

No login. It is reachable only from the house LAN and the tailnet, and the
board shows first names only.

## Odds tab

`/odds` (the **Odds** button on the phone page) shows how often an NFL game has
actually ended a period on each square, under the digits of the week you pick.
The numbers come from every game from 2014 through the 2025 Super Bowl (3,295
games, nflverse play-by-play; halftime = end of the 2nd quarter, final includes
overtime) and were recomputed independently by Marion on 2026-09-26 with an
exact match. `data/odds-2014-2025.json` holds the four tables (Q1, half, Q3,
final), keyed `home-away`.

- Pick a week, then Halftime / Final / $ per game. Brighter gold = hits more often.
- Search a name, tap **Me**, or tap any square: that owner's squares light up and
  everything else dims, with their summed halftime and final odds, expected $ per
  game ($150 × half + $150 × final), their rank among the 100 owners this week, and
  their expected winnings over the whole 64-game pool.
- "Best draws this week" lists the top 10 owners (plus you if you are not in it).

`GET /api/odds?week=N` returns the grid, the leaderboard and the season totals; the
math lives in `lib/odds.js` and is covered by `test/odds.test.js`. A random square is
1% by definition; the best labeled square (home 7, visitor 0) is about 6% at half and
4% at final, and 8/2 has never hit at halftime in 27 seasons.

## Getting it on the TV

Two ways, either is fine:

1. **AirPlay the iPad (easiest).** Open `http://192.168.10.189:8097/tv` in Safari
   on the iPad, tap the **aA** button in the address bar → **Hide Toolbar**, then
   swipe down from the top-right corner → **Screen Mirroring** → pick the Apple TV.
   Rotate the iPad to landscape. The board fills the screen.

   **Turn off Auto-Lock first** — Settings → Display & Brightness → Auto-Lock →
   **Never**. Otherwise the iPad sleeps partway through the game and mirroring
   stops. (A web page can normally hold the screen awake by itself, but only
   over HTTPS, and this runs over plain HTTP on the LAN. Set it back to 5
   minutes afterwards.) For an even cleaner look, tap Share → **Add to Home
   Screen** and launch it from there — it opens full screen with no toolbar.
2. **Open it on the TV directly.** If the TV has a browser (or a Mac/Apple TV with
   one), go to `http://192.168.10.189:8097/tv`. It is laid out for 1920x1080.

Either way, keep the phone page open on your phone — whatever you change there
(week, game, delay, who's playing) changes the TV within a few seconds, because
all of it is stored on the server, not in the browser.

## Using it

**Week & game** — defaults to the current pool week by today's date, and to the
game that is live right now (or the next one to kick off). Pool weeks start
Sunday night and run through Saturday. "Jump to now" snaps back to the present
if you have been poking around at other weeks.

**TV delay** — the slider (0–90s, default 15s) holds the *score* back so the
square lights up when the play actually shows on your TV, instead of 15 seconds
early. The quarter and clock stay live so the readout still looks right. Slide
it up if the TV is further behind; the board catches up either way, and you can
slide it back down without losing anything.

**Who's watching with us** — type into the search box to find any of the 100
names, tap to add. Each person gets a colour, their square is outlined on the
board, and the sidebar shows what they need (`needs 8-4` means the visitor's
score has to end in 8 and the home team's in 4), whether they are leading right
now, and what they have won this season.

**The board** — rows are the visitor's digits (top to bottom), columns are the
home team's (left to right), exactly like the paper sheet. Owners never change
all season; the digits change every week.

- **Glowing gold** — the square that would win if the game ended right now.
- **Blue, marked `H`** — won the halftime $150. Locks in when Q2 ends.
- **Purple, marked `F`** — won the final $150.
- **Orange outline** — Brad's square (`brad mc`, row 8 / col 5 on the sheet).

On the phone the names are small — tap any square to see whose it is.

## Running it

It runs itself. `launchd` starts it at login and restarts it if it dies.

```bash
# status
launchctl print gui/$(id -u)/com.claude.squares | grep -E 'state|pid'
curl -s http://127.0.0.1:8097/api/health

# restart after changing the code or the data file
launchctl kickstart -k gui/$(id -u)/com.claude.squares

# logs
tail -f ~/Library/Logs/squares.log ~/Library/Logs/squares.error.log
```

To run it by hand instead (stop the service first):

```bash
cd /Users/claude/projects/personal/football-squares-web
npm install        # once
npm start          # PORT=8097 by default
npm test           # 85 tests, no network needed
```

The plist lives at `~/Library/LaunchAgents/com.claude.squares.plist`, with a
copy checked in at `com.claude.squares.plist`.

## Filling in the TBD games

Weeks 16, 17 and 18 have games the NFL has not scheduled yet. They show up as
"TBD" and are skipped until you give them a date. Edit
`data/pool-2026.json` — find the week, find the game in its `games` list, and
replace the placeholders:

```json
["TBD", "TBD", "Jets", "Bills", "TBD"]
```
becomes
```json
["1/9", "Sat", "Jets", "Bills", "4:30 PM"]
```

The five fields are `[date "M/D", day-of-week, visitor, home, kickoff]`. Use the
same `M/D` form as the other games — the app works out the year (anything from
August on is 2026, January is 2027).

**Put the date inside the right pool week.** A pool week runs from its Sunday
through the following Saturday, so a game you add to week 18 has to fall between
**1/3 and 1/9**; week 17 is 12/27–1/2, and week 16 is 12/20–12/26. Date it
outside its week and the app will file it under the neighbouring week and you
will not see it unless you pick that week by hand. Then restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.claude.squares
```

Nothing else needs changing; the digits for those weeks are already in the file.

## Where the scores come from

ESPN's public scoreboard API (no key, no account). The server polls it every
10 seconds while a game is live and every 5 minutes otherwise, and stops
polling a date once every pool game on it is final. Finished games are cached
in `data/cache/` and never re-fetched, so the season standings are computed
once and then come off the disk.

Two things the app is careful about, learned the hard way in the iOS version:

- Games are matched by **team name**, never by ESPN's home/away flags — those
  occasionally disagree with the pool sheet, which would silently transpose the
  whole board.
- `linescores` are points **per quarter**, so they are summed into running
  totals. The halftime score is the cumulative total through Q2, which is why
  the halftime winner stays correct even after the third quarter has started.

## Practising without a live game

```bash
node scripts/verify-schedule.js  # check every game in the sheet still resolves
node scripts/demo.js q3        # a third quarter in progress, on :8098
node scripts/demo.js halftime  # halftime, square locked
node scripts/demo.js final     # game over, both squares paid
node scripts/demo.js replay    # a whole game in ~4 min, score changing every 20s
                               #   — set the delay slider and watch it lag
```

Then open `http://127.0.0.1:8098/tv`. It replays tonight's game from a recorded
ESPN response; every other date still comes from the real API. It does not touch
the real board on :8097.

## Layout

```
server.js          express app, routes
lib/pool.js        the sheet: owners, weekly digits, winning-square math, pool weeks
lib/espn.js        ESPN adapter: team matching, cumulative quarters, halftime/final
lib/delay.js       the TV delay buffer
lib/board.js       builds the view the browser renders
lib/season.js      season-to-date winners + standings, with the disk cache
lib/store.js       shared state (week/game/delay/tracked) and the poll loop
public/            tv.html + index.html + the shared renderer
data/pool-2026.json   the pool sheet — the only file you ever need to edit
test/              85 tests against recorded ESPN responses
```

## Public access (added 2026-09-25)
The app is reachable from the internet through the Cloudflare tunnel at https://squares.mccloskey-api.com
(and https://squares.bradmccloskey.com once that zone has the CNAME `squares` → `87e54750-cd82-45e3-9db8-6b43c9ab324d.cfargotunnel.com`).
Requests that arrive through the tunnel (they carry a `cf-ray` header) must present HTTP Basic auth with the
shared password in `SQUARES_PASSWORD` (any username). LAN and tailnet requests are not challenged.
The password lives in the LaunchAgent plist; change it there and `launchctl kickstart -k gui/502/com.claude.squares`.
