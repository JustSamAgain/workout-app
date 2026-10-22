import { repo } from './db.js';
import { esc, countLabel, formatSize, thumb, workoutStats, allSteps } from './utils.js';
import { openSheet, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { buildExport, readImport } from './transfer.js';
import { usedTags, hasAllTags, filterChips, wireChips } from './tags.js';
import { backupStatus, recordBackup, daysAgo } from './backup.js';

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Opens the phone's share menu. Must be called directly from a tap.
// Returns 'shared', 'saved' (share failed, file downloaded instead) or 'cancelled'.
async function shareFile(file, title) {
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    if (err.name === 'AbortError') return 'cancelled';
    saveFile(file);
    return 'saved';
  }
}

const canShareFile = (file) => !!navigator.canShare?.({ files: [file] });

function contentsLabel({ exerciseCount, workoutCount, photoCount }) {
  const parts = [];
  if (workoutCount) parts.push(countLabel(workoutCount, 'workout', 'workouts'));
  parts.push(countLabel(exerciseCount, 'exercise', 'exercises'));
  let label = parts.join(' and ');
  if (photoCount) label += `, ${countLabel(photoCount, 'photo', 'photos')}`;
  return label;
}

// Sheet for sharing exercises and workouts (workouts bring the exercises they use).
// `name` becomes the file name. With `all`, everything is included and a successful
// share or save counts as a backup. The file is built when the sheet opens, so the
// Share button can open the share menu right on the tap.
export function shareItemSheet({ name, title = `Share ${name}`, exerciseIds = [], workoutIds = [], all = false }) {
  const hint = all
    ? 'Save the file somewhere other than this phone, for example in Files, iCloud Drive or Google Drive, or send it to yourself.'
    : 'Send the file to a friend. They open the Share tab in their app and choose Import.';
  return openSheet(
    `<div class="sheet-body">
      <h2 class="sheet-title">${esc(title)}</h2>
      <p class="sheet-text" data-info>Preparing file…</p>
      <p class="sheet-text">${hint}</p>
      <p class="notice" data-done role="status" hidden>Backup saved.</p>
      <div class="sheet-stack">
        <button type="button" class="btn btn-primary btn-block" data-share hidden>${icon.share}Share file</button>
        <button type="button" class="btn btn-secondary btn-block" data-save disabled>${icon.download}Save file</button>
        <button type="button" class="btn-text sheet-close" data-cancel>Close</button>
      </div>
    </div>`,
    async (dlg, done) => {
      dlg.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      const info = dlg.querySelector('[data-info]');
      const shareBtn = dlg.querySelector('[data-share]');
      const saveBtn = dlg.querySelector('[data-save]');
      try {
        const result = await buildExport({ name, exerciseIds, workoutIds, all });
        info.textContent = `${contentsLabel(result)}, ${formatSize(result.file.size)}`;
        shareBtn.hidden = !canShareFile(result.file);
        saveBtn.disabled = false;
        const finished = async (outcome) => {
          if (!all || outcome === 'cancelled') return;
          await recordBackup();
          dlg.querySelector('[data-done]').hidden = false;
        };
        shareBtn.addEventListener('click', async () => finished(await shareFile(result.file, name)));
        saveBtn.addEventListener('click', () => {
          saveFile(result.file);
          finished('saved');
        });
      } catch (err) {
        info.textContent = `The file could not be created: ${err.message}`;
      }
    }
  );
}

export function shareButton(label) {
  return `<button type="button" class="btn-text head-action" data-share-item>${icon.share}<span>${esc(label)}</span></button>`;
}

// ---------- Share tab: export & import ----------

export function backupSheet() {
  const date = new Date().toISOString().slice(0, 10);
  return shareItemSheet({ name: `workouts-backup-${date}`, title: 'Back up everything', all: true });
}

export function lastBackupText(status) {
  return status.lastBackupAt ? `Last backup: ${daysAgo(status.daysSince)}` : 'No backup yet';
}

