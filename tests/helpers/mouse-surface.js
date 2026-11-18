// A small DOM event surface for exercising production mouse handlers in Node.
export class MouseSurface {
  constructor() {
    this.listeners = new Map(); this.style = {}; this.clientWidth = 1000; this.clientHeight = 600;
    this.classList = { add() {}, remove() {} };
  }
  addEventListener(type, fn, options) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, capture: !!(options === true || options?.capture) }); this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.fn !== fn));
  }
  emit(type, options = {}) {
    const event = { type, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, target: this,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...options };
    event.pageX = event.clientX; event.pageY = event.clientY;
    for (const entry of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      entry.fn(event); if (event.stopped) break;
    }
    if (!event.stopped && this.ownerDocument) this.ownerDocument.emit(type, event);
    return event;
  }
  focus() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getScreenCTM() { return { inverse: () => ({}) }; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; }
  contains(target) { return target === this; }
  closest() { return null; }
}
