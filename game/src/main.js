// Stillwake's boot, state machine, input and paper log. The board is drawn by render.js, the
// voyage is simulated by simulation.js; this file only decides which screen is showing, feeds
// real clicks and keys into the plan, and reports actual state back to the log.

import { CHARTS, CHART_COUNT } from './levels.js';
import { Renderer, drawMinimap } from './render.js';
import { Sound } from './audio.js';
import {
  DIR_ORDER,
  keyOf,
  prepareLevel,
  createVoyage,
  stepVoyage,
  previewCourse,
  starsFor,
  scoreFor,
} from './simulation.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const scene = $('scene');
const minimap = $('minimap');
const renderer = new Renderer(canvas);
const sound = new Sound();

const STEP_SECONDS = 0.32;
const CYCLE = [null, ...DIR_ORDER];
const STORE_KEY = 'stillwake.progress.v1';

function clampIndex(value, length) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < length ? n : 0;
}

function loadProgress() {
  const fallback = { best: {}, lastChart: 0, muted: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const best = {};
    if (parsed.best && typeof parsed.best === 'object') {
      for (const level of CHARTS) {
        const entry = parsed.best[level.id];
        if (!entry || typeof entry !== 'object') continue;
        const stars = Number(entry.stars);
        const score = Number(entry.score);
        if (!Number.isFinite(stars) || !Number.isFinite(score)) continue;
        best[level.id] = {
          stars: Math.max(0, Math.min(3, Math.round(stars))),
          score: Math.max(0, Math.round(score)),
          steps: Number.isFinite(Number(entry.steps)) ? Number(entry.steps) : null,
          buoys: Number.isFinite(Number(entry.buoys)) ? Number(entry.buoys) : null,
        };
      }
    }
    return {
      best,
      lastChart: clampIndex(parsed.lastChart, CHARTS.length),
      muted: parsed.muted === true,
    };
  } catch {
    return fallback;
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // A private window or a full quota must never break the voyage.
  }
}

const progress = loadProgress();
sound.setMuted(progress.muted);

const state = {
  screen: 'title',
  chartIndex: progress.lastChart,
  buoys: new Map(),
  focus: null,
  hover: null,
  preview: null,
  voyage: null,
  motion: null,
  collected: new Set(),
  paused: false,
  pausedAt: null,
  pausedAccum: 0,
  stepAt: 0,
  finishAt: 0,
  pendingFinish: null,
  result: null,
  lastFrame: 0,
};

/** The voyage clock in milliseconds; it stops while paused so a hidden tab cannot rush the boat. */
function simNow() {
  const raw = state.paused ? (state.pausedAt ?? performance.now()) : performance.now();
  return raw - state.pausedAccum;
}

function pauseClock() {
  if (state.paused) return;
  state.paused = true;
  state.pausedAt = performance.now();
}

function resumeClock() {
  if (!state.paused) return;
  const now = performance.now();
  if (state.pausedAt !== null) state.pausedAccum += now - state.pausedAt;
  state.pausedAt = null;
  state.paused = false;
}

function level() {
  return CHARTS[state.chartIndex];
}

function field() {
  return prepareLevel(level());
}

function lastBest() {
  return progress.best[level().id] ?? { stars: 0, score: 0, steps: null, buoys: null };
}

function announce(text) {
  $('liveStatus').textContent = text;
}

/** Keep the chart itself under the keyboard after a sidebar action, so Enter always sails. */
function focusBoard() {
  if (state.screen === 'title') return;
  canvas.focus({ preventScroll: true });
}

function nudge(element) {
  element.classList.remove('nudge');
  void element.offsetWidth;
  element.classList.add('nudge');
}

function totalStars() {
  return Object.values(progress.best).reduce((sum, entry) => sum + (entry.stars || 0), 0);
}

function clearedCount() {
  return Object.values(progress.best).filter((entry) => entry.stars > 0).length;
}

function recomputePreview() {
  state.preview = previewCourse(level(), state.buoys);
}

