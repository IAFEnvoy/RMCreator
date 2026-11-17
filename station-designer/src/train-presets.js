// Reference dimensions in metres. Length includes the connection allowance;
// see docs/train-presets.md for source conventions and schematic assumptions.
export const DEFAULT_TRAIN_CARS = 6;
export const MAX_TRAIN_CARS = 12;
export const MAX_TRAIN_UNITS = 4;
export const DEFAULT_TRAIN_DIMENSIONS = Object.freeze({
  headLength: 20, carLength: 20, width: 2.8, height: 3.8,
  doors: 4, headDoors: 4, gap: .6, unitGap: 1.4,
  firstClassPosition: 0, firstClassDoors: 2,
});
export const TRAIN_PRESETS = [
  { id: 'metro-a', label: '地铁 A 型 · 上海 01A05', cars: 8, headLength: 25.81, carLength: 22.8, width: 3, height: 3.842, doors: 5, headDoors: 5,
    note: '上海 1 号线 · 01A05', sources: ['https://china-emu.cn/Trains/UrbanRails/Model/M-206-T.html'] },
  { id: 'metro-b', label: '地铁 B 型 · 北京 BDK03', cars: 6, headLength: 20.14, carLength: 19.52, width: 2.8, height: 3.8, doors: 4, headDoors: 4,
    note: '北京房山线 / 9 号线 · BDK03', sources: ['https://china-emu.cn/Trains/UrbanRails/Model/M-138-T.html'] },
  { id: 'metro-c', label: '地铁 C 型（C1）· 上海 06C01', cars: 4, headLength: 19.49, carLength: 19.44, width: 2.6, height: 3.842, doors: 4, headDoors: 4,
    note: '上海 6 号线 · 06C01', sources: ['https://china-emu.cn/Trains/UrbanRails/Model/M-231-T.html'] },
  { id: 'metro-l', label: '地铁 L 型 · 广州 4 号线', cars: 4, headLength: 17.6, carLength: 17.76, width: 2.89, height: 3.625, doors: 3, headDoors: 3,
    note: 'SFM03（L1）· LB 型', sources: ['https://china-emu.cn/Trains/UrbanRails/Model/M-442-T.html'] },
  { id: 'suburban-c', label: '市域 C 型 · 24.5 m / 3 门', cars: 4, headLength: 24.5, carLength: 24.5, width: 3.3, height: 4.6, doors: 3, headDoors: 3,
    note: '市域 C 型基准尺寸 · 三门方案', sources: ['https://baike.baidu.com/item/市域C型列车/63148919'] },
  { id: 'suburban-d', label: '市域 D 型 · 22 m / 4 门', cars: 4, headLength: 22, carLength: 22, width: 3.3, height: 4.125, doors: 4, headDoors: 4,
    note: '市域 D 型基准尺寸 · 四门方案', sources: ['https://baike.baidu.com/item/市域D型列车/56029117'] },
  { id: 'mtr-r', label: '香港 R-Train · 东铁线 9 节', cars: 9, headLength: 25, carLength: 24.136, width: 3.22, height: 4.18, doors: 5, headDoors: 5,
    firstClassPosition: 6, firstClassDoors: 2,
    note: 'D–P–M–M–P–F–M–P–D · 第 6 节头等车', sources: ['https://www.hkrail.net/hk/RollingStockMTR/KCR_R-Train/'] },
];
export const trainPreset = id => TRAIN_PRESETS.find(preset => preset.id === id);
export const TRAIN_DIMENSION_RULES = {
  headLength: [8, 35], carLength: [8, 35], width: [1.5, 4], height: [2, 5.5],
  doors: [1, 6, true], headDoors: [1, 6, true], gap: [.2, 2], unitGap: [.2, 4],
  firstClassPosition: [0, MAX_TRAIN_CARS, true], firstClassDoors: [1, 6, true],
};
export function validTrainDimension(key, value) {
  const rule = TRAIN_DIMENSION_RULES[key];
  return !!rule && Number.isFinite(value) && value >= rule[0] && value <= rule[1] && (!rule[2] || Number.isInteger(value));
}
export function trainDimensions(track) {
  const preset = trainPreset(track.trainPreset);
  const source = preset || track.trainCustom || {};
  return Object.fromEntries(Object.entries(DEFAULT_TRAIN_DIMENSIONS).map(([key, fallback]) => [key, source[key] ?? fallback]));
}
export function chooseTrainPreset(track, id) {
  if (id === 'custom') {
    track.trainCustom ??= trainDimensions(track);
    track.trainPreset = 'custom';
    return;
  }
  const preset = trainPreset(id);
  if (!preset) return;
  track.trainPreset = id;
  track.trainCars = preset.cars;
  track.trainUnits ??= 1;
}
export function editTrainDimension(track, key, value) {
  if (!validTrainDimension(key, value)) return false;
  track.trainCustom = { ...trainDimensions(track), [key]: value };
  track.trainPreset = 'custom';
  return true;
}
export function validTrainSettings(track) {
  return (track.trainEnabled === undefined || typeof track.trainEnabled === 'boolean') &&
    (track.trainCars === undefined || (Number.isInteger(track.trainCars) && track.trainCars >= 1 && track.trainCars <= MAX_TRAIN_CARS)) &&
    (track.trainUnits === undefined || (Number.isInteger(track.trainUnits) && track.trainUnits >= 1 && track.trainUnits <= MAX_TRAIN_UNITS)) &&
    (track.trainPreset === undefined || track.trainPreset === 'custom' || !!trainPreset(track.trainPreset)) &&
    (track.trainCustom === undefined || (track.trainCustom && typeof track.trainCustom === 'object' && !Array.isArray(track.trainCustom) &&
      Object.entries(track.trainCustom).every(([key, value]) => validTrainDimension(key, value))));
}
