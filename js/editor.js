import { repo, newId } from './db.js';
import { esc, formatDuration, stepTarget, workoutStats, allSteps, thumb } from './utils.js';
import { openSheet, confirmDialog, stepper, wireStepper } from './ui.js';
import { icon } from './icons.js';
import { nav } from './state.js';
import { usedTags, hasAllTags, filterChips, wireChips } from './tags.js';
import { shareItemSheet, shareButton } from './share.js';
import { showError } from './exercises.js';

const MAX_ROUNDS = 99;

// A step is addressed by its position: [i] at the top level, [i, j] inside the repeat block at i.
const parsePath = (s) => s.split('.').map(Number);

export async function viewWorkoutEditor(view, match, ctx) {
  const id = match[1];
  const [workout, exercises] = await Promise.all([repo.getWorkout(id), repo.listExercises()]);
  if (ctx.stale()) return;
  if (!workout) {
    view.innerHTML = `<div class="empty"><p class="empty-title">Not found</p><p>This workout no longer exists.</p><a class="btn btn-primary" href="#/workouts">Back to workouts</a></div>`;
    return;
  }
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const top = workout.steps;

  const persist = async () => {
    const saved = await repo.saveWorkout(workout);
    Object.assign(workout, { id: saved.id, createdAt: saved.createdAt, updatedAt: saved.updatedAt });
  };

  // New steps start with the values of the last step of the same kind.
  const defaults = () => {
    const flat = allSteps(top).reverse();
    const lastTask = flat.find((s) => s.type !== 'rest');
    const lastRest = flat.find((s) => s.type === 'rest');
    return {
      mode: lastTask?.type ?? 'time',
      seconds: lastTask?.type === 'time' ? lastTask.seconds : 45,
      reps: lastTask?.type === 'reps' ? lastTask.reps : 12,
      rest: lastRest?.seconds ?? 30,
    };
  };

  const listOf = ([i, j]) => (j === undefined ? top : top[i].steps);
  const indexOf = ([i, j]) => (j === undefined ? i : j);

  // ----- moving with the arrows -----
  // Top-level steps move into a neighbouring repeat block; steps at the edge of a block move out of it.
  function moveUp(path) {
    const [i, j] = path;
    if (j === undefined) {
      if (i === 0) return;
      const [s] = top.splice(i, 1);
      const prev = top[i - 1];
      if (s.type !== 'repeat' && prev.type === 'repeat') prev.steps.push(s);
      else top.splice(i - 1, 0, s);
    } else {
      const block = top[i];
      const [s] = block.steps.splice(j, 1);
      if (j === 0) top.splice(i, 0, s);
      else block.steps.splice(j - 1, 0, s);
    }
  }

  function moveDown(path) {
    const [i, j] = path;
    if (j === undefined) {
      if (i === top.length - 1) return;
      const [s] = top.splice(i, 1);
      const next = top[i]; // the former i + 1
      if (s.type !== 'repeat' && next.type === 'repeat') next.steps.unshift(s);
      else top.splice(i + 1, 0, s);
    } else {
      const block = top[i];
      const [s] = block.steps.splice(j, 1);
      if (j === block.steps.length) top.splice(i + 1, 0, s);
      else block.steps.splice(j + 1, 0, s);
    }
  }

  // ----- rendering -----
  function moveButtons(pathStr, upDisabled, downDisabled) {
    return `<div class="step-move">
      <button class="icon-btn" data-up="${pathStr}" aria-label="Move up" ${upDisabled ? 'disabled' : ''}>${icon.up}</button>
      <button class="icon-btn" data-down="${pathStr}" aria-label="Move down" ${downDisabled ? 'disabled' : ''}>${icon.down}</button>
    </div>`;
  }

  function stepRow(step, pathStr, number, upDisabled, downDisabled) {
    const move = moveButtons(pathStr, upDisabled, downDisabled);
    if (step.type === 'rest') {
      return `<li class="step step-rest" data-id="${step.id}">
        <span class="step-num"></span>
        <button class="step-body" data-edit="${pathStr}"><span class="rest-pill">Rest ${formatDuration(step.seconds)}</span></button>
        ${move}
      </li>`;
    }
    const ex = exById.get(step.exerciseId);
    return `<li class="step step-task" data-id="${step.id}">
      <span class="step-num">${number}</span>
      <button class="step-body" data-edit="${pathStr}">
        ${thumb(ex, 'sm')}
        <span class="step-text">
          <span class="step-name">${esc(ex?.name ?? 'Missing exercise')}</span>
          <span class="step-target">${stepTarget(step)}</span>
        </span>
      </button>
      ${move}
    </li>`;
  }

  function draw(focus = null) {
    const st = workoutStats(workout, new Set(exById.keys()));
    let n = 0;
    const last = top.length - 1;
    const rows = top
      .map((s, i) => {
        if (s.type !== 'repeat') return stepRow(s, `${i}`, s.type === 'rest' ? null : ++n, i === 0, i === last);
        const kids = s.steps.map((k, j) => stepRow(k, `${i}.${j}`, k.type === 'rest' ? null : ++n, false, false)).join('');
        return `<li class="block" data-id="${s.id}">
          <div class="block-head">
            <button class="block-title" data-edit-block="${i}" aria-label="Edit repeat, ${s.rounds} rounds">${icon.repeat}<span>${s.rounds} rounds</span></button>
            ${moveButtons(`${i}`, i === 0, i === last)}
          </div>
          ${kids ? `<ol class="steps block-steps">${kids}</ol>` : '<p class="hint block-hint">Add the exercises and rests to repeat.</p>'}
          <div class="add-row add-row-block">
            <button class="btn btn-secondary" data-add-task="${i}">${icon.plus}Exercise</button>
            <button class="btn btn-secondary" data-add-rest="${i}">${icon.plus}Rest</button>
          </div>
        </li>`;
      })
      .join('');

    view.innerHTML = `
      <header class="page-head page-head--sub">
        <a class="back" href="#/workouts">${icon.back}<span>Workouts</span></a>
        ${shareButton('Share')}
      </header>
      <div class="title-edit">
        <input class="title-input" id="workoutName" value="${esc(workout.name)}" aria-label="Workout name" maxlength="60" enterkeyhint="done" autocomplete="off">
        <p class="row-meta">${esc(st.summary)}</p>
      </div>
      ${top.length
        ? `<ol class="steps">${rows}</ol>`
        : `<p class="hint">Add exercises and rests in the order you want to do them. Use Repeat to do a group of them several times.</p>`}
      <div class="add-row">
        <button class="btn btn-secondary" id="addTask">${icon.plus}Exercise</button>
        <button class="btn btn-secondary" id="addRest">${icon.plus}Rest</button>
        <button class="btn btn-secondary" id="addRepeat">${icon.plus}Repeat</button>
      </div>
      <button class="btn-text btn-danger" id="deleteWorkout">Delete workout</button>
      <div class="dock">
        <a class="btn btn-primary btn-block btn-lg${st.tasks ? '' : ' is-disabled'}" ${st.tasks ? `href="#/workouts/${workout.id}/play" data-start` : 'aria-disabled="true"'}>${icon.play}Start workout</a>
      </div>`;

    if (focus) {
      const btn = view.querySelector(`[data-id="${focus.id}"] [data-${focus.dir}]`);
      const target = btn && !btn.disabled ? btn : view.querySelector(`[data-id="${focus.id}"] .step-move button:not(:disabled)`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }
    wire();
  }

  async function addStep(list, sheet) {
    const result = await sheet;
    if (result?.action !== 'save') return;
    list.push({ id: newId(), ...result.step });
    await persist();
    draw();
  }

  function wire() {
    const nameInput = view.querySelector('#workoutName');
    nameInput.addEventListener('change', async () => {
      workout.name = nameInput.value.trim() || 'Untitled workout';
      nameInput.value = workout.name;
      await persist();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });

    const taskSheetFor = () => taskSheet({ step: null, exercises, defaults: defaults(), workoutId: workout.id });
    view.querySelector('#addTask').addEventListener('click', () => addStep(top, taskSheetFor()));
    view.querySelector('#addRest').addEventListener('click', () => addStep(top, restSheet({ step: null, defaults: defaults() })));
    view.querySelector('#addRepeat').addEventListener('click', async () => {
      const result = await repeatSheet({ block: null });
      if (result?.action !== 'save') return;
      top.push({ id: newId(), type: 'repeat', rounds: result.rounds, steps: [] });
      await persist();
      draw();
      view.querySelector('.block:last-of-type')?.scrollIntoView({ block: 'nearest' });
    });
    view.querySelectorAll('[data-add-task]').forEach((b) =>
      b.addEventListener('click', () => addStep(top[Number(b.dataset.addTask)].steps, taskSheetFor()))
    );
    view.querySelectorAll('[data-add-rest]').forEach((b) =>
      b.addEventListener('click', () => addStep(top[Number(b.dataset.addRest)].steps, restSheet({ step: null, defaults: defaults() })))
    );

    view.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const path = parsePath(btn.dataset.edit);
        const list = listOf(path);
        const k = indexOf(path);
        const step = list[k];
        const result = step.type === 'rest'
          ? await restSheet({ step, defaults: defaults() })
          : await taskSheet({ step, exercises, defaults: defaults(), workoutId: workout.id });
        if (!result) return;
        if (result.action === 'delete') list.splice(k, 1);
        else list[k] = { id: step.id, ...result.step };
        await persist();
        draw();
      })
    );

    view.querySelectorAll('[data-edit-block]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.editBlock);
        const block = top[i];
        const result = await repeatSheet({ block });
        if (!result) return;
        if (result.action === 'save') block.rounds = result.rounds;
        else if (result.action === 'ungroup') top.splice(i, 1, ...block.steps);
        else if (result.action === 'delete') top.splice(i, 1);
        await persist();
        draw();
      })
    );

    const onMove = (fn, dir) => async (e) => {
      const path = parsePath(e.currentTarget.dataset[dir]);
      const moved = listOf(path)[indexOf(path)];
      fn(path);
      await persist();
      draw({ id: moved.id, dir });
    };
    view.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', onMove(moveUp, 'up')));
    view.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', onMove(moveDown, 'down')));

    view.querySelector('[data-share-item]').addEventListener('click', () =>
      shareItemSheet({ name: workout.name, workoutIds: [workout.id] })
    );

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

