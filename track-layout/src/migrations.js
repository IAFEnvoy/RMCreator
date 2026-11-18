import legacyReferenceLink from './legacy-reference-link.json' with { type: 'json' };

function sameValue(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key]));
}

// Merge only the untouched eight-piece example; edited fragments remain intact.
export function upgradeReferenceLink(project,template){
  const merged=template.objects.find(o=>o.id==='reference-14');
  if(!merged?.gradient||!legacyReferenceLink.every(expected=>sameValue(project.objects.find(o=>o.id===expected.id),expected)))return;
  const ids=new Set(legacyReferenceLink.map(o=>o.id));
  project.objects=project.objects.flatMap(o=>!ids.has(o.id)?[o]:o.id===merged.id?[structuredClone(merged)]:[]);
}
