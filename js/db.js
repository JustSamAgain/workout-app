// Storage layer.
// This is the ONLY file that knows how data is stored (IndexedDB on the device).
// To sync with a server later, replace the functions in `repo` with API calls.
// The rest of the app only talks to `repo` and never touches IndexedDB directly.

const DB_NAME = 'workout-app';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('exercises')) db.createObjectStore('exercises', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;
    const req = fn(tx.objectStore(storeName));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Globally unique IDs, so records can later be merged with server data without collisions.
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Ask the browser not to evict our data when the device runs low on space.
let persistRequested = false;
function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}

function stamp(record) {
  const now = new Date().toISOString();
  return { ...record, id: record.id || newId(), createdAt: record.createdAt || now, updatedAt: now };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const usesExercise = (steps, id) =>
  steps.some((s) => (s.type === 'repeat' ? usesExercise(s.steps, id) : s.exerciseId === id));

const withoutExercise = (steps, id) =>
  steps
    .filter((s) => s.exerciseId !== id)
    .map((s) => (s.type === 'repeat' ? { ...s, steps: withoutExercise(s.steps, id) } : s));

/*
  Data model

  Exercise: { id, name, description, tags: string[], oneSided: boolean, image: Blob | null, createdAt, updatedAt }
  Workout:  { id, name, steps: Step[], createdAt, updatedAt }
  Step:     { id, type: 'time', exerciseId, seconds, weight?, sides? }
          | { id, type: 'reps', exerciseId, reps, weight?, sides? }
            weight: kg in steps of 0.5; sides: true = each side (only if the exercise is oneSided)
          | { id, type: 'rest', seconds }
          | { id, type: 'repeat', rounds, steps: Step[] }   (one level only, no repeat inside repeat)
*/
export const repo = {
  async listExercises() {
    const all = await run('exercises', 'readonly', (s) => s.getAll());
    return all.sort(byName);
  },

  getExercise(id) {
    return run('exercises', 'readonly', (s) => s.get(id));
  },

  async saveExercise(exercise) {
    const record = stamp(exercise);
    await run('exercises', 'readwrite', (s) => s.put(record));
    requestPersistence();
    return record;
  },

  async countWorkoutsUsing(exerciseId) {
    const workouts = await run('workouts', 'readonly', (s) => s.getAll());
    return workouts.filter((w) => usesExercise(w.steps, exerciseId)).length;
  },

  // Deletes the exercise and removes its steps from every workout, in one transaction.
  async deleteExercise(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['exercises', 'workouts'], 'readwrite');
      tx.objectStore('exercises').delete(id);
      const workouts = tx.objectStore('workouts');
      const req = workouts.getAll();
      req.onsuccess = () => {
        for (const w of req.result) {
          if (usesExercise(w.steps, id)) {
            workouts.put({ ...w, steps: withoutExercise(w.steps, id), updatedAt: new Date().toISOString() });
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async listWorkouts() {
    const all = await run('workouts', 'readonly', (s) => s.getAll());
    return all.sort(byName);
  },

  getWorkout(id) {
    return run('workouts', 'readonly', (s) => s.get(id));
  },

  async saveWorkout(workout) {
    const record = stamp(workout);
    await run('workouts', 'readwrite', (s) => s.put(record));
    requestPersistence();
    return record;
  },

  deleteWorkout(id) {
    return run('workouts', 'readwrite', (s) => s.delete(id));
  },

  // Writes records exactly as given (keeping their ids and timestamps), in one transaction.
  // Used by import.
  async putRecords({ exercises = [], workouts = [] }) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['exercises', 'workouts'], 'readwrite');
      const exStore = tx.objectStore('exercises');
      const wStore = tx.objectStore('workouts');
      exercises.forEach((e) => exStore.put(e));
      workouts.forEach((w) => wStore.put(w));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    requestPersistence();
  },
};