function updateHUD() {
  const chart = level();
  const f = field();
  const best = lastBest();
  const collected = state.voyage ? state.voyage.collected.size : 0;
  const total = chart.lanterns.length;
  const used = state.buoys.size;

  $('chartNumber').textContent = chart.number;
  $('chartName').textContent = chart.name;
  $('chartIndexLabel').textContent = String(state.chartIndex + 1);
  $('objective').textContent = chart.brief;
  $('hint').textContent = chart.note;

  $('lanternStat').textContent = `${collected} / ${total}`;
  $('lanternBar').style.width = `${total === 0 ? 0 : (collected / total) * 100}%`;
  $('buoyStat').textContent = `${used} / ${chart.buoys}`;
  $('buoyBar').style.width = `${chart.buoys === 0 ? 0 : (used / chart.buoys) * 100}%`;
  $('stepStat').textContent = state.voyage ? String(state.voyage.steps) : '—';
  if (state.screen === 'planning' && state.preview) {
    $('parStat').textContent = `preview ${state.preview.steps} · par ${chart.parSteps}`;
  } else {
    $('parStat').textContent = `par ${chart.parSteps}`;
  }

  const starLine = $('starLine');
  starLine.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.textContent = '★';
    span.className = i < best.stars ? 'on' : 'off';
    starLine.appendChild(span);
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = best.stars > 0 ? `best ${best.score}` : 'not yet charted';
  starLine.appendChild(label);

  $('progressText').textContent = `${totalStars()} / ${CHART_COUNT * 3} stars`;
  $('chartStarsTotal').textContent = `${clearedCount()} / ${CHART_COUNT} cleared`;

  $('sailBtn').disabled = state.screen === 'title' || state.screen === 'sailing' && !state.paused || state.screen === 'won' || state.screen === 'lost';
  if (state.screen === 'planning') {
    $('sailBtn').firstChild.textContent = 'Set sail ';
    $('sailBtn').classList.toggle('pulse', state.preview?.status === 'won');
  } else if (state.screen === 'sailing') {
    $('sailBtn').firstChild.textContent = state.paused ? 'Resume sail ' : 'Under sail ';
    $('sailBtn').classList.remove('pulse');
  } else if (state.screen === 'won') {
    $('sailBtn').firstChild.textContent = 'Chart complete ';
    $('sailBtn').classList.remove('pulse');
  } else if (state.screen === 'lost') {
    $('sailBtn').firstChild.textContent = 'Voyage ended ';
    $('sailBtn').classList.remove('pulse');
  } else {
    $('sailBtn').firstChild.textContent = 'Set sail ';
    $('sailBtn').classList.remove('pulse');
  }

  $('resetBtn').disabled = state.screen === 'title';
  $('clearBtn').disabled = state.screen === 'title';
  const pauseVisible = state.screen === 'sailing';
  $('pauseBtn').hidden = !pauseVisible;
  $('pauseBtn').firstChild.textContent = state.paused ? 'Resume ' : 'Pause ';
  $('pauseBtn').classList.toggle('pulse', false);

  const mute = $('muteBtn');
  mute.textContent = progress.muted ? 'Sound off' : 'Sound on';
  mute.setAttribute('aria-pressed', progress.muted ? 'true' : 'false');

  scene.classList.toggle('is-title', state.screen === 'title');
  canvas.style.cursor = state.screen === 'planning' ? 'crosshair' : 'default';
  $('titleOverlay').hidden = state.screen !== 'title';
  $('pauseVeil').hidden = !(state.screen === 'sailing' && state.paused);

  buildChartGrid();
  document.body.classList.toggle('has-result', state.screen === 'won' || state.screen === 'lost');
}

function buildChartGrid() {
  const grid = $('chartGrid');
  if (grid.childElementCount !== CHART_COUNT) {
    grid.replaceChildren();
    CHARTS.forEach((chart, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chart-btn';
      button.dataset.index = String(index);
      const number = document.createElement('span');
      number.className = 'cn';
      number.textContent = String(index + 1).padStart(2, '0');
      const stars = document.createElement('span');
      stars.className = 'cs';
      button.append(number, stars);
      button.title = `Chart ${index + 1} · ${chart.name}`;
      grid.appendChild(button);
    });
  }
  for (const button of grid.children) {
    const index = Number(button.dataset.index);
    const chart = CHARTS[index];
    const best = progress.best[chart.id];
    button.classList.toggle('current', index === state.chartIndex);
    const stars = button.querySelector('.cs');
    stars.textContent = best ? '★'.repeat(best.stars) + '·'.repeat(3 - best.stars) : '···';
    button.setAttribute('aria-current', index === state.chartIndex ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      `Chart ${index + 1}, ${chart.name}${best && best.stars ? `, best ${best.stars} stars` : ', not yet charted'}`,
    );
  }
}