export async function viewShare(view, match, ctx) {
  const status = await backupStatus();
  if (ctx.stale()) return;
  view.innerHTML = `
    <header class="page-head"><h1>Share</h1></header>

    ${status.hasData ? `<section class="section" aria-labelledby="backupTitle">
      <h2 class="section-title" id="backupTitle">Backup</h2>
      <p class="section-text">Your exercises and workouts are only stored on this phone. A backup is one file with everything, photos included. Keep it somewhere else.</p>
      <p class="row-meta backup-status${status.due ? ' is-due' : ''}" id="backupStatus">${lastBackupText(status)}</p>
      <button class="btn btn-primary" id="backupNow">${icon.download}Back up now</button>
    </section>` : ''}

    <section class="section" aria-labelledby="exportTitle">
      <h2 class="section-title" id="exportTitle">Send to a friend</h2>
      <p class="section-text">Pick exercises and workouts and put them, photos included, into one file to send to a friend.</p>
      <a class="btn btn-secondary" href="#/share/select">${icon.share}Choose what to share</a>
    </section>

    <section class="section" aria-labelledby="importTitle">
      <h2 class="section-title" id="importTitle">Import</h2>
      <p class="section-text">Add exercises and workouts from an exported file. Nothing here gets deleted. Items you already have are only updated when the file has a newer version.</p>
      <label class="btn btn-secondary" id="importLabel">
        <input type="file" accept=".json,application/json" id="importInput" class="visually-hidden">
        ${icon.file}<span id="importLabelText">Choose file</span>
      </label>
      <p class="notice" id="importNotice" role="status" hidden></p>
    </section>`;

  view.querySelector('#backupNow')?.addEventListener('click', async () => {
    await backupSheet();
    if (ctx.stale()) return;
    const fresh = await backupStatus();
    const el = view.querySelector('#backupStatus');
    el.textContent = lastBackupText(fresh);
    el.classList.toggle('is-due', fresh.due);
  });

  const notice = view.querySelector('#importNotice');
  const importLabel = view.querySelector('#importLabel');
  const importLabelText = view.querySelector('#importLabelText');

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.toggle('notice-error', isError);
    notice.hidden = false;
  }

  view.querySelector('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    notice.hidden = true;

    let plan;
    try {
      plan = await readImport(file);
    } catch (err) {
      showNotice(err.message, true);
      return;
    }
    const { counts } = plan;
    const inFile = `${countLabel(counts.exercises, 'exercise', 'exercises')} and ${countLabel(counts.workouts, 'workout', 'workouts')}`;

    if (!plan.hasChanges) {
      await confirmDialog({
        title: 'Already up to date',
        message: `This file has ${inFile}. You already have all of them in the same or a newer version.`,
        confirm: 'OK',
        cancel: null,
      });
      return;
    }

    const parts = [];
    if (counts.new) parts.push(`${counts.new} new`);
    if (counts.update) parts.push(`${counts.update} updated`);
    if (counts.same) parts.push(`${counts.same} already up to date`);
    const ok = await confirmDialog({
      title: 'Import file?',
      message: `This file has ${inFile}: ${parts.join(', ')}.`,
      confirm: 'Import',
    });
    if (!ok) return;

    importLabel.classList.add('is-disabled');
    try {
      await plan.apply((done, total) => {
        importLabelText.textContent = `Importing photos ${done} of ${total}…`;
      });
      const changed = [];
      if (counts.new) changed.push(`${counts.new} new`);
      if (counts.update) changed.push(`${counts.update} updated`);
      showNotice(`Imported: ${changed.join(', ')}.`);
    } catch (err) {
      showNotice(`Import failed: ${err.message}`, true);
    } finally {
      importLabel.classList.remove('is-disabled');
      importLabelText.textContent = 'Choose file';
    }
  });
}

// ---------- Choose what to share ----------

const checkBox = `<span class="check-box" aria-hidden="true">${icon.check}</span>`;

