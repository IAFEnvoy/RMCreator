// Shared by the visible cabinets and automatic railing openings.
export function gateLayout(gate) {
  const count = Math.max(2, Math.min(12, Math.round(gate.d / 1.2)));
  const pitch = gate.d / count;
  return {
    cabinetWidth: .45,
    centers: Array.from({ length: count }, (_, i) => -gate.d / 2 + (i + .5) * pitch),
  };
}
