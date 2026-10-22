// Small bits of navigation state shared between views.
export const nav = {
  // Where to go after saving a new exercise (set when it was started from a workout).
  returnTo: null,
  // Tags selected in the exercise list filter (kept while moving around the app).
  listFilter: new Set(),
  // Search text in the exercise list (kept the same way).
  listQuery: '',
};
