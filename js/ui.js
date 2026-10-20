import { esc } from './utils.js';

// Opens a bottom sheet. `onMount(dialog, done)` wires it up; calling done(value) closes it
// and resolves the returned promise with that value (null when dismissed).
export function openSheet(html, onMount) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = html;
    document.body.append(dlg);
    let result = null;
    const done = (value) => {
      result = value;
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    // Tap on the dimmed backdrop closes the sheet.
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    onMount?.(dlg, done);
    dlg.showModal();
  });
}

export async function confirmDialog({ title, message = '', confirm = 'OK', cancel = 'Cancel', danger = false }) {
  const result = await openSheet(
    `<form class="sheet-body">
      <h2 class="sheet-title">${esc(title)}</h2>
      ${message ? `<p class="sheet-text">${esc(message)}</p>` : ''}
      <div class="sheet-actions">
        <span class="spacer"></span>
        ${cancel ? `<button type="button" class="btn btn-secondary" data-cancel>${esc(cancel)}</button>` : ''}
        <button type="submit" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}">${esc(confirm)}</button>
      </div>
    </form>`,
    (dlg, done) => {
      dlg.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        done(true);
      });
      dlg.querySelector('[data-cancel]')?.addEventListener('click', () => done(false));
    }
  );
  return result === true;
}

export function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save' }) {
  return openSheet(
    `<form class="sheet-body">
      <h2 class="sheet-title">${esc(title)}</h2>
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <input name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60" autocomplete="off" enterkeyhint="done" autofocus>
      </label>
      <div class="sheet-actions">
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(confirm)}</button>
      </div>
    </form>`,
    (dlg, done) => {
      const form = dlg.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        done(form.elements.value.value);
      });
      dlg.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    }
  );
}
