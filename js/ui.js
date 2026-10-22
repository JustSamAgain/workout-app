import { esc } from './utils.js';
import { icon } from './icons.js';

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

export function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', maxLength = 60 }) {
  return openSheet(
    `<form class="sheet-body">
      <h2 class="sheet-title">${esc(title)}</h2>
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <input name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxLength}"autocomplete="off" enterkeyhint="done" autofocus>
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

// Wires a −/+ number stepper: buttons with data-step="-1|1" next to an input named `name`.
export function wireStepper(root, name, min, max) {
  const input = root.querySelector(`input[name="${name}"]`);
  root.querySelectorAll(`[data-step-for="${name}"]`).forEach((b) =>
    b.addEventListener('click', () => {
      const next = (Math.round(Number(input.value)) || 0) + Number(b.dataset.step);
      input.value = Math.min(max, Math.max(min, next));
    })
  );
  return () => Math.round(Number(input.value));
}

export function stepper(name, value, min, max, label) {
  return `<div class="stepper">
    <button type="button" data-step-for="${name}" data-step="-1" aria-label="Fewer ${esc(label)}">−</button>
    <input type="number" inputmode="numeric" name="${name}" min="${min}" max="${max}" value="${value}" aria-label="${esc(label)}">
    <button type="button" data-step-for="${name}" data-step="1" aria-label="More ${esc(label)}">+</button>
  </div>`;
}

// Search box. `onChange(value)` runs on every keystroke and when cleared.
export function searchField(value = '', label = 'Search exercises') {
  return `<label class="search">
    <span class="visually-hidden">${esc(label)}</span>
    ${icon.search}
    <input type="search" name="q" value="${esc(value)}" placeholder="Search by name" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
    <button type="button" class="search-clear" aria-label="Clear search" ${value ? '' : 'hidden'}>${icon.close}</button>
  </label>`;
}

export function wireSearch(root, onChange) {
  const input = root.querySelector('.search input');
  const clear = root.querySelector('.search-clear');
  const changed = () => {
    clear.hidden = !input.value;
    onChange(input.value);
  };
  input.addEventListener('input', changed);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // inside a form this would submit it
      input.blur(); // closes the phone keyboard
    }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    changed();
    input.focus();
  });
  return {
    reset() {
      input.value = '';
      clear.hidden = true;
    },
  };
}
