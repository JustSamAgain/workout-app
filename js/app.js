import { repo, newId } from './db.js';
import { esc, formatDuration, stepTarget, workoutStats, exerciseImageUrl, thumb, resizeImage } from './utils.js';
import { openSheet, confirmDialog, promptDialog } from './ui.js';
import { icon } from './icons.js';
import { unlockAudio } from './audio.js';
import { viewPlayer } from './player.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

// Where to go after saving a new exercise (set when it was started from a workout).
let returnTo = null;

// ---------- Router ----------

const routes = [
  [/^#\/workouts$/, viewWorkouts, 'workouts'],
  [/^#\/workouts\/([\w-]+)\/play$/, viewPlayer, null],
  [/^#\/workouts\/([\w-]+)$/, viewWorkoutEditor, null],
  [/^#\/exercises$/, viewExercises, 'exercises'],
  [/^#\/exercises\/new$/, viewExerciseForm, null],
  [/^#\/exercises\/([\w-]+)$/, viewExerciseForm, null],
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
  const token = ++renderToken;
  const ctx = { stale: () => token !== renderToken };

  for (const [pattern, render, tab] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    if (render !== viewExerciseForm) returnTo = null;
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

// ---------- Shared bits ----------

function notFound(message, href, label) {
  return `<div class="empty"><p class="empty-title">Not found</p><p>${esc(message)}</p><a class="btn btn-primary" href="${href}">${esc(label)}</a></div>`;
}

function backLink(href, label) {
  return `<header class="page-head page-head--sub"><a class="back" href="${href}">${icon.back}<span>${esc(label)}</span></a></header>`;
}

// ---------- Workouts list ----------

async function viewWorkouts(view, match, ctx) {
  const [workouts, exercises] = await Promise.all([repo.listWorkouts(), repo.listExercises()]);
  if (ctx.stale()) return;
  const exerciseIds = new Set(exercises.map((e) => e.id));

  const list = workouts
    .map((w) => {
      const st = workoutStats(w, exerciseIds);
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

// ---------- Workout editor ----------

async function viewWorkoutEditor(view, match, ctx) {
  const id = match[1];
  const [workout, exercises] = await Promise.all([repo.getWorkout(id), repo.listExercises()]);
  if (ctx.stale()) return;
  if (!workout) {
    view.innerHTML = notFound('This workout no longer exists.', '#/workouts', 'Back to workouts');
    return;
  }
  const exById = new Map(exercises.map((e) => [e.id, e]));

  const persist = async () => {
    const saved = await repo.saveWorkout(workout);
    Object.assign(workout, { id: saved.id, createdAt: saved.createdAt, updatedAt: saved.updatedAt });
  };

  // New steps start with the values of the last step of the same kind.
  const defaults = () => {
    const lastTask = [...workout.steps].reverse().find((s) => s.type !== 'rest');
    const lastRest = [...workout.steps].reverse().find((s) => s.type === 'rest');
    return {
      mode: lastTask?.type ?? 'time',
      seconds: lastTask?.type === 'time' ? lastTask.seconds : 45,
      reps: lastTask?.type === 'reps' ? lastTask.reps : 12,
      rest: lastRest?.seconds ?? 30,
    };
  };

  function stepRow(step, i, number) {
    const last = workout.steps.length - 1;
    const move = `<div class="step-move">
        <button class="icon-btn" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
        <button class="icon-btn" data-down="${i}" aria-label="Move down" ${i === last ? 'disabled' : ''}>${icon.down}</button>
      </div>`;
    if (step.type === 'rest') {
      return `<li class="step step-rest">
        <span class="step-num"></span>
        <button class="step-body" data-edit="${i}"><span class="rest-pill">Rest ${formatDuration(step.seconds)}</span></button>
        ${move}
      </li>`;
    }
    const ex = exById.get(step.exerciseId);
    return `<li class="step step-task">
      <span class="step-num">${number}</span>
      <button class="step-body" data-edit="${i}">
        ${thumb(ex, 'sm')}
        <span class="step-text">
          <span class="step-name">${esc(ex?.name ?? 'Missing exercise')}</span>
          <span class="step-target">${stepTarget(step)}</span>
        </span>
      </button>
      ${move}
    </li>`;
  }

  function draw() {
    const st = workoutStats(workout, new Set(exById.keys()));
    let n = 0;
    const steps = workout.steps.map((s, i) => stepRow(s, i, s.type === 'rest' ? null : ++n)).join('');

    view.innerHTML = `
      ${backLink('#/workouts', 'Workouts')}
      <div class="title-edit">
        <input class="title-input" id="workoutName" value="${esc(workout.name)}" aria-label="Workout name" maxlength="60" enterkeyhint="done" autocomplete="off">
        <p class="row-meta">${esc(st.summary)}</p>
      </div>
      ${workout.steps.length
        ? `<ol class="steps">${steps}</ol>`
        : `<p class="hint">Add exercises and rests in the order you want to do them.</p>`}
      <div class="add-row">
        <button class="btn btn-secondary" id="addTask">${icon.plus}Exercise</button>
        <button class="btn btn-secondary" id="addRest">${icon.plus}Rest</button>
      </div>
      <button class="btn-text btn-danger" id="deleteWorkout">Delete workout</button>
      <div class="dock">
        <a class="btn btn-primary btn-block btn-lg${st.tasks ? '' : ' is-disabled'}" ${st.tasks ? `href="#/workouts/${workout.id}/play" data-start` : 'aria-disabled="true"'}>${icon.play}Start workout</a>
      </div>`;

    const nameInput = view.querySelector('#workoutName');
    nameInput.addEventListener('change', async () => {
      workout.name = nameInput.value.trim() || 'Untitled workout';
      nameInput.value = workout.name;
      await persist();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });

    view.querySelector('#addTask').addEventListener('click', async () => {
      const result = await taskSheet({ step: null, exercises, defaults: defaults(), workoutId: workout.id });
      if (result?.action !== 'save') return;
      workout.steps.push({ id: newId(), ...result.step });
      await persist();
      draw();
    });

    view.querySelector('#addRest').addEventListener('click', async () => {
      const result = await restSheet({ step: null, defaults: defaults() });
      if (result?.action !== 'save') return;
      workout.steps.push({ id: newId(), ...result.step });
      await persist();
      draw();
    });

    view.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.edit);
        const step = workout.steps[i];
        const result = step.type === 'rest'
          ? await restSheet({ step, defaults: defaults() })
          : await taskSheet({ step, exercises, defaults: defaults(), workoutId: workout.id });
        if (!result) return;
        if (result.action === 'delete') workout.steps.splice(i, 1);
        else workout.steps[i] = { id: step.id, ...result.step };
        await persist();
        draw();
      })
    );

    const move = async (from, to) => {
      if (to < 0 || to >= workout.steps.length) return;
      const [step] = workout.steps.splice(from, 1);
      workout.steps.splice(to, 0, step);
      await persist();
      draw();
    };
    view.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), Number(b.dataset.up) - 1)));
    view.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), Number(b.dataset.down) + 1)));

    view.querySelector('#deleteWorkout').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete workout?',
        message: `"${workout.name}" will be removed. Your exercises stay in the library.`,
        confirm: 'Delete workout',
        danger: true,
      });
      if (!ok) return;
      await repo.deleteWorkout(workout.id);
      location.hash = '#/workouts';
    });
  }

  draw();
}