function selectChart(index) {
  state.chartIndex = clampIndex(index, CHARTS.length);
  state.screen = 'planning';
  state.paused = false;
  state.buoys = new Map();
  state.focus = { c: level().start.c, r: level().start.r };
  state.hover = null;
  state.voyage = null;
  state.motion = null;
  state.collected = new Set();
  state.pausedAt = null;
  state.pausedAccum = 0;
  state.stepAt = 0;
  state.pendingFinish = null;
  state.finishAt = 0;
  state.result = null;
  renderer.clearFx();
  $('resultOverlay').hidden = true;
  $('howOverlay').hidden = true;
  progress.lastChart = state.chartIndex;
  saveProgress();
  recomputePreview();
  updateHUD();
  announce(`Chart ${state.chartIndex + 1}: ${level().name}. Planning.`);
  focusBoard();
}

function showTitle() {
  state.screen = 'title';
  state.paused = false;
  state.pausedAt = null;
  state.pausedAccum = 0;
  state.buoys = new Map();
  state.focus = null;
  state.hover = null;
  state.preview = null;
  state.voyage = null;
  state.motion = null;
  state.collected = new Set();
  state.stepAt = 0;
  state.pendingFinish = null;
  state.finishAt = 0;
  state.result = null;
  renderer.clearFx();
  $('resultOverlay').hidden = true;
  $('howOverlay').hidden = true;
  updateHUD();
  announce('Stillwake. Choose a chart or begin the voyage.');
}

function startVoyage() {
  if (state.screen !== 'planning') return;
  sound.unlock();
  state.screen = 'sailing';
  state.paused = false;
  state.pausedAt = null;
  state.pausedAccum = 0;
  state.pendingFinish = null;
  state.finishAt = 0;
  state.result = null;
  state.collected = new Set();
  state.voyage = createVoyage(level(), state.buoys);
  state.motion = null;
  state.stepAt = simNow() + STEP_SECONDS * 0.6;
  state.focus = null;
  state.hover = null;
  announce('Sailing. The boat follows its heading one cell at a time.');
  updateHUD();
}

function advanceVoyage() {
  if (!state.voyage || state.voyage.status !== 'sailing') return;
  const before = { ...state.voyage.pos };
  const headingBefore = state.voyage.heading;
  const event = stepVoyage(state.voyage);
  if (!event) return;

  let to = event.to;
  if (to.c < 0 || to.r < 0 || to.c >= level().w || to.r >= level().h) {
    const dir = event.cause === 'edge' ? { c: before.c + (to.c - before.c) * 0.55, r: before.r + (to.r - before.r) * 0.55 } : before;
    to = dir;
  }
  const startedAt = simNow();
  state.motion = {
    from: before,
    to: { c: to.c, r: to.r },
    headingFrom: headingBefore,
    headingTo: state.voyage.heading,
    startAt: startedAt,
    duration: STEP_SECONDS * 1000,
  };
  state.stepAt = startedAt + STEP_SECONDS * 1000;
  state.collected = new Set(state.voyage.collected);
  renderer.burstWake(before.c, before.r, headingBefore);

  if (event.picked) {
    renderer.burstPickup(event.to.c, event.to.r);
    sound.pickup();
    announce(`Lantern taken. ${state.voyage.collected.size} of ${level().lanterns.length} aboard.`);
  }
  if (event.turn) sound.turn();

  if (state.voyage.status === 'won') {
    sound.win();
    renderer.burstWin();
    state.pendingFinish = 'won';
    state.finishAt = startedAt + STEP_SECONDS * 1000 + 380;
  } else if (state.voyage.status === 'lost') {
    const at = field().inBounds(event.to.c, event.to.r) ? event.to : before;
    renderer.burstFail(at.c, at.r);
    sound.fail();
    state.pendingFinish = 'lost';
    state.finishAt = startedAt + STEP_SECONDS * 1000 + 330;
  }
  updateHUD();
}

