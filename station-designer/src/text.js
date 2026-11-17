import { trackLayout } from './track.js';
import { worldPoint } from './track-path.js';

export const TEXT_DEFAULTS = { text: '文字', fontSize: 4, writingMode: 'horizontal', textAlign: 'center', textReverse: false, textBold: true, textMode: 'floor', leaderLength: 8, anchorEnabled: true };
const advance = character => /[\u0000-\u00ff]/u.test(character) ? /\s/u.test(character) ? .35 : .62 : 1;

export function textLayout(text) {
  const size = text.fontSize ?? 4, vertical = text.writingMode === 'vertical';
  const lines = String(text.text ?? '').split('\n').map(line => {
    const chars = Array.from(line); return text.textReverse ? chars.reverse() : chars;
  });
  const widths = lines.map(chars => chars.reduce((sum, c) => sum + advance(c), 0));
  const width = vertical ? Math.max(1, lines.length) * 1.3 : Math.max(1, ...widths) + .2;
  const depth = vertical ? Math.max(1, ...lines.map(c => c.length)) * 1.15 + .2 : Math.max(1, lines.length) * 1.3;
  return { lines, widths, vertical, size, l: width * size, d: depth * size, advance };
}

export function textError(text) {
  if (typeof text.text !== 'string' || !text.text.trim() || text.text.length > 500) return '文字内容需为 1–500 个字符';
  if (!Number.isFinite(text.fontSize) || text.fontSize < .5 || text.fontSize > 20) return '字号需为 0.5–20 m';
  if (!['horizontal', 'vertical'].includes(text.writingMode) || !['left', 'center', 'right'].includes(text.textAlign) || typeof text.textReverse !== 'boolean' || typeof text.textBold !== 'boolean') return '文字排版参数无效';
  if(text.textMode!==undefined&&!['floor','callout'].includes(text.textMode))return '文字显示方式无效';
  if(text.leaderLength!==undefined&&(!Number.isFinite(text.leaderLength)||text.leaderLength<1||text.leaderLength>100))return '文字抬升需为 1–100 m';
  if(text.anchorEnabled!==undefined&&typeof text.anchorEnabled!=='boolean')return '锚点设置无效';
  if((text.anchorX===undefined)!==(text.anchorZ===undefined)||['anchorX','anchorZ'].some(key=>text[key]!==undefined&&(!Number.isFinite(text[key])||Math.abs(text[key])>500)))return '锚点坐标需在 ±500 m 内';
  const layout = text.textMode==='callout'?calloutLayout(text):textLayout(text);
  if (layout.l > 500 || layout.d > 500) return '文字范围不能超过 500 m，请缩小字号或换行';
  return '';
}

export function syncText(text) {
  const { l, d } = text.textMode==='callout'?calloutLayout(text):textLayout(text); text.l = l; text.d = d; text.h = .15;
  return text;
}

export function calloutLayout(text) {
  const layout=textLayout(text),padding=layout.size*.35;
  return {...layout,padding,l:layout.l+padding*2,d:layout.d+padding*2};
}

export function moveText(text,position) {
  const moved={...text,...position};
  if(text.textMode==='callout'&&text.anchorEnabled!==false){moved.anchorX=text.anchorX??text.x;moved.anchorZ=text.anchorZ??text.z;}
  return moved;
}

export function drawCallout(ctx,width,height,text,selected=false) {
  const layout=calloutLayout(text),px=width/layout.l,pz=height/layout.d;
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle=selected?'#f3f9ed':'#fffef8';ctx.strokeStyle=selected?'#709c56':text.color;
  ctx.lineWidth=Math.max(2,Math.min(px,pz)*.12);
  const inset=ctx.lineWidth/2;
  ctx.beginPath();ctx.roundRect(inset,inset,width-inset*2,height-inset*2,Math.min(width,height)*.08);ctx.fill();ctx.stroke();
  ctx.save();ctx.translate(layout.padding*px,layout.padding*pz);
  drawText(ctx,width-layout.padding*2*px,height-layout.padding*2*pz,text);ctx.restore();
}

// Convert the old track-local annotation into a world-space object once. No link to the rail is retained.
export function detachTrackTexts(project, createEntity) {
  for (const track of project.entities.filter(e => e.type === 'track')) {
    const layout = trackLayout(project, track), angle = layout.pathAngle * Math.PI / 180;
    const textCenter = (layout.forward ? -1 : 1) * layout.width * 102.5 / 1024;
    const position = worldPoint(track, { x: layout.x + textCenter * Math.cos(angle), z: layout.z + textCenter * Math.sin(angle) });
    let id = `${track.id.slice(0, 65)}-text`, suffix = 1;
    while (project.entities.some(e => e.id === id)) id = `${track.id.slice(0, 60)}-text-${suffix++}`;
    const text = createEntity(id, 'text', layout.text.slice(0, 100), Math.max(-500, Math.min(500, position.x)), Math.max(-500, Math.min(500, position.z)), {
      ...TEXT_DEFAULTS, text: layout.text, floor: track.floor, color: layout.color, visible: track.visible,
      fontSize: layout.depth / 2, writingMode: layout.rotation % 180 ? 'vertical' : 'horizontal',
      rotation: ((track.rotation + layout.pathAngle + layout.rotation) % 360 + 360) % 360,
    });
    const bounds=textLayout(text),scale=Math.min(1,500/bounds.l,500/bounds.d);
    text.fontSize*=scale;
    project.entities.push(syncText(text));
    for (const key of ['labelX', 'labelZ', 'labelRotation']) delete track[key];
  }
}

export function drawText(ctx, width, height, text) {
  const layout = textLayout(text), px = width / layout.l, pz = height / layout.d;
  ctx.fillStyle = text.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save();ctx.scale(px, pz);
  ctx.font = `${text.textBold ? 600 : 400} ${layout.size}px "Microsoft YaHei",sans-serif`;
  layout.lines.forEach((chars, index) => {
    if (layout.vertical) {
      const x = (layout.lines.length - index - .5) * layout.size * 1.3;
      const spare = layout.d - (chars.length * 1.15 + .2) * layout.size;
      const top = text.textAlign === 'left' ? 0 : text.textAlign === 'right' ? spare : spare / 2;
      chars.forEach((c, i) => ctx.fillText(c, x, top + (.65 + i * 1.15) * layout.size, layout.size));
    } else {
      const lineWidth = layout.widths[index] * layout.size;
      let cursor = text.textAlign === 'left' ? layout.size * .1 : text.textAlign === 'right' ? layout.l - lineWidth - layout.size * .1 : (layout.l - lineWidth) / 2;
      chars.forEach(c => { const step = advance(c) * layout.size;ctx.fillText(c, cursor + step / 2, (index + .5) * layout.size * 1.3, step);cursor += step; });
    }
  });
  ctx.restore();
}