// ---------- Step sheets ----------

function durationFields(seconds) {
  const presets = [15, 30, 45, 60, 90, 120];
  return `<div class="duration">
      <label class="dur-part"><input type="number" inputmode="numeric" name="min" min="0" max="99" value="${Math.floor(seconds / 60)}" aria-label="Minutes"><span>min</span></label>
      <label class="dur-part"><input type="number" inputmode="numeric" name="sec" min="0" max="59" value="${seconds % 60}" aria-label="Seconds"><span>sec</span></label>
    </div>
    <div class="presets">${presets.map((p) => `<button type="button" class="chip" data-preset="${p}">${formatDuration(p)}</button>`).join('')}</div>`;
}

function wireDuration(form) {
  form.querySelectorAll('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = Number(b.dataset.preset);
      form.elements.min.value = Math.floor(p / 60);
      form.elements.sec.value = p % 60;
    })
  );
  return () => (Number(form.elements.min.value) || 0) * 60 + (Number(form.elements.sec.value) || 0);
}

function showError(form, message) {
  const el = form.querySelector('.form-error');
  el.textContent = message;
  el.hidden = false;
}

function taskSheet({ step, exercises, defaults, workoutId }) {
  const isNew = !step;
  const mode = step?.type ?? defaults.mode;
  const seconds = step?.type === 'time' ? step.seconds : defaults.seconds;
  const reps = step?.type === 'reps' ? step.reps : defaults.reps;
  const selected = step?.exerciseId ?? null;

  const picker = exercises.length
    ? `<div class="pick-list" role="radiogroup" aria-label="Exercise">
        ${exercises.map((e) => `<label class="pick${e.id === selected ? ' is-selected' : ''}">
            <input type="radio" name="exercise" value="${e.id}" ${e.id === selected ? 'checked' : ''}>
            ${thumb(e, 'sm')}<span>${esc(e.name)}</span>
          </label>`).join('')}
      </div>
      <a class="btn-text" href="#/exercises/new" data-new-exercise>${icon.plus}New exercise</a>`
    : `<p class="sheet-text">Your exercise library is empty. Add an exercise first, then come back to this workout.</p>
      <a class="btn btn-primary" href="#/exercises/new" data-new-exercise>${icon.plus}Add exercise</a>`;

  return openSheet(
    `<form class="sheet-body" data-mode="${mode}" novalidate>
      <h2 class="sheet-title">${isNew ? 'Add exercise' : 'Edit exercise'}</h2>
      ${picker}
      <div class="seg" role="radiogroup" aria-label="Measure by">
        <label><input type="radio" name="mode" value="time" ${mode === 'time' ? 'checked' : ''}><span>Time</span></label>
        <label><input type="radio" name="mode" value="reps" ${mode === 'reps' ? 'checked' : ''}><span>Reps</span></label>
      </div>
      <div class="mode-time">${durationFields(seconds)}</div>
      <div class="mode-reps">
        <div class="stepper">
          <button type="button" data-reps="-1" aria-label="Fewer reps">−</button>
          <input type="number" inputmode="numeric" name="reps" min="1" max="999" value="${reps}" aria-label="Reps">
          <button type="button" data-reps="1" aria-label="More reps">+</button>
        </div>
      </div>
      <p class="form-error" hidden></p>
      <div class="sheet-actions">
        ${isNew ? '' : '<button type="button" class="btn-text btn-danger" data-delete>Remove</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </form>`,
    (dlg, done) => {
      const form = dlg.querySelector('form');
      const readSeconds = wireDuration(form);

      form.querySelectorAll('input[name="exercise"]').forEach((r) =>
        r.addEventListener('change', () => {
          form.querySelectorAll('.pick').forEach((p) => p.classList.toggle('is-selected', p.contains(r) && r.checked));
        })
      );
      form.querySelectorAll('input[name="mode"]').forEach((r) =>
        r.addEventListener('change', () => { form.dataset.mode = r.value; })
      );
      form.querySelectorAll('[data-reps]').forEach((b) =>
        b.addEventListener('click', () => {
          const next = (Number(form.elements.reps.value) || 0) + Number(b.dataset.reps);
          form.elements.reps.value = Math.max(1, next);
        })
      );
      form.querySelector('[data-new-exercise]')?.addEventListener('click', () => {
        returnTo = `#/workouts/${workoutId}`;
        done(null);
      });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.querySelector('[data-delete]')?.addEventListener('click', () => done({ action: 'delete' }));

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const exerciseId = form.querySelector('input[name="exercise"]:checked')?.value;
        if (!exerciseId) return showError(form, 'Choose an exercise.');
        if (form.dataset.mode === 'time') {
          const secs = readSeconds();
          if (secs < 1) return showError(form, 'Set a time of at least 1 second.');
          done({ action: 'save', step: { type: 'time', exerciseId, seconds: secs } });
        } else {
          const r = Math.round(Number(form.elements.reps.value));
          if (!(r >= 1)) return showError(form, 'Set at least 1 rep.');
          done({ action: 'save', step: { type: 'reps', exerciseId, reps: r } });
        }
      });
    }
  );
}

