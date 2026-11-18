import { round, drawingBounds, objectBounds, lineTerminator } from './model.js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>round(value);
export function pathData(points){return points.map((p,i)=>i?(p.control?`Q ${n(p.control.x)} ${n(p.control.y)} ${n(p.x)} ${n(p.y)}`:`L ${n(p.x)} ${n(p.y)}`):`M ${n(p.x)} ${n(p.y)}`).join(' ');}
function lineGradient(o,id){
  if(!o.gradient)return '';
  let a=o.points[0],b=o.points.at(-1);
  if(Math.hypot(b.x-a.x,b.y-a.y)<.001){
    const bounds=objectBounds(o);a={x:bounds.x,y:bounds.y};
    b=bounds.right-bounds.x>=bounds.bottom-bounds.y?{x:bounds.right,y:bounds.y}:{x:bounds.x,y:bounds.bottom};
  }
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" color-interpolation="sRGB"><stop offset="0" stop-color="${o.color}"/><stop offset="1" stop-color="${o.gradient.endColor}"/></linearGradient>`;
}
export function objectMarkup(o,{names=true,interactive=false}={}){
  if(!o.visible)return '';
  const id=escapeHTML(o.id),attrs=interactive?` data-object="${id}" class="layout-object${o.locked?' is-locked':''}"`:'';
  if(o.type==='line'){
    const stop=lineTerminator(o),stopPath=stop?pathData([stop.a,stop.b]):'',dash=o.dash==='dashed'?`${o.width*3} ${o.width*2}`:o.dash==='dotted'?`0 ${o.width*2.5}`:'',mark=`arrow-${id}`;
    const markers=`${['start','both'].includes(o.arrow)?` marker-start="url(#${mark}-start)"`:''}${['end','both'].includes(o.arrow)?` marker-end="url(#${mark}-end)"`:''}`;
    const gradientId=`gradient-${id}`,endColor=o.gradient?.endColor||o.color,stroke=o.gradient?`url(#${gradientId})`:o.color;
    const gradient=lineGradient(o,gradientId);
    const arrows=o.arrow==='none'?'':`<marker id="${mark}-end" viewBox="0 0 10 10" refX="${stop?20:8}" refY="5" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${endColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker><marker id="${mark}-start" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${o.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
    const defs=gradient||arrows?`<defs>${gradient}${arrows}</defs>`:'';
    return `<g${attrs}>${defs}<path d="${pathData(o.points)}" fill="none" stroke="${stroke}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round"${dash?` stroke-dasharray="${dash}"`:''}${markers}/>${stop?`<path class="buffer-stop" d="${stopPath}" fill="none" stroke="${endColor}" stroke-width="${n(stop.width)}" stroke-linecap="round"/>`:''}${interactive?`<path d="${pathData(o.points)}" fill="none" stroke="transparent" stroke-width="18" vector-effect="non-scaling-stroke" class="object-hit"/>${stop?`<path d="${stopPath}" fill="none" stroke="transparent" stroke-width="18" vector-effect="non-scaling-stroke" class="object-hit"/>`:''}`:''}</g>`;
  }
  if(o.type==='platform')return `<g${attrs} transform="translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.rotation)})"><rect x="${-o.width/2}" y="${-o.height/2}" width="${o.width}" height="${o.height}" rx="${Math.min(o.radius,o.width/2,o.height/2)}" fill="${o.fill}" stroke="${o.color}" stroke-width="1.5"/>${names&&o.name?`<text x="0" y="0" dy=".35em" text-anchor="middle" fill="#53627a" font-size="14" pointer-events="none">${escapeHTML(o.name)}</text>`:''}</g>`;
  const lines=o.text.split('\n'),first=-(lines.length-1)*o.fontSize*.7;
  return `<g${attrs} transform="translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.rotation)})"><text text-anchor="middle" fill="${o.color}" font-size="${o.fontSize}" font-weight="500">${lines.map((t,i)=>`<tspan x="0" y="${first+i*o.fontSize*1.4}" dy=".35em">${escapeHTML(t)}</tspan>`).join('')}</text></g>`;
}
export function sceneMarkup(project,{interactive=false}={}){
  return [...project.objects.filter(o=>o.type==='platform'),...project.objects.filter(o=>o.type==='line'),...project.objects.filter(o=>o.type==='text')].map(o=>objectMarkup(o,{names:project.settings.names,interactive})).join('');
}
export function exportSVG(project){
  const b=drawingBounds(project.objects.filter(o=>o.visible)),padding=60,title=project.settings.title?58:0,x=b.x-padding,y=b.y-padding-title,width=Math.max(320,b.width+padding*2),height=Math.max(200,b.height+padding*2+title);
  return {width,height,source:`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(x)} ${n(y)} ${n(width)} ${n(height)}"><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${project.settings.background}"/><g font-family="Segoe UI,Microsoft YaHei,PingFang SC,sans-serif">${title?`<text x="${n(b.x)}" y="${n(b.y-60)}" font-size="24" font-weight="600" fill="#27374f">${escapeHTML(project.name)}</text>`:''}${sceneMarkup(project)}</g></svg>`};
}

