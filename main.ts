// Stillwake — make.fun best-game-01 entrypoint (Node 22, standard library only).
//
// The game is the static folder game/: one index.html, its ES modules and stylesheet, no
// build step and no network request. This program copies game/ and screenshots/ beside it
// into the output directory (MAKEFUN_OUTPUT_DIR, /output inside the grader) and writes the
// dossier the judge reads with the kit's own vendor/makefun-game.ts.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });

const outGame = join(out, 'game');
if (existsSync(outGame)) rmSync(outGame, { recursive: true, force: true });
cpSync(join(here, 'game'), outGame, { recursive: true });

const outShots = join(out, 'screenshots');
if (existsSync(outShots)) rmSync(outShots, { recursive: true, force: true });
mkdirSync(outShots, { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), outShots, { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Stillwake: wrote ${outGame}, ${outShots} and dossier.json`);
