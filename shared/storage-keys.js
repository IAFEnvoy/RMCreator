// Preserve existing keys so moving pages on the same origin keeps saved work.
export const ROUTE_STORAGE_KEYS = Object.freeze({
  lines: 'rmcreator.customLineTypes.v1',
  shapes: 'rmcreator.shapeLibrary.v1',
  stations: 'rmcreator.stationLibrary.v1',
  legacyDrawing: 'rmcreator.drawing.v1',
  drawings: 'rmcreator.drawings.v1',
  activeDrawing: 'rmcreator.activeDrawingId.v1',
  settings: 'rmcreator.appSettings.v1',
  colorHistory: 'rmcreator.colorHistory.v1',
});

export const STATION_STORAGE_KEYS = Object.freeze({
  workspace: 'station-studio-workspace',
  legacyProject: 'station-studio-project',
  recovery: 'station-studio-workspace-recovery',
});

export const LAYOUT_STORAGE_KEYS = Object.freeze({
  workspace: 'rmcreator.trackLayout.workspace.v1',
  recovery: 'rmcreator.trackLayout.recovery.v1',
});