// ---------- Sheets ----------

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

function sheetActions(isNew, deleteLabel = 'Remove') {
  return `<div class="sheet-actions">
    ${isNew ? '' : `<button type="button" class="btn-text btn-danger" data-delete>${deleteLabel}</button>`}
    <span class="spacer"></span>
    <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
    <button type="submit" class="btn btn-primary">${isNew ? 'Add' : 'Save'}</button>
  </div>`;
}

function taskSheet({ step, exercises, defaults, workoutId }) {
  const isNew = !step;
  const mode = step?.type ?? defaults.mode;
  const seconds = step?.type === 'time' ? step.seconds : defaults.seconds;
  const reps = step?.type === 'reps' ? step.reps : defaults.reps;
  const selected = step?.exerciseId ?? null;
  const tags = usedTags(exercises);
  const filter = new Set();

  const picker = exercises.length
    ? `${tags.length ? `<div class="chip-scroll chip-scroll-sheet" role="group" aria-label="Filter by tag">${filterChips(tags, filter)}</div>` : ''}
      <div class="pick-list" role="radiogroup" aria-label="Exercise">
        ${exercises.map((e) => `<label class="pick${e.id === selected ? ' is-selected' : ''}" data-ex="${e.id}">
            <input type="radio" name="exercise" value="${e.id}" ${e.id === selected ? 'checked' : ''}>
            ${thumb(e, 'sm')}<span class="pick-text"><span>${esc(e.name)}</span>${e.tags?.length ? `<span class="row-tags">${esc(e.tags.join(', '))}</span>` : ''}</span>
          </label>`).join('')}
        <p class="pick-empty" hidden>No exercise has all of these tags.</p>
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
      <div class="mode-reps">${stepper('reps', reps, 1, 9999, 'reps')}</div>
      <p class="form-error" hidden></p>
      ${sheetActions(isNew)}
    </form>`,
    (dlg, done) => {
      const form = dlg.querySelector('form');
      const readSeconds = wireDuration(form);
      const readReps = wireStepper(form, 'reps', 1, 9999);
      const byId = new Map(exercises.map((e) => [e.id, e]));

      wireChips(form, filter, () => {
        let visible = 0;
        form.querySelectorAll('.pick').forEach((p) => {
          const show = hasAllTags(byId.get(p.dataset.ex), filter);
          p.hidden = !show;
          if (show) visible++;
        });
        form.querySelector('.pick-empty').hidden = visible > 0;
      });

      form.querySelectorAll('input[name="exercise"]').forEach((r) =>
        r.addEventListener('change', () => {
          form.querySelectorAll('.pick').forEach((p) => p.classList.toggle('is-selected', p.contains(r) && r.checked));
        })
      );
      form.querySelectorAll('input[name="mode"]').forEach((r) =>
        r.addEventListener('change', () => { form.dataset.mode = r.value; })
      );
      form.querySelector('[data-new-exercise]')?.addEventListener('click', () => {
        nav.returnTo = `#/workouts/${workoutId}`;
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
          const r = readReps();
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
      ${sheetActions(isNew)}
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

function repeatSheet({ block }) {
  const isNew = !block;
  const hasSteps = !!block?.steps.length;
  return openSheet(
    `<form class="sheet-body" novalidate>
      <h2 class="sheet-title">${isNew ? 'Add repeat' : 'Edit repeat'}</h2>
      <p class="sheet-text">The exercises and rests in this block run this many times before the workout moves on. A rest at the end of the block is skipped after the last round.</p>
      <div class="rounds-field">${stepper('rounds', block?.rounds ?? 3, 1, MAX_ROUNDS, 'rounds')}<span>rounds</span></div>
      <p class="form-error" hidden></p>
      ${hasSteps ? `<div class="sheet-extra">
          <button type="button" class="btn-text" data-ungroup>Ungroup, keep the steps</button>
          <button type="button" class="btn-text btn-danger" data-delete>Delete block and its steps</button>
        </div>` : ''}
      <div class="sheet-actions">
        ${!isNew && !hasSteps ? '<button type="button" class="btn-text btn-danger" data-delete>Remove</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </form>`,
    (dlg, done) => {
      const form = dlg.querySelector('form');
      const readRounds = wireStepper(form, 'rounds', 1, MAX_ROUNDS);
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.querySelector('[data-delete]')?.addEventListener('click', () => done({ action: 'delete' }));
      form.querySelector('[data-ungroup]')?.addEventListener('click', () => done({ action: 'ungroup' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const rounds = readRounds();
        if (!(rounds >= 1 && rounds <= MAX_ROUNDS)) return showError(form, `Set between 1 and ${MAX_ROUNDS} rounds.`);
        done({ action: 'save', rounds });
      });
    }
  );
}