function finishVoyage() {
  if (state.screen !== 'sailing' || !state.pendingFinish) return;
  const kind = state.pendingFinish;
  state.pendingFinish = null;
  state.finishAt = 0;
  state.motion = null;
  state.pausedAt = null;
  state.pausedAccum = 0;

  const chart = level();
  const steps = state.voyage.steps;
  const used = state.buoys.size;
  const stars = kind === 'won' ? starsFor(chart, steps, used) : { stars: 0, stepStar: false, buoyStar: false };
  const score = kind === 'won' ? scoreFor(chart, steps, used) : 0;
  const previous = lastBest();
  if (kind === 'won') {
    const improved = score > (previous.score || 0);
    progress.best[chart.id] = {
      stars: Math.max(previous.stars || 0, stars.stars),
      score: Math.max(previous.score || 0, score),
      steps: improved ? steps : previous.steps,
      buoys: improved ? used : previous.buoys,
    };
  }
  progress.lastChart = state.chartIndex;
  saveProgress();

  state.screen = kind;
  state.paused = false;
  state.result = {
    kind,
    stars: stars.stars,
    stepStar: stars.stepStar,
    buoyStar: stars.buoyStar,
    score,
    best: progress.best[chart.id]?.score ?? 0,
    steps,
    used,
    reason: state.voyage.reason,
    cause: state.voyage.cause,
  };
  showResult();
  updateHUD();
  announce(kind === 'won' ? `Chart complete with ${stars.stars} stars.` : `Voyage ended: ${state.voyage.reason}`);
}

function showResult() {
  const result = state.result;
  const won = result.kind === 'won';
  const finale = won && clearedCount() === CHART_COUNT;
  $('resultKicker').textContent = finale ? 'The archipelago wakes' : won ? 'Chart complete' : 'Voyage ended';
  $('resultTitle').textContent = finale ? 'All twelve charts are lit' : won ? 'Every lantern wakes' : 'The lanterns stay dark';
  $('resultReason').textContent = finale
    ? `Stillwake is charted with ${totalStars()} of ${CHART_COUNT * 3} stars. The old harbor opens, and the whole archipelago burns gold.`
    : won
      ? `${level().name} is charted. ${result.stepStar && result.buoyStar ? 'A perfect route, spare buoys and all.' : 'The harbor light answers your wake.'}`
      : result.reason;
  const starBox = $('resultStars');
  starBox.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.textContent = '★';
    span.className = i < result.stars ? 'on' : 'off';
    starBox.appendChild(span);
  }
  starBox.setAttribute('aria-label', `${result.stars} of 3 stars`);
  $('resultScore').textContent = String(result.score);
  $('resultBest').textContent = String(result.best);
  $('resultSteps').textContent = String(result.steps);
  $('resultBuoys').textContent = String(result.used);

  $('resultNext').textContent = won
    ? state.chartIndex === CHART_COUNT - 1
      ? 'Return to title'
      : 'Next chart'
    : 'Retry route';
  $('resultReplay').textContent = won ? 'Replay chart' : 'Clear & retry';
  $('resultOverlay').hidden = false;
  $('resultNext').focus();
}

function resetToPlanning(keepBuoys) {
  if (state.screen === 'title') return;
  if (!keepBuoys) state.buoys = new Map();
  state.screen = 'planning';
  state.paused = false;
  state.voyage = null;
  state.motion = null;
  state.collected = new Set();
  state.pausedAt = null;
  state.pausedAccum = 0;
  state.stepAt = 0;
  state.pendingFinish = null;
  state.finishAt = 0;
  state.result = null;
  state.focus = { c: level().start.c, r: level().start.r };
  state.hover = null;
  renderer.clearFx();
  $('resultOverlay').hidden = true;
  recomputePreview();
  updateHUD();
  announce(keepBuoys ? 'Back to planning with your route intact.' : 'Buoys cleared. Planning.');
}

function clearBuoys() {
  if (state.screen === 'title') return;
  state.buoys = new Map();
  resetToPlanning(false);
}

function cycleBuoy(c, r) {
  if (state.screen !== 'planning') return;
  const f = field();
  if (!f.buoyable(c, r)) {
    nudge($('buoyStat'));
    announce('Only open water can hold a buoy. Lanterns, currents, whirlpools, land, reefs, mooring and harbor are unavailable.');
    sound.click();
    return;
  }
  const key = keyOf(c, r);
  const current = state.buoys.get(key) ?? null;
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  if (next && !state.buoys.has(key) && state.buoys.size >= level().buoys) {
    nudge($('buoyStat'));
    announce(`Buoy budget spent: ${level().buoys} of ${level().buoys}. Right-click a buoy to remove it first.`);
    sound.click();
    return;
  }
  if (next) state.buoys.set(key, next);
  else state.buoys.delete(key);
  state.focus = { c, r };
  sound.place();
  recomputePreview();
  updateHUD();
  announce(next ? `Buoy set ${next === 'E' ? 'east' : next === 'S' ? 'south' : next === 'W' ? 'west' : 'north'}.` : 'Buoy removed.');
}

