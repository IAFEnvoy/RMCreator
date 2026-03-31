export function createHistoryManager({
  maxEntries = 120,
  applySnapshot,
  persistSnapshot
}) {
  const state = {
    undoStack: [],
    redoStack: [],
    currentSnapshot: "",
    isApplying: false,
    lastCommitAt: 0,
    lastCoalesceKey: ""
  };

  function initBaseline(snapshot) {
    state.undoStack = [];
    state.redoStack = [];
    state.currentSnapshot = snapshot || "";
    state.lastCommitAt = Date.now();
    state.lastCoalesceKey = "";

    if (state.currentSnapshot) {
      persistSnapshot?.(state.currentSnapshot);
    }
  }

  function commit(snapshot, options = {}) {
    if (state.isApplying) {
      return;
    }

    if (!snapshot || snapshot === state.currentSnapshot) {
      return;
    }

    const coalesceKey = options.coalesceKey ? String(options.coalesceKey) : "";
    const coalesceWindowMs = Number(options.coalesceWindowMs) || 450;
    const now = Date.now();

    const canCoalesce = Boolean(
      coalesceKey &&
      state.undoStack.length > 0 &&
      state.lastCoalesceKey === coalesceKey &&
      now - state.lastCommitAt <= coalesceWindowMs
    );

    if (state.currentSnapshot && !canCoalesce) {
      state.undoStack.push(state.currentSnapshot);
      if (state.undoStack.length > maxEntries) {
        state.undoStack.shift();
      }
    }

    state.currentSnapshot = snapshot;
    state.redoStack = [];
    state.lastCommitAt = now;
    state.lastCoalesceKey = coalesceKey;
    persistSnapshot?.(snapshot);
  }

  function undo() {
    if (!state.undoStack.length) {
      return;
    }

    const target = state.undoStack.pop();
    if (state.currentSnapshot) {
      state.redoStack.push(state.currentSnapshot);
    }

    applyHistorySnapshot(target);
  }

  function redo() {
    if (!state.redoStack.length) {
      return;
    }

    const target = state.redoStack.pop();
    if (state.currentSnapshot) {
      state.undoStack.push(state.currentSnapshot);
    }

    applyHistorySnapshot(target);
  }

  function applyHistorySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    state.isApplying = true;
    try {
      applySnapshot?.(snapshot);
      state.currentSnapshot = snapshot;
      state.lastCommitAt = Date.now();
      state.lastCoalesceKey = "";
      persistSnapshot?.(snapshot);
    } finally {
      state.isApplying = false;
    }
  }

  return {
    initBaseline,
    commit,
    undo,
    redo,
    isApplying: () => state.isApplying,
    canUndo: () => state.undoStack.length > 0,
    canRedo: () => state.redoStack.length > 0
  };
}
