// Export and import of exercises and workouts as one JSON file.
//
// File format (version 2):
// {
//   "format": "workout-timer",
//   "version": 2,
//   "exportedAt": "2026-10-21T18:00:00.000Z",
//   "exercises": [{ id, name, description, tags: [], image: "data:image/jpeg;base64,..." | null, createdAt, updatedAt }],
//   "workouts":  [{ id, name, steps: [...], createdAt, updatedAt }]
// }
// Version 2 added exercise tags and repeat blocks ({ type: 'repeat', rounds, steps }).
// Version 1 files can still be imported.
//
// Import merges: nothing is deleted. Records with an id that already exists are only
// replaced when the file has a newer version (updatedAt).

import { repo, newId } from './db.js';
import { resizeImage, slug } from './utils.js';
import { normalizeTags, availableTags } from './tags.js';

export const FORMAT = 'workout-timer';
export const FORMAT_VERSION = 2;

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_REPS = 9999;
const MAX_ROUNDS = 99;
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

function collectExerciseIds(steps, into) {
  for (const s of steps) {
    if (s.type === 'repeat') collectExerciseIds(s.steps, into);
    else if (s.exerciseId) into.add(s.exerciseId);
  }
}

// Without a selection: everything. With { exerciseIds, workoutIds, name }: only those,
// plus every exercise the selected workouts use.
export async function buildExport(selection = null) {
  let [exercises, workouts] = await Promise.all([repo.listExercises(), repo.listWorkouts()]);
  const date = new Date().toISOString().slice(0, 10);
  let fileName = `workouts-${date}.json`;

  if (selection) {
    const wanted = new Set(selection.workoutIds ?? []);
    workouts = workouts.filter((w) => wanted.has(w.id));
    const needed = new Set(selection.exerciseIds ?? []);
    workouts.forEach((w) => collectExerciseIds(w.steps, needed));
    exercises = exercises.filter((e) => needed.has(e.id));
    fileName = `${slug(selection.name ?? 'export')}.json`;
  }

  const data = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exercises: await Promise.all(
      exercises.map(async (e) => ({
        id: e.id,
        name: e.name,
        description: e.description ?? '',
        tags: e.tags ?? [],
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
  const file = new File([JSON.stringify(data)], fileName, { type: 'application/json' });
  return {
    file,
    exerciseCount: exercises.length,
    workoutCount: workouts.length,
    photoCount: exercises.filter((e) => e.image).length,
  };
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
  const knownTags = availableTags(localExercises);

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
      tags: normalizeTags(raw.tags, knownTags),
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

  // Checks steps; repeat blocks are only allowed at the top level.
  function parseSteps(rawSteps, allowRepeat) {
    const steps = [];
    for (const s of Array.isArray(rawSteps) ? rawSteps : []) {
      if (!s || typeof s !== 'object') continue;
      const id = isValidId(s.id) ? s.id : newId();
      if (s.type === 'rest') {
        const seconds = whole(s.seconds, 1, MAX_SECONDS);
        if (seconds) steps.push({ id, type: 'rest', seconds });
      } else if (s.type === 'time' || s.type === 'reps') {
        const exerciseId = resolveExercise(s.exerciseId);
        if (!exerciseId) continue;
        if (s.type === 'time') {
          const seconds = whole(s.seconds, 1, MAX_SECONDS);
          if (seconds) steps.push({ id, type: 'time', exerciseId, seconds });
        } else {
          const reps = whole(s.reps, 1, MAX_REPS);
          if (reps) steps.push({ id, type: 'reps', exerciseId, reps });
        }
      } else if (s.type === 'repeat' && allowRepeat) {
        const rounds = whole(s.rounds, 1, MAX_ROUNDS);
        if (rounds) steps.push({ id, type: 'repeat', rounds, steps: parseSteps(s.steps, false) });
      }
    }
    return steps;
  }

  const workouts = new Map();
  for (const raw of data.workouts) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) continue;
    const id = isValidId(raw.id) ? raw.id : newId();
    workouts.set(id, {
      id,
      name: text(raw.name, 60) || 'Untitled workout',
      steps: parseSteps(raw.steps, true),
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
