import { ROUTE_STORAGE_KEYS } from '../../shared/storage-keys.js';
export const lineStorageKey = ROUTE_STORAGE_KEYS.lines;
export const shapeStorageKey = ROUTE_STORAGE_KEYS.shapes;
export const stationStorageKey = ROUTE_STORAGE_KEYS.stations;
export const drawingStorageKey = ROUTE_STORAGE_KEYS.legacyDrawing;
export const drawingsListStorageKey = ROUTE_STORAGE_KEYS.drawings;
export const activeDrawingIdStorageKey = ROUTE_STORAGE_KEYS.activeDrawing;
export const appSettingsStorageKey = ROUTE_STORAGE_KEYS.settings;

export const lineStyleMap = {
  solid: "",
  dashed: "10 6"
};

export const geometryLabelMap = {
  straight: "直接连接",
  bend135: "135度弯",
  bend90: "90度弯",
  bend90rot45: "45度旋转90度弯"
};