function removeBuoy(c, r) {
  if (state.screen !== 'planning') return;
  const key = keyOf(c, r);
  if (!state.buoys.has(key)) return;
  state.buoys.delete(key);
  state.focus = { c, r };
  sound.click();
  recomputePreview();
  updateHUD();
  announce('Buoy removed.');
}

function togglePause() {
  if (state.screen !== 'sailing') return;
  if (state.paused) resumeClock();
  else pauseClock();
  updateHUD();
  announce(state.paused ? 'Paused.' : 'Resumed.');
}

function toggleMute() {
  progress.muted = !progress.muted;
  sound.setMuted(progress.muted);
  if (!progress.muted) sound.click();
  saveProgress();
  updateHUD();
  announce(progress.muted ? 'Sound muted.' : 'Sound on.');
}

function moveFocus(dc, dr) {
  if (state.screen !== 'planning' || !state.focus) return;
  const chart = level();
  state.focus = {
    c: Math.max(0, Math.min(chart.w - 1, state.focus.c + dc)),
    r: Math.max(0, Math.min(chart.h - 1, state.focus.r + dr)),
  };
  state.hover = null;
  sound.turn();
}

function openHow() {
  if (state.screen === 'sailing' && !state.paused) {
    pauseClock();
    updateHUD();
  }
  $('howOverlay').hidden = false;
  $('closeHowBtn').focus();
}

function closeHow() {
  $('howOverlay').hidden = true;
  if (state.screen === 'title') $('beginBtn').focus();
  else focusBoard();
}

// ------------------------------------------------------------------ pointer

canvas.addEventListener('pointermove', (event) => {
  if (state.screen !== 'planning') {
    state.hover = null;
    return;
  }
  state.hover = renderer.cellAt(event.clientX, event.clientY);
});

canvas.addEventListener('pointerleave', () => {
  state.hover = null;
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

canvas.addEventListener('pointerdown', (event) => {
  if (state.screen !== 'planning') return;
  const cell = renderer.cellAt(event.clientX, event.clientY);
  if (!cell) return;
  event.preventDefault();
  if (event.button === 0) cycleBuoy(cell.c, cell.r);
  else if (event.button === 2) removeBuoy(cell.c, cell.r);
});

// ------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  const onButton = tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA';
  if (event.key === 'Escape') {
    if (!$('howOverlay').hidden) {
      event.preventDefault();
      closeHow();
    } else if (state.screen === 'sailing' && !state.paused) {
      event.preventDefault();
      togglePause();
    }
    return;
  }
  if (!$('howOverlay').hidden) return;

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (event.key === 'ArrowLeft') moveFocus(-1, 0);
    else if (event.key === 'ArrowRight') moveFocus(1, 0);
    else if (event.key === 'ArrowUp') moveFocus(0, -1);
    else moveFocus(0, 1);
    return;
  }
  if (event.key === ' ' || event.code === 'Space') {
    if (onButton) return;
    event.preventDefault();
    if (state.screen === 'planning' && state.focus) cycleBuoy(state.focus.c, state.focus.r);
    return;
  }
  if (event.key === 'Enter') {
    if (onButton) return;
    if (state.screen === 'title') {
      event.preventDefault();
      sound.unlock();
      sound.pluck();
      selectChart(state.chartIndex);
    } else if (state.screen === 'planning') {
      event.preventDefault();
      startVoyage();
    } else if (state.screen === 'won') {
      event.preventDefault();
      $('resultNext').click();
    } else if (state.screen === 'lost') {
      event.preventDefault();
      $('resultNext').click();
    }
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    resetToPlanning(true);
    return;
  }
  if (event.key === 'c' || event.key === 'C') {
    event.preventDefault();
    clearBuoys();
    return;
  }
  if (event.key === 'p' || event.key === 'P') {
    event.preventDefault();
    if (state.screen === 'sailing') togglePause();
    return;
  }
  if (event.key === 'm' || event.key === 'M') {
    event.preventDefault();
    toggleMute();
  }
});

// ------------------------------------------------------------------ buttons

