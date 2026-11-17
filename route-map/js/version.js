export const version = '1.0-beta.7';
// Capability for packed app
export const isTauri = !!window.__TAURI__ || window.location.protocol === 'tauri:';

export async function loadVersion() {
  let commit = await fetch(new URL('../commit.json', document.baseURI))
    .then(res => res.ok ? res.json() : null)
    .then(res => typeof res?.commit === 'string' ? res.commit.substring(0, 7) : 'dev')
    .catch(() => 'dev');
  if (!commit) commit = 'dev';
  document.getElementById("rmcVersion").innerText = isTauri ? `v${version}` : `v${version}-${commit}`;
  let downloadAppBtn = document.getElementById('downloadApp');
  if (isTauri) downloadAppBtn.hidden = true;
  else downloadAppBtn.onclick = _ => window.open('https://github.com/IAFEnvoy/RMCreator-App/releases', '_blank');
}
