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

export function stepTarget(step) {
  return step.type === 'reps' ? `${step.reps} reps` : formatDuration(step.seconds);
}

export function workoutStats(workout, exerciseIds) {
  let tasks = 0;
  let seconds = 0;
  let repTasks = 0;
  for (const s of workout.steps) {
    if (s.type === 'rest') {
      seconds += s.seconds;
      continue;
    }
    if (!exerciseIds.has(s.exerciseId)) continue;
    tasks++;
    if (s.type === 'time') seconds += s.seconds;
    else repTasks++;
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
