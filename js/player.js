// Workout mode: runs through the steps of a workout with a timer.
//
// Timing: each timed step stores the wall-clock time at which it ends (endTime).
// The remaining time is always computed from that, so the timer stays correct even
// if the phone stutters. The next step starts exactly at the previous endTime.

import { repo } from './db.js';
import { esc, formatClock, stepTarget, exerciseImageUrl, thumb, expandSteps } from './utils.js';
import { sounds, unlockAudio, isAudioUnlocked } from './audio.js';
import { confirmDialog } from './ui.js';
import { icon } from './icons.js';

const READY_SECONDS = 5;

export async function viewPlayer(view, match, ctx) {
  const workoutId = match[1];
  const [workout, exercises] = await Promise.all([repo.getWorkout(workoutId), repo.listExercises()]);
  if (ctx.stale()) return;

  const exById = new Map(exercises.map((e) => [e.id, e]));
  // Repeat blocks are unrolled here, so the player just walks through a flat list.
  const plays = workout ? expandSteps(workout.steps, new Set(exById.keys())) : [];
  const steps = plays.map((p) => p.step);
  const rounds = plays.map((p) => p.round); // { n, of } inside a repeat block, else null
  const taskTotal = steps.filter((s) => s.type !== 'rest').length;

  if (!workout || !taskTotal) {
    view.innerHTML = `<div class="empty"><p class="empty-title">Nothing to start</p>
      <p>This workout has no exercises yet.</p>
      <a class="btn btn-primary" href="${workout ? `#/workouts/${workoutId}` : '#/workouts'}">Back</a></div>`;
    return;
  }

  // tasksBefore[i] = number of exercises before step i
  const tasksBefore = [];
  steps.reduce((n, s, i) => {
    tasksBefore[i] = n;
    return n + (s.type === 'rest' ? 0 : 1);
  }, 0);

  document.body.classList.add('playing');
  const root = document.createElement('div');
  root.className = 'player phase-ready';
  view.replaceChildren(root);

  let index = -1; // -1 = "get ready" countdown
  let endTime = null; // ms timestamp; null for reps steps
  let durationMs = READY_SECONDS * 1000;
  let paused = false;
  let remainingAtPause = 0;
  let lastSecond = null;
  let running = false;
  let finished = false;
  let startedAt = null;
  let pausedAt = 0;
  let pausedTotal = 0;
  let timer = null;
  let wakeLock = null;

  const current = () => (index < 0 ? { type: 'ready', seconds: READY_SECONDS } : steps[index]);
  const nextTaskFrom = (from) => {
    for (let i = Math.max(0, from); i < steps.length; i++) if (steps[i].type !== 'rest') return i;
    return -1;
  };
  const roundLabel = (r) => (r ? `Round ${r.n} of ${r.of}` : '');
  const remaining = () => (paused ? remainingAtPause : endTime - Date.now());

  // ----- screen wake lock -----
  async function lockScreen() {
    if (!('wakeLock' in navigator) || finished) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* not allowed right now, e.g. low battery mode */
    }
  }
  function releaseLock() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && running && !finished) {
      lockScreen();
      tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ----- flow -----
  function begin() {
    unlockAudio();
    lockScreen();
    running = true;
    index = -1;
    durationMs = READY_SECONDS * 1000;
    endTime = Date.now() + durationMs;
    lastSecond = null;
    timer = setInterval(tick, 100);
    draw();
    tick();
  }

  function advance(at) {
    index++;
    if (index === 0) startedAt = Date.now();
    if (index >= steps.length) return finish();
    const now = Date.now();
    // Chain exactly onto the previous step, unless the app was in the background for a while.
    const start = at != null && now - at < 1500 ? at : now;
    const step = steps[index];
    lastSecond = null;
    if (step.type === 'reps') {
      endTime = null;
    } else {
      durationMs = step.seconds * 1000;
      endTime = start + durationMs;
    }
    if (step.type === 'rest') sounds.rest();
    else sounds.work();
    draw();
    tick();
  }

  function tick() {
    if (!running || finished || paused || endTime == null) return;
    const ms = endTime - Date.now();
    if (ms <= 0) {
      advance(endTime);
      return;
    }
    const sec = Math.ceil(ms / 1000);
    if (lastSecond !== null && sec < lastSecond) {
      if (sec <= 3) {
        sounds.countdown();
        pulse();
      }
    }
    lastSecond = sec;
    paintClock(ms);
  }

  function togglePause() {
    if (finished || endTime == null) return;
    const now = Date.now();
    if (!paused) {
      paused = true;
      remainingAtPause = endTime - now;
      pausedAt = now;
    } else {
      paused = false;
      endTime = now + remainingAtPause;
      if (startedAt) pausedTotal += now - pausedAt;
      lastSecond = Math.ceil(remainingAtPause / 1000);
    }
    draw();
  }

  function skip() {
    if (paused) {
      paused = false;
      if (startedAt) pausedTotal += Date.now() - pausedAt;
    }
    advance(null);
  }

  function finish() {
    finished = true;
    running = false;
    clearInterval(timer);
    timer = null;
    releaseLock();
    sounds.finish();
    draw();
  }

  async function stop() {
    if (!finished) {
      const wasPaused = paused;
      if (!wasPaused && endTime != null) togglePause();
      const ok = await confirmDialog({
        title: 'Stop workout?',
        message: 'The timer stops and you go back to the workout.',
        confirm: 'Stop workout',
        cancel: 'Keep going',
        danger: true,
      });
      if (!ok) {
        if (!wasPaused && paused) togglePause();
        return;
      }
    }
    location.hash = `#/workouts/${workoutId}`;
  }

  // ----- rendering -----
  function paintClock(ms) {
    const el = root.querySelector('#clock');
    if (el) el.textContent = formatClock(ms / 1000);
    const fill = root.querySelector('.pseg.is-current i');
    if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, 1 - ms / durationMs))})`;
  }

  function pulse() {
    const el = root.querySelector('#clock');
    if (!el || !el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
  }

  function nextCard(i) {
    const step = steps[i];
    const ex = exById.get(step.exerciseId);
    const label = rounds[i] ? `Next, round ${rounds[i].n} of ${rounds[i].of}` : 'Next';
    return `<div class="p-next">
      <p class="p-next-label">${label}</p>
      <div class="p-next-row">
        ${thumb(ex, 'md')}
        <span>
          <span class="p-next-name">${esc(ex.name)}</span>
          <span class="p-next-target">${stepTarget(step)}</span>
        </span>
      </div>
    </div>`;
  }

  function draw() {
    if (!running && !finished) {
      // Shown only when the page was opened directly (sound needs a tap first).
      root.className = 'player phase-ready';
      root.innerHTML = `<div class="p-start">
        <h1 class="p-title">${esc(workout.name)}</h1>
        <p class="p-sub">${taskTotal === 1 ? '1 exercise' : `${taskTotal} exercises`}</p>
        <button class="p-btn p-btn-main" data-act="begin">${icon.play}Start</button>
        <a class="p-link" href="#/workouts/${workoutId}">Back</a>
      </div>`;
      return;
    }

    if (finished) {
      const totalSec = Math.round((Date.now() - (startedAt ?? Date.now()) - pausedTotal) / 1000);
      root.className = 'player phase-done';
      root.innerHTML = `<div class="p-start">
        <h1 class="p-title">Workout complete</h1>
        <p class="p-sub">${esc(workout.name)}</p>
        <dl class="p-stats">
          <div><dt>Time</dt><dd>${formatClock(totalSec)}${totalSec < 60 ? '<small>s</small>' : ''}</dd></div>
          <div><dt>Exercises</dt><dd>${taskTotal}</dd></div>
        </dl>
        <a class="btn btn-primary btn-lg btn-block" href="#/workouts/${workoutId}">${icon.check}Done</a>
      </div>`;
      return;
    }

    const step = current();
    const phase = step.type === 'ready' ? 'ready' : step.type === 'rest' ? 'rest' : 'work';
    root.className = `player phase-${phase}${paused ? ' is-paused' : ''}`;

    const segs = steps
      .map((s, i) => `<span class="pseg${s.type === 'rest' ? ' pseg-rest' : ''}${i < index ? ' is-done' : ''}${i === index ? ' is-current' : ''}"><i></i></span>`)
      .join('');

    const doneCount = index < 0 ? 0 : tasksBefore[index];
    const status = paused ? 'Paused' : `${doneCount} of ${taskTotal} done`;

    let main;
    if (phase === 'work') {
      const ex = exById.get(step.exerciseId);
      const url = exerciseImageUrl(ex);
      main = `
        ${url ? `<img class="p-image" src="${url}" alt="">` : ''}
        ${rounds[index] ? `<p class="p-round">${roundLabel(rounds[index])}</p>` : ''}
        <h1 class="p-name">${esc(ex.name)}</h1>
        ${step.type === 'reps'
          ? `<div class="p-clock p-reps">${step.reps}<span>reps</span></div>`
          : '<div class="p-clock" id="clock"></div>'}
        ${ex.description ? `<p class="p-desc" data-act="desc">${esc(ex.description)}</p>` : ''}`;
    } else {
      const next = nextTaskFrom(index + 1);
      main = `
        <p class="p-phase">${phase === 'ready' ? 'Get ready' : 'Rest'}</p>
        <div class="p-clock" id="clock"></div>
        ${next >= 0 ? nextCard(next) : '<p class="p-next-label">Last rest, then you are done</p>'}`;
    }

    const controls = step.type === 'reps'
      ? `<button class="p-btn p-btn-main" data-act="next">${icon.check}Done</button>`
      : `<button class="p-btn" data-act="pause">${paused ? `${icon.play}Resume` : `${icon.pause}Pause`}</button>
         <button class="p-btn" data-act="next">${icon.skip}Skip</button>`;

    root.innerHTML = `
      <div class="p-top">
        <div class="p-segs" aria-hidden="true">${segs}</div>
        <div class="p-bar">
          <button class="p-close" data-act="stop" aria-label="Stop workout">${icon.close}</button>
          <span class="p-status" role="status">${status}</span>
        </div>
      </div>
      <div class="p-main">${main}</div>
      <div class="p-controls">${controls}</div>`;

    if (endTime != null) paintClock(remaining());
  }

  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    if (act === 'begin') begin();
    else if (act === 'pause') togglePause();
    else if (act === 'next') skip();
    else if (act === 'stop') stop();
    else if (act === 'desc') target.classList.toggle('is-open');
  });

  if (isAudioUnlocked()) begin();
  else draw();

  return () => {
    running = false;
    clearInterval(timer);
    releaseLock();
    document.removeEventListener('visibilitychange', onVisibility);
    document.body.classList.remove('playing');
    document.querySelectorAll('dialog.sheet').forEach((d) => d.close());
  };
}
