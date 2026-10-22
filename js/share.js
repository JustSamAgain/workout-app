import { esc, countLabel, formatSize } from './utils.js';
import { openSheet, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { buildExport, readImport } from './transfer.js';

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
async function shareFile(file, title) {
  try {
    await navigator.share({ files: [file], title });
  } catch (err) {
    if (err.name !== 'AbortError') saveFile(file);
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

// Sheet for sharing one exercise or one workout (with the exercises it uses).
// The file is built when the sheet opens, so the Share button can open the share menu right on the tap.
export function shareItemSheet({ name, exerciseIds = [], workoutIds = [] }) {
  return openSheet(
    `<div class="sheet-body">
      <h2 class="sheet-title">Share ${esc(name)}</h2>
      <p class="sheet-text" data-info>Preparing file…</p>
      <p class="sheet-text">Send the file to a friend. They open the Share tab in their app and choose Import.</p>
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
        const result = await buildExport({ name, exerciseIds, workoutIds });
        info.textContent = `${contentsLabel(result)}, ${formatSize(result.file.size)}`;
        shareBtn.hidden = !canShareFile(result.file);
        saveBtn.disabled = false;
        shareBtn.addEventListener('click', () => shareFile(result.file, name));
        saveBtn.addEventListener('click', () => saveFile(result.file));
      } catch (err) {
        info.textContent = `The file could not be created: ${err.message}`;
      }
    }
  );
}

export function shareButton(label) {
  return `<button type="button" class="btn-text head-action" data-share-item>${icon.share}<span>${esc(label)}</span></button>`;
}

// ---------- Share tab: export everything & import ----------

export async function viewShare(view, match, ctx) {
  view.innerHTML = `
    <header class="page-head"><h1>Share</h1></header>

    <section class="section" aria-labelledby="exportTitle">
      <h2 class="section-title" id="exportTitle">Export</h2>
      <p class="section-text">Put all your exercises and workouts, photos included, into one file. Send it to a friend or keep it as a backup. To share a single exercise or workout, open it and tap Share.</p>
      <p class="row-meta" id="exportInfo">Preparing file…</p>
      <div class="btn-row" id="exportButtons" hidden>
        <button class="btn btn-primary" id="shareFile" hidden>${icon.share}Share file</button>
        <button class="btn btn-secondary" id="saveFile">${icon.download}Save file</button>
      </div>
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

  const info = view.querySelector('#exportInfo');
  const buttons = view.querySelector('#exportButtons');
  const shareBtn = view.querySelector('#shareFile');
  const notice = view.querySelector('#importNotice');
  const importLabel = view.querySelector('#importLabel');
  const importLabelText = view.querySelector('#importLabelText');
  let exportFile = null;

  // The file is built up front so "Share" can open the share menu right on the tap.
  async function prepareExport() {
    info.textContent = 'Preparing file…';
    buttons.hidden = true;
    const result = await buildExport();
    if (ctx.stale()) return;
    if (!result.exerciseCount && !result.workoutCount) {
      exportFile = null;
      info.textContent = 'Nothing to export yet. Add some exercises first.';
      return;
    }
    exportFile = result.file;
    info.textContent = `${countLabel(result.exerciseCount, 'exercise', 'exercises')} and ${countLabel(result.workoutCount, 'workout', 'workouts')}, ${formatSize(exportFile.size)}`;
    shareBtn.hidden = !canShareFile(exportFile);
    buttons.hidden = false;
  }

  shareBtn.addEventListener('click', () => exportFile && shareFile(exportFile, 'Workouts'));
  view.querySelector('#saveFile').addEventListener('click', () => exportFile && saveFile(exportFile));

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
      await prepareExport();
    } catch (err) {
      showNotice(`Import failed: ${err.message}`, true);
    } finally {
      importLabel.classList.remove('is-disabled');
      importLabelText.textContent = 'Choose file';
    }
  });

  await prepareExport();
}