$('beginBtn').addEventListener('click', () => {
  sound.unlock();
  sound.pluck();
  selectChart(state.chartIndex);
});
$('titleHowBtn').addEventListener('click', openHow);
$('howBtn').addEventListener('click', openHow);
$('closeHowBtn').addEventListener('click', closeHow);
$('howCloseX').addEventListener('click', closeHow);
$('sailBtn').addEventListener('click', () => {
  if (state.screen === 'planning') startVoyage();
  else if (state.screen === 'sailing') togglePause();
  focusBoard();
});
$('resetBtn').addEventListener('click', () => { resetToPlanning(true); focusBoard(); });
$('clearBtn').addEventListener('click', () => { clearBuoys(); focusBoard(); });
$('pauseBtn').addEventListener('click', () => { togglePause(); focusBoard(); });
$('resumeBtn').addEventListener('click', () => { togglePause(); focusBoard(); });
$('muteBtn').addEventListener('click', () => { toggleMute(); focusBoard(); });

$('chartGrid').addEventListener('click', (event) => {
  const button = event.target.closest('.chart-btn');
  if (!button) return;
  sound.unlock();
  sound.click();
  selectChart(Number(button.dataset.index));
});

$('resultNext').addEventListener('click', () => {
  const result = state.result;
  if (!result) return;
  sound.click();
  if (result.kind === 'lost') {
    resetToPlanning(true);
  } else if (state.chartIndex === CHART_COUNT - 1) {
    showTitle();
  } else {
    selectChart(state.chartIndex + 1);
  }
});

$('resultReplay').addEventListener('click', () => {
  if (!state.result) return;
  sound.click();
  if (state.result.kind === 'lost') clearBuoys();
  else selectChart(state.chartIndex);
});

$('resultCharts').addEventListener('click', () => {
  sound.click();
  showTitle();
});

// ------------------------------------------------------------------ browser

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'sailing' && !state.paused) {
    pauseClock();
    updateHUD();
    announce('Paused while the chart is hidden. Press P or Resume to continue.');
  }
});

function renderView() {
  return {
    level: level(),
    screen: state.screen,
    paused: state.paused,
    buoys: state.buoys,
    focus: state.focus,
    hover: state.hover,
    preview: state.preview,
    voyage: state.voyage,
    motion: state.motion
      ? { ...state.motion, t: Math.max(0, Math.min(1, (simNow() - state.motion.startAt) / state.motion.duration)) }
      : null,
    collected: state.collected,
  };
}

function frame(now) {
  if (state.lastFrame === 0) state.lastFrame = now;
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;

  if (state.screen === 'sailing' && !state.paused) {
    const clock = simNow();
    if (!state.pendingFinish && state.voyage?.status === 'sailing' && clock >= state.stepAt) advanceVoyage();
    if (state.pendingFinish && clock >= state.finishAt) finishVoyage();
  }

  const view = renderView();
  renderer.draw(view, now);
  drawMinimap(minimap, level(), view);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ QA surface

window.stillwake = Object.freeze({
  snapshot() {
    const chart = level();
    const best = lastBest();
    const boat = state.voyage?.pos ?? { c: chart.start.c, r: chart.start.r };
    const heading = state.voyage?.heading ?? chart.start.heading;
    const status = state.screen === 'sailing' && state.paused ? 'paused' : state.screen;
    return {
      status,
      screen: state.screen,
      chartIndex: state.chartIndex,
      chartId: chart.id,
      chartName: chart.name,
      levelCount: CHART_COUNT,
      boat: { col: boat.c, row: boat.r, heading },
      focus: state.focus ? { col: state.focus.c, row: state.focus.r } : null,
      activeElement: document.activeElement?.id || document.activeElement?.tagName || null,
      lanternsCollected: state.collected.size,
      lanternsTotal: chart.lanterns.length,
      placedBuoys: Object.fromEntries(state.buoys),
      buoyBudget: chart.buoys,
      steps: state.voyage?.steps ?? 0,
      outcome: state.result ? (state.result.kind === 'won' ? 'win' : 'loss') : null,
      paused: !!state.paused,
      stars: state.result?.stars ?? 0,
      bestStars: best.stars,
      resultKind: state.result?.kind ?? null,
      bestScore: best.score,
      score: state.result?.score ?? 0,
      preview: state.preview ? { status: state.preview.status, steps: state.preview.steps } : null,
      reason: state.result && state.result.kind === 'lost' ? state.result.reason : null,
    };
  },
  cellCenter(col, row) {
    return renderer.viewportCellCenter(col, row);
  },
});

canvas.tabIndex = 0;
canvas.addEventListener('focus', () => {
  canvas.style.outline = 'none';
});
updateHUD();
$('beginBtn').focus();
requestAnimationFrame(frame);
