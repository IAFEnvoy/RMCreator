import exitSvg from './assets/icons/exit.svg?raw';
import restroomSvg from './assets/icons/restroom.svg?raw';
import serviceSvg from './assets/icons/service.svg?raw';

// SVG Repo artwork supplied for this project; use the same geometry in UI and canvas.
const artwork = { exit: exitSvg, restroom: restroomSvg, service: serviceSvg };
const canvasArtwork = new Map();

export function facilityIcon(type, className = '') {
  return artwork[type].replace('<svg ', `<svg class="facility-icon ${className}" aria-hidden="true" `);
}

export function drawFacilityIcon(ctx, type, x, y, size, color = '#ffffff') {
  if (!canvasArtwork.has(type)) {
    const svg = new DOMParser().parseFromString(artwork[type], 'image/svg+xml').documentElement;
    const viewBox = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
    const shapes = [...svg.querySelectorAll('path, rect, circle')].map(node => {
      const attr = (name, fallback) => node.getAttribute(name) ?? svg.getAttribute(name) ?? fallback;
      const path = new Path2D(node.getAttribute('d') || '');
      if (node.localName === 'rect') path.rect(Number(node.getAttribute('x') || 0), Number(node.getAttribute('y') || 0), Number(node.getAttribute('width')), Number(node.getAttribute('height')));
      if (node.localName === 'circle') path.arc(Number(node.getAttribute('cx')), Number(node.getAttribute('cy')), Number(node.getAttribute('r')), 0, Math.PI * 2);
      return { path, fill: attr('fill', 'currentColor') !== 'none', stroke: attr('stroke', 'none') !== 'none',
        lineWidth: Number(attr('stroke-width', 1)), lineCap: attr('stroke-linecap', 'butt'), lineJoin: attr('stroke-linejoin', 'miter') };
    });
    canvasArtwork.set(type, { viewBox, shapes });
  }
  const { viewBox: [left, top, width, height], shapes } = canvasArtwork.get(type);
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / width, size / height); ctx.translate(-left, -top);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  for (const shape of shapes) {
    if (shape.fill) ctx.fill(shape.path);
    if (shape.stroke) { ctx.lineWidth = shape.lineWidth; ctx.lineCap = shape.lineCap; ctx.lineJoin = shape.lineJoin; ctx.stroke(shape.path); }
  }
  ctx.restore();
}
