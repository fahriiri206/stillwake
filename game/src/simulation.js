// Stillwake's pure voyage engine. No DOM, no timers, no hidden state: the same level and the
// same buoy map always produce the same wake. main.js animates it one tick at a time, and the
// external proof solver calls simulateVoyage directly.
//
// Turning priority on entering a cell is explicit and fixed:
//   1. a current sets the heading,
//   2. otherwise a whirlpool turns it one quarter clockwise,
//   3. otherwise a placed buoy sets the heading.
// Buoys may not be placed on current or whirlpool water, so 1 and 2 never share a cell with 3.
// The dock only accepts a boat that already carries every lantern.

export const DIR_ORDER = ['E', 'S', 'W', 'N'];

export const DIRS = {
  E: { dc: 1, dr: 0, angle: 0, name: 'east' },
  S: { dc: 0, dr: 1, angle: Math.PI / 2, name: 'south' },
  W: { dc: -1, dr: 0, angle: Math.PI, name: 'west' },
  N: { dc: 0, dr: -1, angle: -Math.PI / 2, name: 'north' },
};

export const CLOCKWISE = { E: 'S', S: 'W', W: 'N', N: 'E' };
export const COUNTER_CLOCKWISE = { S: 'E', W: 'S', N: 'W', E: 'N' };

export const keyOf = (c, r) => `${c},${r}`;
export const parseKey = (key) => {
  const [c, r] = key.split(',').map(Number);
  return { c, r };
};

const PREPARED = new WeakMap();

/** Index a chart's plain arrays once. The returned field is shared, read-only in practice. */
export function prepareLevel(level) {
  const cached = PREPARED.get(level);
  if (cached) return cached;

  const land = new Set(level.land.map(([c, r]) => keyOf(c, r)));
  const reef = new Set(level.reef.map(([c, r]) => keyOf(c, r)));
  const lanterns = new Set(level.lanterns.map(({ c, r }) => keyOf(c, r)));
  const currents = new Map(level.currents.map(({ c, r, dir }) => [keyOf(c, r), dir]));
  const whirlpools = new Set(level.whirlpools.map(({ c, r }) => keyOf(c, r)));
  const startKey = keyOf(level.start.c, level.start.r);
  const dockKey = keyOf(level.dock.c, level.dock.r);

  const inBounds = (c, r) => c >= 0 && r >= 0 && c < level.w && r < level.h;
  const buoyable = (c, r) => {
    const k = keyOf(c, r);
    return (
      inBounds(c, r) &&
      !land.has(k) &&
      !reef.has(k) &&
      !lanterns.has(k) &&
      !currents.has(k) &&
      !whirlpools.has(k) &&
      k !== startKey &&
      k !== dockKey
    );
  };

  const field = {
    level,
    w: level.w,
    h: level.h,
    land,
    reef,
    lanterns,
    currents,
    whirlpools,
    start: { c: level.start.c, r: level.start.r },
    startHeading: level.start.heading,
    startKey,
    dock: { c: level.dock.c, r: level.dock.r },
    dockKey,
    inBounds,
    buoyable,
    buoyCandidates: [],
  };
  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) if (buoyable(c, r)) field.buoyCandidates.push({ c, r });
  }
  PREPARED.set(level, field);
  return field;
}

/** A stable key for loop detection: position, heading, and which lanterns are aboard. */
function stateKey(c, r, heading, collected) {
  return `${c},${r},${heading},${[...collected].sort().join('+')}`;
}

/** Normalise a Map or plain object of `"c,r" -> direction`; ignores malformed entries. */
export function normalizeBuoys(buoys) {
  const out = new Map();
  if (!buoys) return out;
  if (buoys instanceof Map) {
    for (const [k, dir] of buoys) if (DIRS[dir]) out.set(k, dir);
    return out;
  }
  for (const [k, dir] of Object.entries(buoys)) if (DIRS[dir]) out.set(k, dir);
  return out;
}

export function createVoyage(level, buoys = new Map()) {
  const field = prepareLevel(level);
  const map = normalizeBuoys(buoys);
  const collected = new Set();
  const startK = field.startKey;
  if (field.lanterns.has(startK)) collected.add(startK);
  const maxSteps = level.stepLimit ?? Math.max(60, level.w * level.h * 3);
  return {
    level,
    field,
    buoys: map,
    pos: { c: field.start.c, r: field.start.r },
    heading: field.startHeading,
    collected,
    steps: 0,
    status: 'sailing',
    cause: null,
    reason: '',
    event: null,
    trail: [{ c: field.start.c, r: field.start.r }],
    seen: new Set([stateKey(field.start.c, field.start.r, field.startHeading, collected)]),
    maxSteps,
    remaining: () => field.lanterns.size - collected.size,
  };
}

const edgeName = { E: 'eastern', S: 'southern', W: 'western', N: 'northern' };

function lose(voyage, cause, reason, to, extra = {}) {
  voyage.status = 'lost';
  voyage.cause = cause;
  voyage.reason = reason;
  voyage.event = { type: 'lost', cause, reason, from: { ...voyage.pos }, to, ...extra };
  return voyage.event;
}

/**
 * Advance one grid cell. Returns an event describing the move, the collection, the turn and
 * the resulting status, or null once the voyage is over. Mutates only the voyage object.
 */
