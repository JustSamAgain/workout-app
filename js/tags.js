import { esc } from './utils.js';

export const BUILT_IN_TAGS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core',
  'Glutes', 'Quads', 'Hamstrings', 'Calves', 'Full body', 'Cardio',
];

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 20;

const key = (t) => t.toLocaleLowerCase();

// Trims, drops empties and duplicates (ignoring case), and uses the spelling of a
// known tag when one matches, so "chest" becomes "Chest".
export function normalizeTags(list, known = BUILT_IN_TAGS) {
  const canonical = new Map(known.map((t) => [key(t), t]));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(canonical.get(key(t)) ?? t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const tagOrder = (a, b) => {
  const ia = BUILT_IN_TAGS.indexOf(a);
  const ib = BUILT_IN_TAGS.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
};

// Tags that at least one exercise has. These are the ones worth filtering by.
export function usedTags(exercises) {
  const set = new Map();
  for (const e of exercises) for (const t of e.tags ?? []) set.set(key(t), t);
  return [...set.values()].sort(tagOrder);
}

// Built-in tags plus every own tag in use. These are offered when editing an exercise.
export function availableTags(exercises) {
  const set = new Map(BUILT_IN_TAGS.map((t) => [key(t), t]));
  for (const t of usedTags(exercises)) if (!set.has(key(t))) set.set(key(t), t);
  return [...set.values()].sort(tagOrder);
}

// Filter: an exercise matches when it has ALL selected tags.
export function hasAllTags(exercise, selected) {
  if (!selected.size) return true;
  const own = new Set((exercise.tags ?? []).map(key));
  for (const t of selected) if (!own.has(key(t))) return false;
  return true;
}

export function filterChips(tags, selected) {
  return tags
    .map((t) => `<button type="button" class="chip tag-chip${selected.has(t) ? ' is-on' : ''}" data-tag="${esc(t)}" aria-pressed="${selected.has(t)}">${esc(t)}</button>`)
    .join('');
}

// Wires a row of [data-tag] chips that toggle membership in `selected`.
export function wireChips(root, selected, onChange) {
  root.querySelectorAll('[data-tag]').forEach((chip) =>
    chip.addEventListener('click', () => {
      const t = chip.dataset.tag;
      if (selected.has(t)) selected.delete(t);
      else selected.add(t);
      chip.classList.toggle('is-on', selected.has(t));
      chip.setAttribute('aria-pressed', String(selected.has(t)));
      onChange();
    })
  );
}
