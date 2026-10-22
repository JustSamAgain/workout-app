import { repo } from './db.js';
import { esc, exerciseImageUrl, thumb, resizeImage, countLabel, matchesSearch } from './utils.js';
import { confirmDialog, promptDialog, searchField, wireSearch } from './ui.js';
import { icon } from './icons.js';
import { nav } from './state.js';
import { usedTags, availableTags, normalizeTags, hasAllTags, filterChips, wireChips, MAX_TAG_LENGTH } from './tags.js';
import { shareItemSheet, shareButton } from './share.js';

function notFound(message, href, label) {
  return `<div class="empty"><p class="empty-title">Not found</p><p>${esc(message)}</p><a class="btn btn-primary" href="${href}">${esc(label)}</a></div>`;
}

export function showError(form, message) {
  const el = form.querySelector('.form-error');
  el.textContent = message;
  el.hidden = false;
}

const tagLine = (e) => (e.tags?.length ? `<span class="row-tags">${esc(e.tags.join(', '))}</span>` : '');

// ---------- Exercise list ----------

export async function viewExercises(view, match, ctx) {
  const exercises = await repo.listExercises();
  if (ctx.stale()) return;

  if (!exercises.length) {
    view.innerHTML = `
      <header class="page-head"><h1>Exercises</h1></header>
      <div class="empty">
        <p class="empty-title">No exercises yet</p>
        <p>Add each exercise once with a photo and a short description. You can then use it in as many workouts as you like.</p>
        <a class="btn btn-primary" href="#/exercises/new">${icon.plus}Add exercise</a>
      </div>`;
    return;
  }

  const tags = usedTags(exercises);
  const selected = nav.listFilter;
  for (const t of [...selected]) if (!tags.includes(t)) selected.delete(t);

  view.innerHTML = `
    <header class="page-head">
      <h1>Exercises</h1>
      <a class="btn btn-primary btn-sm" href="#/exercises/new">${icon.plus}New</a>
    </header>
    ${searchField(nav.listQuery)}
    ${tags.length ? `<div class="chip-scroll" role="group" aria-label="Filter by tag">${filterChips(tags, selected)}</div>` : ''}
    <div class="filter-status" id="filterStatus" hidden>
      <span id="filterCount" role="status"></span>
      <button type="button" class="btn-text" id="clearFilter">Clear filter</button>
    </div>
    <ul class="list" id="exerciseList"></ul>
    <div class="empty" id="noMatch" hidden>
      <p id="noMatchText"></p>
    </div>`;

  const list = view.querySelector('#exerciseList');

  function drawList() {
    const shown = exercises.filter((e) => hasAllTags(e, selected) && matchesSearch(e.name, nav.listQuery));
    list.innerHTML = shown
      .map((e) => `<li>
        <a class="ex-row" href="#/exercises/${e.id}">
          ${thumb(e)}
          <span class="ex-text">
            <span class="row-title">${esc(e.name)}</span>
            ${tagLine(e)}
            ${e.description ? `<span class="row-meta clamp">${esc(e.description)}</span>` : ''}
          </span>
        </a>
      </li>`)
      .join('');
    const filtering = selected.size > 0 || nav.listQuery.trim() !== '';
    view.querySelector('#filterStatus').hidden = !filtering;
    view.querySelector('#filterCount').textContent = `${shown.length} of ${countLabel(exercises.length, 'exercise', 'exercises')}`;
    view.querySelector('#noMatch').hidden = shown.length > 0;
    view.querySelector('#noMatchText').textContent = noMatchText(nav.listQuery, selected.size);
  }

  const search = wireSearch(view, (value) => {
    nav.listQuery = value;
    drawList();
  });
  wireChips(view, selected, drawList);
  view.querySelector('#clearFilter').addEventListener('click', () => {
    selected.clear();
    nav.listQuery = '';
    search.reset();
    view.querySelectorAll('[data-tag]').forEach((c) => {
      c.classList.remove('is-on');
      c.setAttribute('aria-pressed', 'false');
    });
    drawList();
  });
  drawList();
}

export function noMatchText(query, tagCount) {
  const q = query.trim();
  if (q && tagCount) return `No exercise with these tags matches \u201c${q}\u201d.`;
  if (q) return `No exercise matches \u201c${q}\u201d.`;
  return 'No exercise has all of these tags.';
}

// ---------- Exercise form ----------

export async function viewExerciseForm(view, match, ctx) {
  const id = match[1] ?? null;
  const [existing, all] = await Promise.all([id ? repo.getExercise(id) : null, repo.listExercises()]);
  if (ctx.stale()) return;
  if (id && !existing) {
    view.innerHTML = notFound('This exercise no longer exists.', '#/exercises', 'Back to exercises');
    return;
  }

  const back = nav.returnTo || '#/exercises';
  let image = existing?.image ?? null;
  let ownUrl = null; // object URL created here for a newly picked photo
  const chosen = new Set(existing?.tags ?? []);
  const offered = availableTags(all);
  for (const t of chosen) if (!offered.includes(t)) offered.push(t);

  view.innerHTML = `
    <header class="page-head page-head--sub">
      <a class="back" href="${back}">${icon.back}<span>${nav.returnTo ? 'Back to workout' : 'Exercises'}</span></a>
      ${existing ? shareButton('Share') : ''}
    </header>
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
      <div class="field">
        <span class="field-label" id="tagsLabel">Tags</span>
        <div class="chip-wrap" role="group" aria-labelledby="tagsLabel" id="tagPicker"></div>
      </div>
      <label class="switch-row">
        <span class="switch-text">
          <span class="switch-title">One side at a time</span>
          <span class="row-meta">For exercises like lunges or side planks. Workouts can then run it for the left and the right side.</span>
        </span>
        <input type="checkbox" class="switch" name="oneSided" ${existing?.oneSided ? 'checked' : ''}>
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
  const tagPicker = view.querySelector('#tagPicker');

  function drawTags() {
    tagPicker.innerHTML = `${filterChips(offered, chosen)}<button type="button" class="chip chip-add" id="addTag">${icon.plus}Own tag</button>`;
    wireChips(tagPicker, chosen, () => {});
    tagPicker.querySelector('#addTag').addEventListener('click', async () => {
      const value = await promptDialog({
        title: 'New tag',
        label: 'Name',
        placeholder: 'e.g. Lower back',
        confirm: 'Add tag',
        maxLength: MAX_TAG_LENGTH,
      });
      const [tag] = normalizeTags([value ?? ''], offered);
      if (!tag) return;
      if (!offered.includes(tag)) offered.push(tag);
      chosen.add(tag);
      drawTags();
    });
  }
  drawTags();

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
      tags: offered.filter((t) => chosen.has(t)),
      oneSided: form.elements.oneSided.checked,
      image,
    });
    const target = nav.returnTo || '#/exercises';
    nav.returnTo = null;
    location.hash = target;
  });

  view.querySelector('[data-share-item]')?.addEventListener('click', () =>
    shareItemSheet({ name: existing.name, exerciseIds: [existing.id] })
  );

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
