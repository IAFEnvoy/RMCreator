import { DEFAULT_TRAIN_CARS, trainDimensions } from './train-presets.js';
import { pointAlongTrack, trackGeometry } from './track-path.js';
export { DEFAULT_TRAIN_CARS, MAX_TRAIN_CARS } from './train-presets.js';

export function trainLayout(track) {
  if (track.type !== 'train' && !track.trainEnabled) return null;
  const perUnit = track.trainCars ?? DEFAULT_TRAIN_CARS, units = track.trainUnits ?? 1;
  const dimensions = trainDimensions(track), cars = [];
  let cursor = 0;
  for (let unit = 0; unit < units; unit++) {
    if (unit) cursor += dimensions.unitGap - dimensions.gap;
    for (let index = 0; index < perUnit; index++) {
      const rearCab = index === 0, frontCab = index === perUnit - 1;
      const nominalLength = rearCab || frontCab ? dimensions.headLength : dimensions.carLength;
      const firstClass = index + 1 === dimensions.firstClassPosition;
      cars.push({ unit: unit + 1, index: index + 1, rearCab, frontCab, firstClass, nominalLength,
        length: nominalLength - dimensions.gap, center: cursor + nominalLength / 2,
        doors: firstClass ? dimensions.firstClassDoors : rearCab || frontCab ? dimensions.headDoors : dimensions.doors });
      cursor += nominalLength;
    }
  }
  const nominalLength = cursor;
  cars.forEach(car => car.center -= nominalLength / 2);
  const scale = 1;
  return { count: cars.length, perUnit, units, dimensions, cars, nominalLength, scale,
    formation: Array(units).fill(perUnit).join('+'), length: nominalLength * scale, width: dimensions.width * scale,
    carLength: cars[0].length * scale, gap: dimensions.gap * scale, centers: cars.map(car => car.center * scale) };
}

export function trackLayout(project, track) {
  const line=project.lines.find(l=>l.id===track.lineId);
  // Legacy automatic directions retain their side; explicit travel always puts the band on the right.
  const legacySide=track.bandSide==='left'?-1:track.bandSide==='right'?1:track.z>=0?1:-1;
  const forward=track.direction==='forward'||(track.direction==='right-side'&&legacySide>0),side=forward?1:-1;
  const width=Math.min(64,track.l*.85),depth=11;
  const destination=track.name.trim().replace(/^往\s*/,'').replace(/\s*方向$/,'');
  const lineName=(line?.name||'').replace(/\s+/g,'');
  const p=track.path?pointAlongTrack(track,trackGeometry(track).length/2+(forward?1:-1)*Math.max(0,track.l/2-width/2-4)):null;
  const angle=p?p.angle*Math.PI/180:0;
  return {side,forward,width,depth,rotation:track.labelRotation??0,text:`${lineName}往${destination}方向`,color:line?.color||track.color,
    arrowVisible:track.arrowVisible===true,bandVisible:track.bandVisible!==false,bandColor:track.bandColor||line?.color||track.color,
    pathAngle:p?.angle||0,
    x:track.labelX??(p?p.x-Math.sin(angle)*side*(track.d/2+depth/2+1.5):(forward?1:-1)*Math.max(0,track.l/2-width/2-4)),
    z:track.labelZ??(p?p.z+Math.cos(angle)*side*(track.d/2+depth/2+1.5):side*(track.d/2+depth/2+1.5))};
}

export function trackLabelPosition(track, worldX, worldZ) {
  const a=(track.rotation||0)*Math.PI/180,dx=worldX-track.x,dz=worldZ-track.z;
  const round=value=>Math.max(-500,Math.min(500,Math.round(value*2)/2));
  return {labelX:round(dx*Math.cos(a)+dz*Math.sin(a)),labelZ:round(-dx*Math.sin(a)+dz*Math.cos(a))};
}

export function trackTextLayout(layout) {
  const vertical=layout.rotation===90||layout.rotation===270;
  const characters=Array.from(layout.text);
  // Lay vertical writing along the same strip: turn each glyph, not the strip.
  if(layout.rotation===90)characters.reverse();
  const textWidth=layout.width*789/1024;
  return {vertical,characters,glyphRotation:layout.rotation,blockRotation:layout.rotation===180?180:0,
    width:textWidth,depth:layout.depth,canvasWidth:789,canvasHeight:192};
}
