// Sort a copy so editing a floor cannot change its identity or stored object references.
export const floorsTopDown = floors => [...floors].sort((a,b) => b.elevation-a.elevation);

export function adjacentFloor(floors, current, direction) {
  const ordered=floorsTopDown(floors);
  const index=ordered.findIndex(f=>f.id===current);
  if(index<0)return (direction>0?ordered[0]:ordered.at(-1))?.id;
  return ordered[index+(direction>0?-1:1)]?.id;
}

export function floorShortcut(event) {
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return 0;
  if(['+','='].includes(event.key)||event.code==='NumpadAdd')return 1;
  if(event.key==='-'||event.code==='NumpadSubtract')return -1;
  return 0;
}

export function floorElevationWarnings(floors) {
  const warnings = new Map();
  for(const floor of floors){
    const peers=floors.filter(other=>other.id!==floor.id&&Math.abs(other.elevation-floor.elevation)<1e-6);
    if(peers.length)warnings.set(floor.id,`标高重复：与 ${peers.map(other=>other.code).join('、')} 同为 ${Number(floor.elevation.toFixed(6))} m`);
  }
  return warnings;
}
