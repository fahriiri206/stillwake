# Stillwake

[![Best Game entry](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![Current rank](https://make.fun/badge/best-game-01/fahriiri206/stillwake/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard)
[![Reward](https://make.fun/badge/best-game-01/fahriiri206/stillwake/reward.svg)](https://make.fun/bounty/best-game-01)

**Stillwake** is an original browser chart-puzzle entered in make.fun's
[best-game-01](https://make.fun/bounty/best-game-01) bounty. The lanterns of a
moonlit archipelago have gone dark. You captain one small mailboat with a limited
supply of brass direction buoys: lay them on an orthogonal ocean grid, rotate them,
and let the boat follow its heading one cell at a time to gather every lantern and
reach the harbor.

Everything is hand-built: no game engine, no images, no fonts, no network requests.
The board, boat, islands, reefs, compass rose, lighthouses and lanterns are drawn
procedurally with Canvas2D; the plucks, chimes, thuds and victory cadence are
synthesised live with WebAudio after the first user gesture.

## Goal and rules

- **Goal:** collect every lantern on the chart, then enter the harbor. The harbor
  refuses a boat that arrives with even one lantern still dark.
- **Buoys:** each chart grants a fixed buoy budget. Entering a buoy's cell sets the
  boat's heading to the buoy's heading. Buoys stay where they are placed, so a
  route can cross its own wake.
- **Turning priority on entry is fixed and explicit:** a current sets the heading;
  otherwise a whirlpool turns it one quarter clockwise; otherwise a placed buoy
  sets it. Buoys cannot be placed on current or whirlpool water, so those rules
  never conflict.
- **Failure:** striking a reef or land, leaving the chart edge, entering the harbor
  early, or closing an identical position/heading/lantern state (a loop that would
  repeat forever) ends the voyage with a written reason.
- **No timer:** planning is untimed. Sailing advances one cell every 0.32 s so each
  state is readable.

### Scoring and stars

| Star | Earned by |
| --- | --- |
| 1 | Reach the harbor with every lantern aboard. |
| 2 | Finish at or under the chart's step par. |
| 3 | Finish at or under the chart's buoy par. |

The score is finite and shown at the result: 500 base, 100 per lantern, 40 per
spare buoy, 20 per move under the route reference, plus 200 and 300 for the two
par stars. Best stars and best score are kept per chart in `localStorage` (safely
guarded) and the last selected chart is restored on reload.

## The twelve charts

Each chart is hand-built and proven solvable by an independent pure-simulation
solver kept outside the game repository.

| # | Chart | Grid | Lanterns | Buoys | Step par | Buoy par |
| --- | --- | --- | --- | --- | --- | --- |
| I | First Light | 8×5 | 1 | 1 | 5 | 1 |
| II | The Lantern Steps | 9×6 | 2 | 2 | 9 | 2 |
| III | Gull's Reach | 10×6 | 3 | 3 | 14 | 3 |
| IV | The Milk Reef | 10×6 | 2 | 2 | 10 | 2 |
| V | Tideglass Crossing | 10×6 | 3 | 2 | 10 | 2 |
| VI | The Spinner's Cradle | 9×6 | 2 | 2 | 9 | 2 |
| VII | Salt Labyrinth | 10×7 | 3 | 3 | 14 | 2 |
| VIII | The Wandering Bell | 10×7 | 4 | 3 | 15 | 3 |
| IX | Crow's Ledger | 11×7 | 4 | 4 | 18 | 4 |
| X | Lanternfall | 11×7 | 5 | 3 | 28 | 2 |
| XI | The Night Ferry | 12×8 | 6 | 5 | 24 | 4 |
| XII | Stillwake | 12×8 | 7 | 6 | 33 | 6 |

The difficulty curve is deliberate: chart I teaches a single turn; II adds ordered
pickups; III–IV introduce longer multi-turn routes and reef mazes; V introduces a
fixed current; VI a whirlpool; VII–IX combine currents, whirlpools and tighter
budgets; X–XII are long crossing routes where free current turns must be spent
carefully.

## Controls

| Input | Action |
| --- | --- |
| Left-click an ocean cell | Cycle no buoy → east → south → west → north → none |
| Right-click a buoy | Remove it |
| Arrow keys | Move the keyboard focus on the grid |
| Space | Cycle the buoy at the focused cell |
| Enter | Set sail (also starts from the title, and advances result screens) |
| R | Reset the boat to planning, keeping placed buoys so the route can be repaired |
| C | Clear all placed buoys |
| P | Pause or resume while sailing |
| Esc | Pause while sailing, or close the How-to-play panel |
| M | Mute or unmute sound |

On-screen buttons mirror these actions: **Set sail**, **Repair route**, **Clear**,
**Pause/Resume**, **Sound on/off**, **How to play**, plus a **chart selector** for
replaying any chart; all twelve are selectable from the start. The game auto-pauses
when the tab is hidden.

## The loop

A true title screen (wordmark over a dimmed atmospheric board) → planning, with a
live dotted preview of the route → sailing, with wake, lantern pickups and turns →
a polished victory overlay (stars, score, best, moves, buoys, Next chart / Replay /
Chart list) or a loss overlay naming the cause (Retry route / Clear & retry). The
final chart has its own "All twelve charts are lit" ending.

## Run it

Static files, no build step. Node.js 22.18 or later is required only for the
entrypoint. From this repository:

```sh
python3 -m http.server --directory game 8080
```

Then open <http://localhost:8080/>. To produce the submission output:

```sh
mkdir -p /path/to/output
MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`main.ts` copies `game/` and `screenshots/` into the output directory and writes
`dossier.json` with the kit's unchanged `vendor/makefun-game.ts` and the official
limits. Run it twice: the two output trees are byte-identical.

## Repository layout

```
main.ts                 entrypoint: copies game/ and screenshots/, writes dossier.json
vendor/makefun-game.ts  the kit's library, unchanged
game/index.html         the page
game/styles.css         paper log, overlays, layout
game/src/main.js        boot, state machine, input, sidebar and QA snapshot
game/src/levels.js      the twelve hand-built charts
game/src/simulation.js  pure voyage engine, preview, scoring
game/src/render.js      procedural cartography, boat, effects, minimap
game/src/audio.js       synthesised WebAudio
screenshots/            real renders: start, planning, sailing, victory
```

## Verification

- Every chart is proven solvable with a real simulation, within its buoy budget;
  the QA routes, step/buoy pars and exhaustive shorter-route search live outside
  the game repository at
  `/home/ubuntu/work/makefun/ops/best-game-01/solutions.json`.
- The game was played through all twelve charts in desktop Chromium with real
  mouse clicks, earning 3 stars per chart, with no page or console errors and no
  external requests.
- Pause/resume, hidden-tab auto-pause, loss reasons, replay/restart, right-click
  removal, keyboard focus/cycling, clear, chart selection and progress reload were
  exercised in the same browser harness.
- `game/` is ~140 KiB, contains no network references, and loads only its own
  local modules and stylesheet.

## Attribution and license

Original game, art, chart designs and sounds by the Stillwake entry for make.fun's
best-game-01 bounty. No third-party game code, assets, fonts or audio are used.
The only vendored code is make.fun's own dossier library,
`vendor/makefun-game.ts`, copied unchanged from the official kit.

MIT licensed. See [LICENSE](LICENSE) (`SPDX-License-Identifier: MIT`).
