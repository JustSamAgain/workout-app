import { repo } from './db.js';
import { esc, workoutStats } from './utils.js';
import { promptDialog } from './ui.js';
import { icon } from './icons.js';
import { unlockAudio } from './audio.js';
import { nav } from './state.js';
import { viewPlayer } from './player.js';
import { viewWorkoutEditor } from './editor.js';
import { viewExercises, viewExerciseForm } from './exercises.js';
import { viewShare, viewShareSelect } from './share.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

// ---------- Router ----------

const routes = [
  [/^#\/workouts$/, viewWorkouts, 'workouts'],
  [/^#\/workouts\/([\w-]+)\/play$/, viewPlayer, null],
  [/^#\/workouts\/([\w-]+)$/, viewWorkoutEditor, null],
  [/^#\/exercises$/, viewExercises, 'exercises'],
  [/^#\/exercises\/new$/, viewExerciseForm, null],
  [/^#\/exercises\/([\w-]+)$/, viewExerciseForm, null],
  [/^#\/share$/, viewShare, 'share'],
  [/^#\/share\/select$/, viewShareSelect, null],
];

let cleanup = null;
let renderToken = 0;

async function route() {
  if (!location.hash || location.hash === '#/') {
    history.replaceState(null, '', '#/workouts');
  }
  const hash = location.hash;
  if (cleanup) {
    try { cleanup(); } catch (err) { console.error(err); }
    cleanup = null;
  }
  document.querySelectorAll('dialog.sheet').forEach((d) => d.close());
  const token = ++renderToken;
  const ctx = { stale: () => token !== renderToken };

  for (const [pattern, render, tab] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    if (render !== viewExerciseForm) nav.returnTo = null;
    tabbar.hidden = !tab;
    tabbar.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === tab));
    try {
      const result = await render(view, match, ctx);
      if (ctx.stale()) result?.();
      else cleanup = result || null;
    } catch (err) {
      console.error(err);
      if (!ctx.stale()) {
        view.innerHTML = `<div class="empty"><p class="empty-title">Something went wrong</p><p>${esc(err.message)}</p><a class="btn btn-primary" href="#/workouts">Go to workouts</a></div>`;
      }
    }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/workouts';
}

window.addEventListener('hashchange', route);

// Any "start workout" tap unlocks sound, which browsers only allow during a tap.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-start]')) unlockAudio();
});

route();

// ---------- Workouts list ----------

async function viewWorkouts(view, match, ctx) {
  const [workouts, exercises] = await Promise.all([repo.listWorkouts(), repo.listExercises()]);
  if (ctx.stale()) return;
  const exById = new Map(exercises.map((e) => [e.id, e]));

  const list = workouts
    .map((w) => {
      const st = workoutStats(w, exById);
      return `<li class="row">
        <a class="row-main" href="#/workouts/${w.id}">
          <span class="row-title">${esc(w.name)}</span>
          <span class="row-meta">${esc(st.summary)}</span>
        </a>
        ${st.tasks ? `<a class="row-play" href="#/workouts/${w.id}/play" data-start aria-label="Start ${esc(w.name)}">${icon.play}</a>` : ''}
      </li>`;
    })
    .join('');

  const empty = exercises.length
    ? `<div class="empty">
        <p class="empty-title">No workouts yet</p>
        <p>Create a workout, then add exercises and rests in the order you want to do them.</p>
        <button class="btn btn-primary" data-new-workout>${icon.plus}Create workout</button>
      </div>`
    : `<div class="empty">
        <p class="empty-title">No workouts yet</p>
        <p>Start by adding the exercises you do. Then build workouts from them.</p>
        <a class="btn btn-primary" href="#/exercises/new">${icon.plus}Add exercise</a>
      </div>`;

  view.innerHTML = `
    <header class="page-head">
      <h1>Workouts</h1>
      ${workouts.length ? `<button class="btn btn-primary btn-sm" data-new-workout>${icon.plus}New</button>` : ''}
    </header>
    ${workouts.length ? `<ul class="list">${list}</ul>` : empty}`;

  view.querySelectorAll('[data-new-workout]').forEach((b) => b.addEventListener('click', createWorkout));
}

async function createWorkout() {
  const name = await promptDialog({
    title: 'New workout',
    label: 'Name',
    placeholder: 'e.g. Morning core',
    confirm: 'Create workout',
  });
  if (name == null) return;
  const workout = await repo.saveWorkout({ name: name.trim() || 'Untitled workout', steps: [] });
  location.hash = `#/workouts/${workout.id}`;
}