export function stepVoyage(voyage) {
  if (voyage.status !== 'sailing') return null;
  const field = voyage.field;
  const dir = DIRS[voyage.heading];
  const from = { ...voyage.pos };
  const to = { c: from.c + dir.dc, r: from.r + dir.dr };
  const toKey = keyOf(to.c, to.r);
  voyage.steps += 1;

  if (!field.inBounds(to.c, to.r)) {
    return lose(voyage, 'edge', `The bow crossed the ${edgeName[voyage.heading]} edge of the chart.`, to);
  }

  voyage.pos = to;
  voyage.trail.push(to);

  if (field.reef.has(toKey)) {
    return lose(voyage, 'reef', `The hull struck the reef at ${toKey.replace(',', ', ')}.`, to);
  }
  if (field.land.has(toKey)) {
    return lose(voyage, 'land', `The keel ran aground at ${toKey.replace(',', ', ')}.`, to);
  }

  const picked = field.lanterns.has(toKey) && !voyage.collected.has(toKey);
  if (picked) voyage.collected.add(toKey);

  let turn = null;
  const forced = field.currents.get(toKey);
  if (forced) {
    if (voyage.heading !== forced) turn = { kind: 'current', from: voyage.heading, to: forced };
    voyage.heading = forced;
  } else if (field.whirlpools.has(toKey)) {
    const next = CLOCKWISE[voyage.heading];
    turn = { kind: 'whirlpool', from: voyage.heading, to: next };
    voyage.heading = next;
  } else {
    const placed = voyage.buoys.get(toKey);
    if (placed) {
      if (voyage.heading !== placed) turn = { kind: 'buoy', from: voyage.heading, to: placed };
      voyage.heading = placed;
    }
  }

  if (toKey === field.dockKey) {
    if (voyage.collected.size === field.lanterns.size) {
      voyage.status = 'won';
      voyage.reason = 'Every lantern is aboard and the harbor has taken the line.';
      voyage.event = { type: 'won', from, to, picked, turn, steps: voyage.steps };
      return voyage.event;
    }
    return lose(
      voyage,
      'dock',
      `The harbor refused the line: ${field.lanterns.size - voyage.collected.size} lantern${
        field.lanterns.size - voyage.collected.size === 1 ? ' is' : 's are'
      } still dark.`,
      to,
      { picked, turn },
    );
  }

  const nextState = stateKey(to.c, to.r, voyage.heading, voyage.collected);
  if (voyage.seen.has(nextState)) {
    return lose(voyage, 'loop', 'The wake closed on itself. The boat would sail this loop forever.', to, { picked, turn });
  }
  voyage.seen.add(nextState);

  if (voyage.steps >= voyage.maxSteps) {
    return lose(voyage, 'tide', `The tide ran out after ${voyage.steps} moves before the harbor opened.`, to, { picked, turn });
  }

  voyage.event = { type: 'move', from, to, picked, turn, steps: voyage.steps };
  return voyage.event;
}

/** Run the whole voyage at once. Used by the preview, the score, and the external solver. */
export function simulateVoyage(level, buoys = new Map(), guard = 4000) {
  const voyage = createVoyage(level, buoys);
  let ticks = 0;
  while (voyage.status === 'sailing' && ticks < guard) {
    stepVoyage(voyage);
    ticks += 1;
  }
  return {
    status: voyage.status,
    cause: voyage.cause,
    reason: voyage.reason,
    steps: voyage.steps,
    collected: new Set(voyage.collected),
    trail: voyage.trail,
    pos: voyage.pos,
    heading: voyage.heading,
    event: voyage.event,
    voyage,
  };
}

/** Check a proposed buoy map against a chart, including its budget and the real simulation. */
export function validateSolution(level, buoys) {
  const map = normalizeBuoys(buoys);
  const field = prepareLevel(level);
  const problems = [];
  if (map.size > level.buoys) problems.push(`${map.size} buoys over the budget of ${level.buoys}`);
  for (const [k] of map) {
    const { c, r } = parseKey(k);
    if (!field.buoyable(c, r)) problems.push(`buoy at ${k} is not open water`);
  }
  const run = simulateVoyage(level, map);
  return {
    ok: problems.length === 0 && run.status === 'won',
    problems,
    ...run,
    buoys: map,
  };
}

/** The two earned stars, from published par values only. */
export function starsFor(level, steps, buoysUsed) {
  const stepStar = steps <= level.parSteps;
  const buoyStar = buoysUsed <= level.parBuoys;
  return { stars: 1 + (stepStar ? 1 : 0) + (buoyStar ? 1 : 0), stepStar, buoyStar };
}

/** A finite score: lanterns carried, buoys spared, steps under par, and the two stars. */
export function scoreFor(level, steps, buoysUsed) {
  const stars = starsFor(level, steps, buoysUsed);
  const spareBuoys = Math.max(0, level.buoys - buoysUsed);
  const spareSteps = Math.max(0, level.parSteps + level.parBuoys * 2 - steps);
  return (
    500 +
    level.lanterns.length * 100 +
    spareBuoys * 40 +
    spareSteps * 20 +
    (stars.stepStar ? 200 : 0) +
    (stars.buoyStar ? 300 : 0)
  );
}

/** Planning preview: the wake the current buoys would make. */
export function previewCourse(level, buoys) {
  const run = simulateVoyage(level, buoys);
  return {
    status: run.status,
    cause: run.cause,
    steps: run.steps,
    collected: run.collected.size,
    trail: run.trail,
    pos: run.pos,
    heading: run.heading,
  };
}