function restSheet({ step, defaults }) {
  const isNew = !step;
  return openSheet(
    `<form class="sheet-body" novalidate>
      <h2 class="sheet-title">${isNew ? 'Add rest' : 'Edit rest'}</h2>
      ${durationFields(step?.seconds ?? defaults.rest)}
      <p class="form-error" hidden></p>
      <div class="sheet-actions">
        ${isNew ? '' : '<button type="button" class="btn-text btn-danger" data-delete>Remove</button>'}
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </form>`,
    (dlg, done) => {
      const form = dlg.querySelector('form');
      const readSeconds = wireDuration(form);
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.querySelector('[data-delete]')?.addEventListener('click', () => done({ action: 'delete' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const secs = readSeconds();
        if (secs < 1) return showError(form, 'Set a rest of at least 1 second.');
        done({ action: 'save', step: { type: 'rest', seconds: secs } });
      });
    }
  );
}

// ---------- Exercise library ----------

async function viewExercises(view, match, ctx) {
  const exercises = await repo.listExercises();
  if (ctx.stale()) return;

  view.innerHTML = `
    <header class="page-head">
      <h1>Exercises</h1>
      ${exercises.length ? `<a class="btn btn-primary btn-sm" href="#/exercises/new">${icon.plus}New</a>` : ''}
    </header>
    ${exercises.length
      ? `<ul class="list">${exercises.map((e) => `<li>
          <a class="ex-row" href="#/exercises/${e.id}">
            ${thumb(e)}
            <span class="ex-text">
              <span class="row-title">${esc(e.name)}</span>
              ${e.description ? `<span class="row-meta clamp">${esc(e.description)}</span>` : ''}
            </span>
          </a>
        </li>`).join('')}</ul>`
      : `<div class="empty">
          <p class="empty-title">No exercises yet</p>
          <p>Add each exercise once with a photo and a short description. You can then use it in as many workouts as you like.</p>
          <a class="btn btn-primary" href="#/exercises/new">${icon.plus}Add exercise</a>
        </div>`}`;
}

async function viewExerciseForm(view, match, ctx) {
  const id = match[1] ?? null;
  const existing = id ? await repo.getExercise(id) : null;
  if (ctx.stale()) return;
  if (id && !existing) {
    view.innerHTML = notFound('This exercise no longer exists.', '#/exercises', 'Back to exercises');
    return;
  }

  const back = returnTo || '#/exercises';
  let image = existing?.image ?? null;
  let ownUrl = null; // object URL created here for a newly picked photo

  view.innerHTML = `
    ${backLink(back, returnTo ? 'Back to workout' : 'Exercises')}
    <form class="form" id="exerciseForm" novalidate>
      <h1 class="form-title">${existing ? 'Edit exercise' : 'New exercise'}</h1>
      <div class="photo-field">
        <label class="photo" id="photo">
          <input type="file" accept="image/*" id="photoInput" class="visually-hidden">
          <span class="photo-inner" id="photoInner"></span>
        </label>
        <button type="button" class="btn-text btn-danger" id="removePhoto">Remove photo</button>
      </div>
      <label class="field">
        <span class="field-label">Name</span>
        <input name="name" maxlength="80" autocomplete="off" value="${esc(existing?.name ?? '')}" placeholder="e.g. Push-ups">
      </label>
      <label class="field">
        <span class="field-label">Description</span>
        <textarea name="description" rows="5" placeholder="How to do it and what to watch out for">${esc(existing?.description ?? '')}</textarea>
      </label>
      <p class="form-error" hidden></p>
      ${existing ? '<button type="button" class="btn-text btn-danger" id="deleteExercise">Delete exercise</button>' : ''}
      <div class="dock"><button class="btn btn-primary btn-block btn-lg" type="submit">Save exercise</button></div>
    </form>`;

  const form = view.querySelector('#exerciseForm');
  const photo = view.querySelector('#photo');
  const photoInner = view.querySelector('#photoInner');
  const removeBtn = view.querySelector('#removePhoto');

  function paintPhoto() {
    const url = ownUrl || (image && existing?.image === image ? exerciseImageUrl(existing) : null);
    photo.classList.toggle('has-image', !!url);
    photoInner.innerHTML = url
      ? `<img src="${url}" alt="Exercise photo"><span class="photo-change">Change photo</span>`
      : `<span class="photo-empty">${icon.photo}<span>Add photo</span></span>`;
    removeBtn.hidden = !url;
  }
  paintPhoto();

  view.querySelector('#photoInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      image = await resizeImage(file);
      if (ownUrl) URL.revokeObjectURL(ownUrl);
      ownUrl = URL.createObjectURL(image);
      paintPhoto();
    } catch (err) {
      showError(form, err.message);
    }
  });

  removeBtn.addEventListener('click', () => {
    image = null;
    if (ownUrl) URL.revokeObjectURL(ownUrl);
    ownUrl = null;
    paintPhoto();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) {
      showError(form, 'Give the exercise a name.');
      form.elements.name.focus();
      return;
    }
    await repo.saveExercise({
      ...existing,
      name,
      description: form.elements.description.value.trim(),
      image,
    });
    const target = returnTo || '#/exercises';
    returnTo = null;
    location.hash = target;
  });

  view.querySelector('#deleteExercise')?.addEventListener('click', async () => {
    const used = await repo.countWorkoutsUsing(existing.id);
    const ok = await confirmDialog({
      title: 'Delete exercise?',
      message: used
        ? `"${existing.name}" is used in ${used === 1 ? '1 workout' : `${used} workouts`}. It will be removed from ${used === 1 ? 'that workout' : 'those workouts'} too.`
        : `"${existing.name}" will be removed from your library.`,
      confirm: 'Delete exercise',
      danger: true,
    });
    if (!ok) return;
    await repo.deleteExercise(existing.id);
    location.hash = '#/exercises';
  });

  return () => {
    if (ownUrl) URL.revokeObjectURL(ownUrl);
  };
}