export async function viewShareSelect(view, match, ctx) {
  const [workouts, exercises] = await Promise.all([repo.listWorkouts(), repo.listExercises()]);
  if (ctx.stale()) return;

  const back = `<header class="page-head page-head--sub"><a class="back" href="#/share">${icon.back}<span>Share</span></a></header>`;
  if (!workouts.length && !exercises.length) {
    view.innerHTML = `${back}
      <div class="empty">
        <p class="empty-title">Nothing to share yet</p>
        <p>Add some exercises first. Then you can pick which ones to share.</p>
        <a class="btn btn-primary" href="#/exercises/new">${icon.plus}Add exercise</a>
      </div>`;
    return;
  }

  const exerciseIds = new Set(exercises.map((e) => e.id));
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const usesOf = new Map(
    workouts.map((w) => [w.id, new Set(allSteps(w.steps).map((s) => s.exerciseId).filter((id) => exerciseIds.has(id)))])
  );
  const pickedWorkouts = new Set();
  const pickedExercises = new Set(); // chosen directly, not counting those a workout brings along
  const filter = new Set();
  const tags = usedTags(exercises);

  // Exercises that go along because a selected workout uses them.
  const included = () => {
    const set = new Set();
    for (const id of pickedWorkouts) for (const e of usesOf.get(id)) set.add(e);
    return set;
  };
  const allExercisesInFile = () => new Set([...pickedExercises, ...included()]);
  const everythingPicked = () =>
    pickedWorkouts.size === workouts.length && exercises.every((e) => allExercisesInFile().has(e.id));

  view.innerHTML = `
    <header class="page-head page-head--sub">
      <a class="back" href="#/share">${icon.back}<span>Share</span></a>
      <button type="button" class="btn-text head-action" id="toggleAll"></button>
    </header>
    <h1 class="form-title select-title">Choose what to share</h1>
    ${workouts.length ? `
      <section class="pick-section" aria-labelledby="wTitle">
        <h2 class="pick-section-title" id="wTitle">Workouts</h2>
        <p class="row-meta">A workout brings along the exercises it uses.</p>
        <ul class="list">${workouts.map((w) => `<li>
          <label class="check-row">
            <input type="checkbox" class="visually-hidden" data-workout="${w.id}">
            ${checkBox}
            <span class="ex-text">
              <span class="row-title">${esc(w.name)}</span>
              <span class="row-meta">${esc(workoutStats(w, exById).summary)}</span>
            </span>
          </label>
        </li>`).join('')}</ul>
      </section>` : ''}
    ${exercises.length ? `
      <section class="pick-section" aria-labelledby="eTitle">
        <h2 class="pick-section-title" id="eTitle">Exercises</h2>
        ${tags.length ? `<div class="chip-scroll" role="group" aria-label="Filter by tag">${filterChips(tags, filter)}</div>` : ''}
        <div class="filter-status" id="filterStatus" hidden>
          <span id="filterCount" role="status"></span>
          <button type="button" class="btn-text" id="pickShown"></button>
        </div>
        <ul class="list">${exercises.map((e) => `<li data-row="${e.id}">
          <label class="check-row">
            <input type="checkbox" class="visually-hidden" data-exercise="${e.id}">
            ${checkBox}
            ${thumb(e, 'sm')}
            <span class="ex-text">
              <span class="row-title">${esc(e.name)}</span>
              ${e.tags?.length ? `<span class="row-tags">${esc(e.tags.join(', '))}</span>` : ''}
              <span class="row-meta included-note">Included with a workout</span>
            </span>
          </label>
        </li>`).join('')}</ul>
        <p class="hint" id="noMatch" hidden>No exercise has all of these tags.</p>
      </section>` : ''}
    <div class="dock-spacer"></div>
    <div class="dock dock-tall">
      <div class="dock-inner">
        <p class="dock-note" id="selectionNote" role="status"></p>
        <button class="btn btn-primary btn-block btn-lg" id="shareSelection">${icon.share}Share selection</button>
      </div>
    </div>`;

  const shownExercises = () => exercises.filter((e) => hasAllTags(e, filter));

  function update() {
    const inc = included();
    const inFile = allExercisesInFile();

    view.querySelectorAll('[data-workout]').forEach((box) => {
      box.checked = pickedWorkouts.has(box.dataset.workout);
    });
    view.querySelectorAll('[data-exercise]').forEach((box) => {
      const id = box.dataset.exercise;
      const isIncluded = inc.has(id);
      box.checked = pickedExercises.has(id) || isIncluded;
      box.disabled = isIncluded;
      box.closest('.check-row').classList.toggle('is-included', isIncluded);
    });

    // tag filter
    if (tags.length) {
      const shown = shownExercises();
      const shownIds = new Set(shown.map((e) => e.id));
      view.querySelectorAll('[data-row]').forEach((li) => { li.hidden = !shownIds.has(li.dataset.row); });
      view.querySelector('#noMatch').hidden = shown.length > 0;
      view.querySelector('#filterStatus').hidden = !filter.size || !shown.length;
      view.querySelector('#filterCount').textContent = `${shown.length} of ${countLabel(exercises.length, 'exercise', 'exercises')}`;
      const allShownPicked = shown.every((e) => inFile.has(e.id));
      view.querySelector('#pickShown').textContent = allShownPicked ? 'Deselect these' : `Select these ${shown.length}`;
    }

    const parts = [];
    if (pickedWorkouts.size) parts.push(countLabel(pickedWorkouts.size, 'workout', 'workouts'));
    if (inFile.size) parts.push(countLabel(inFile.size, 'exercise', 'exercises'));
    view.querySelector('#selectionNote').textContent = parts.length ? `${parts.join(' and ')} selected` : 'Nothing selected yet';
    view.querySelector('#shareSelection').disabled = !parts.length;
    view.querySelector('#toggleAll').textContent = everythingPicked() ? 'Clear selection' : 'Select all';
  }

  view.querySelectorAll('[data-workout]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) pickedWorkouts.add(box.dataset.workout);
      else pickedWorkouts.delete(box.dataset.workout);
      update();
    })
  );
  view.querySelectorAll('[data-exercise]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) pickedExercises.add(box.dataset.exercise);
      else pickedExercises.delete(box.dataset.exercise);
      update();
    })
  );

  view.querySelector('#toggleAll').addEventListener('click', () => {
    const clear = everythingPicked();
    pickedWorkouts.clear();
    pickedExercises.clear();
    if (!clear) {
      workouts.forEach((w) => pickedWorkouts.add(w.id));
      exercises.forEach((e) => pickedExercises.add(e.id));
    }
    update();
  });

  if (tags.length) {
    wireChips(view, filter, update);
    view.querySelector('#pickShown').addEventListener('click', () => {
      const shown = shownExercises();
      const inFile = allExercisesInFile();
      if (shown.every((e) => inFile.has(e.id))) shown.forEach((e) => pickedExercises.delete(e.id));
      else shown.forEach((e) => pickedExercises.add(e.id));
      update();
    });
  }

  view.querySelector('#shareSelection').addEventListener('click', () => {
    const date = new Date().toISOString().slice(0, 10);
    // A single workout keeps its own name as the file name.
    const single = pickedWorkouts.size === 1 && [...pickedExercises].every((id) => included().has(id))
      ? workouts.find((w) => pickedWorkouts.has(w.id)).name
      : !pickedWorkouts.size && pickedExercises.size === 1
        ? exById.get([...pickedExercises][0]).name
        : null;
    if (everythingPicked()) {
      backupSheet();
      return;
    }
    shareItemSheet({
      name: single ?? `workouts-${date}`,
      title: single ? `Share ${single}` : 'Share selection',
      workoutIds: [...pickedWorkouts],
      exerciseIds: [...pickedExercises],
    });
  });

  update();
}
