/** Tiny observable store for UI state shared by the 2D plan, 3D view, panels and agents. */
export function createStore(initial) {
  let state = Object.freeze({ ...initial });
  const listeners = new Set();

  return {
    getState: () => state,
    setState(patch) {
      const next = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      const changed = Object.keys(next).filter((k) => next[k] !== state[k]);
      if (!changed.length) return;
      const prev = state;
      state = Object.freeze(next);
      for (const fn of listeners) fn(state, prev, new Set(changed));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const ACTIVITY_LIMIT = 200;

/** Append-only activity log entry (newest first), capped to ACTIVITY_LIMIT. */
export const appendActivity = (log, entry) => [entry, ...log].slice(0, ACTIVITY_LIMIT);
