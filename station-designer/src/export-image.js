import { toCanvas } from 'html-to-image';
import { exportFontCSS } from './export-fonts.js';

// Keep the visible design and its DOM labels; omit the editor's floating controls.
const editorControls = '.scene-tools, .canvas-help, .paint-toolbar, .placement-banner, .snap-feedback, .scene-loading, .vertex-marquee';
const includeInImage = element => !element.matches?.(editorControls);

export async function captureViewport(container, width, height) {
  await document.fonts.ready;
  const fontEmbedCSS = await exportFontCSS(container, includeInImage);
  return toCanvas(container, {
    width, height, pixelRatio: 2, backgroundColor: '#f6f8fb',
    filter: includeInImage, fontEmbedCSS,
  });
}

export function appendExportFooter(canvas, lines, fontFamily) {
  const scale = 2, top = canvas.height / scale;
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height + 70 * scale;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#f6f8fb'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0); ctx.scale(scale, scale);
  ctx.fillStyle = '#dce3ee'; ctx.fillRect(0, top, out.width / scale, 1);
  ctx.font = `11px ${fontFamily}`; ctx.fillStyle = '#62708a';
  ctx.fillText(lines[0], 30, top + 31, out.width / scale - 60);
  ctx.font = `9px ${fontFamily}`; ctx.fillStyle = '#8d99ac';
  ctx.fillText(lines[1], 30, top + 49, out.width / scale - 60);
  return out;
}
