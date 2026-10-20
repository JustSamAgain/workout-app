// Export and import of all exercises and workouts as one JSON file.
//
// File format (version 1):
// {
//   "format": "workout-timer",
//   "version": 1,
//   "exportedAt": "2026-10-20T18:00:00.000Z",
//   "exercises": [{ id, name, description, image: "data:image/jpeg;base64,..." | null, createdAt, updatedAt }],
//   "workouts":  [{ id, name, steps: [...], createdAt, updatedAt }]
// }
//
// Import merges: nothing is deleted. Records with an id that already exists are only
// replaced when the file has a newer version (updatedAt).

import { repo, newId } from './db.js';
import { resizeImage } from './utils.js';

export const FORMAT = 'workout-timer';
export const FORMAT_VERSION = 1;

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_REPS = 9999;
const EPOCH = new Date(0).toISOString();

// ---------- Export ----------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function buildExport() {
  const [exercises, workouts] = await Promise.all([repo.listExercises(), repo.listWorkouts()]);
  const data = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exercises: await Promise.all(
      exercises.map(async (e) => ({
        id: e.id,
        name: e.name,
        description: e.description ?? '',
        image: e.image ? await blobToDataUrl(e.image) : null,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }))
    ),
    workouts: workouts.map((w) => ({
      id: w.id,
      name: w.name,
      steps: w.steps,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })),
  };
  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(data)], `workouts-${date}.json`, { type: 'application/json' });
  return { file, exerciseCount: exercises.length, workoutCount: workouts.length };
}

// ---------- Import ----------

const isValidId = (id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const timestamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : EPOCH);
const whole = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function dataUrlToBlob(url) {
  const m = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function classify(record, local) {
  if (!local) return 'new';
  return record.updatedAt > local.updatedAt ? 'update' : 'same';
}

// Reads and checks a file. Returns a summary and an apply() function; nothing is saved until apply().
export async function readImport(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is too large to import.');

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This file can’t be read. Choose a file that was exported from Workout Timer.');
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.exercises) || !Array.isArray(data.workouts)) {
    throw new Error('This file wasn’t exported from Workout Timer. Choose a different file.');
  }
  if (Number(data.version) > FORMAT_VERSION) {
    throw new Error('This file comes from a newer version of the app. Update the app, then import again.');
  }

  const [localExercises, localWorkouts] = await Promise.all([repo.listExercises(), repo.listWorkouts()]);
  const localEx = new Map(localExercises.map((e) => [e.id, e]));
  const localW = new Map(localWorkouts.map((w) => [w.id, w]));

  // Ids from the file -> ids used here (invalid ids get a fresh one).
  const idMap = new Map();
  const exercises = new Map();
  for (const raw of data.exercises) {
    if (!raw || typeof raw !== 'object') continue;
    const name = text(raw.name, 80);
    if (!name) continue;
    const id = isValidId(raw.id) ? raw.id : newId();
    if (raw.id != null) idMap.set(String(raw.id), id);
    exercises.set(id, {
      id,
      name,
      description: text(raw.description, 5000),
      imageData: typeof raw.image === 'string' ? raw.image : null,
      createdAt: timestamp(raw.createdAt),
      updatedAt: timestamp(raw.updatedAt),
    });
  }

  const resolveExercise = (ref) => {
    const mapped = idMap.get(String(ref));
    if (mapped) return mapped;
    return localEx.has(ref) ? ref : null;
  };

  const workouts = new Map();
  for (const raw of data.workouts) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) continue;
    const steps = [];
    for (const s of raw.steps) {
      if (!s || typeof s !== 'object') continue;
      const stepId = isValidId(s.id) ? s.id : newId();
      if (s.type === 'rest') {
        const seconds = whole(s.seconds, 1, MAX_SECONDS);
        if (seconds) steps.push({ id: stepId, type: 'rest', seconds });
      } else if (s.type === 'time' || s.type === 'reps') {
        const exerciseId = resolveExercise(s.exerciseId);
        if (!exerciseId) continue;
        if (s.type === 'time') {
          const seconds = whole(s.seconds, 1, MAX_SECONDS);
          if (seconds) steps.push({ id: stepId, type: 'time', exerciseId, seconds });
        } else {
          const reps = whole(s.reps, 1, MAX_REPS);
          if (reps) steps.push({ id: stepId, type: 'reps', exerciseId, reps });
        }
      }
    }
    const id = isValidId(raw.id) ? raw.id : newId();
    workouts.set(id, {
      id,
      name: text(raw.name, 60) || 'Untitled workout',
      steps,
      createdAt: timestamp(raw.createdAt),
      updatedAt: timestamp(raw.updatedAt),
    });
  }

  const counts = { exercises: exercises.size, workouts: workouts.size, new: 0, update: 0, same: 0 };
  const exToWrite = [];
  const wToWrite = [];
  for (const e of exercises.values()) {
    const kind = classify(e, localEx.get(e.id));
    counts[kind]++;
    if (kind !== 'same') exToWrite.push(e);
  }
  for (const w of workouts.values()) {
    const kind = classify(w, localW.get(w.id));
    counts[kind]++;
    if (kind !== 'same') wToWrite.push(w);
  }

  async function apply(onProgress) {
    const records = [];
    let done = 0;
    for (const e of exToWrite) {
      let image = null;
      if (e.imageData) {
        try {
          const blob = dataUrlToBlob(e.imageData);
          // Re-encoding makes sure it is a real image and keeps the size in check.
          if (blob) image = await resizeImage(blob);
        } catch {
          image = null;
        }
      }
      const { imageData, ...rest } = e;
      records.push({ ...rest, image });
      onProgress?.(++done, exToWrite.length);
    }
    await repo.putRecords({ exercises: records, workouts: wToWrite });
  }

  return { counts, hasChanges: exToWrite.length + wToWrite.length > 0, apply };
}
