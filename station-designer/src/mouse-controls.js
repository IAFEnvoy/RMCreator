import { MOUSE } from 'three';

export function setMouseButtons(controls, event = {}) {
  // OrbitControls swaps pan and rotate with these modifiers. Compensate so
  // continuous placement (Shift) keeps the same navigation buttons.
  const modified = event.ctrlKey || event.metaKey || event.shiftKey;
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = modified ? MOUSE.PAN : MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = modified ? MOUSE.ROTATE : MOUSE.PAN;
}
