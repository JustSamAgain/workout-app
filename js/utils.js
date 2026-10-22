export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "45 s", "1 min 30 s", "2 min"
export function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m && s) return `${m} min ${s} s`;
  if (m) return `${m} min`;
  return `${s} s`;
}

// Big timer display: "45" below one minute, "1:30" above.
export function formatClock(totalSeconds) {
  const total = Math.max(0, Math.ceil(totalSeconds));
  if (total < 60) return String(total);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export const SWITCH_SECONDS = 5;
export const MAX_WEIGHT = 500;

// "Each side" only applies when the exercise itself is marked as one side at a time.
export const isEachSide = (step, exercise) => !!(step.sides && exercise?.oneSided);

export const formatWeight = (kg) => `${kg} kg`;

// "12 reps" or "45 s", without extras.
export function baseTarget(step) {
  return step.type === 'reps' ? `${step.reps} reps` : formatDuration(step.seconds);
}

// Extras shown next to the target: ["each side", "20 kg"].
export function stepExtras(step, exercise, { sides = true } = {}) {
  const out = [];
  if (sides && isEachSide(step, exercise)) out.push('each side');
  if (step.weight) out.push(formatWeight(step.weight));
  return out;
}

export function stepTarget(step, exercise) {
  return [baseTarget(step), ...stepExtras(step, exercise)].join(', ');
}

// Reads a weight typed by the user ("12,5" or "12.5"). Empty means no weight.
export function parseWeight(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return { value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_WEIGHT) {
    return { error: `Enter a weight between 0.5 and ${MAX_WEIGHT} kg, or leave it empty.` };
  }
  if (!Number.isInteger(n * 2)) return { error: 'Use steps of 0.5 kg, for example 12.5.' };
  return { value: n };
}

// All exercise and rest steps of a workout, including those inside repeat blocks (not unrolled).
export function allSteps(steps) {
  return steps.flatMap((s) => (s.type === 'repeat' ? s.steps : [s]));
}

// The exact sequence the player runs, as { step, round, side }.
// - Repeat blocks are unrolled; in the last round, rests at the end of the block are skipped.
// - "Each side" steps become left, a short switch (time steps only), then right.
// - Steps whose exercise was deleted are left out.
// `exById` is a Map of exercise id -> exercise.
export function expandSteps(steps, exById) {
  const usable = (s) => s.type === 'rest' || exById.has(s.exerciseId);
  const out = [];
  const emit = (s, round) => {
    if (s.type === 'rest' || !isEachSide(s, exById.get(s.exerciseId))) {
      out.push({ step: s, round, side: null });
      return;
    }
    out.push({ step: s, round, side: 'left' });
    if (s.type === 'time') {
      out.push({ step: { type: 'switch', seconds: SWITCH_SECONDS, exerciseId: s.exerciseId }, round, side: null });
    }
    out.push({ step: s, round, side: 'right' });
  };
  for (const s of steps) {
    if (s.type !== 'repeat') {
      if (usable(s)) emit(s, null);
      continue;
    }
    const kids = s.steps.filter(usable);
    let lastTask = -1;
    kids.forEach((k, i) => {
      if (k.type !== 'rest') lastTask = i;
    });
    if (lastTask < 0) continue; // a block without exercises does nothing
    for (let n = 1; n <= s.rounds; n++) {
      const list = n === s.rounds ? kids.slice(0, lastTask + 1) : kids;
      for (const k of list) emit(k, { n, of: s.rounds });
    }
  }
  return out;
}

// An exercise done on both sides counts once.
export const isTaskPlay = (p) => p.step.type !== 'rest' && p.step.type !== 'switch' && p.side !== 'right';

export function workoutStats(workout, exById) {
  let tasks = 0;
  let seconds = 0;
  let repTasks = 0;
  for (const p of expandSteps(workout.steps, exById)) {
    const s = p.step;
    if (s.type === 'time' || s.type === 'rest' || s.type === 'switch') seconds += s.seconds;
    if (!isTaskPlay(p)) continue;
    tasks++;
    if (s.type === 'reps') repTasks++;
  }
  let summary;
  if (!tasks) summary = 'No exercises yet';
  else {
    summary = tasks === 1 ? '1 exercise' : `${tasks} exercises`;
    if (seconds) summary += `, ${formatDuration(seconds)}`;
    if (repTasks) summary += seconds ? ' plus reps' : ', reps only';
  }
  return { tasks, seconds, repTasks, summary };
}

// Lowercase without accents, so "uebung", "Übung" and "ubung" behave sensibly.
const searchKey = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// True when every word of the query appears somewhere in the name ("push up" finds "Push-ups").
export function matchesSearch(name, query) {
  const words = searchKey(query).split(/[\s-]+/).filter(Boolean);
  if (!words.length) return true;
  const target = searchKey(name);
  return words.every((w) => target.includes(w));
}

export function countLabel(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "Leg day (Ü)" -> "leg-day-u"
export function slug(name) {
  const s = String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'export';
}

// Object URLs for exercise images, cached per exercise version.
const urlCache = new Map();
export function exerciseImageUrl(exercise) {
  if (!exercise?.image) return null;
  const hit = urlCache.get(exercise.id);
  if (hit && hit.stamp === exercise.updatedAt) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(exercise.image);
  urlCache.set(exercise.id, { stamp: exercise.updatedAt, url });
  return url;
}

export function thumb(exercise, size = '') {
  const cls = `thumb${size ? ` thumb-${size}` : ''}`;
  const url = exerciseImageUrl(exercise);
  if (url) return `<img class="${cls}" src="${url}" alt="">`;
  const letter = (exercise?.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="${cls} thumb-empty" aria-hidden="true">${esc(letter)}</span>`;
}

// Shrinks photos from the phone camera (often 4000px+) so storage stays small.
export async function resizeImage(file, maxSize = 1200, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file could not be opened as an image. Try a JPEG or PNG photo.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be processed.'))), 'image/jpeg', quality)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
