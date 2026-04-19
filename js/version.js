export const version = '1.0-beta.3';
// Capability for packed app
export const isTauri = !!window.__TAURI__ || window.location.protocol === 'tauri:';

export async function loadVersion() {
  let commit = await fetch('/commit.json')
    .then(res => res.json())
    .then(res => res.commit.substring(0, 7))
    .catch(console.log);
  if (!commit) commit = 'dev';
  document.getElementById("rmcVersion").innerText = isTauri ? `v${version}` : `v${version}-${commit}`;
  let downloadAppBtn = document.getElementById('downloadApp');
  if (isTauri) downloadAppBtn.hidden = true;
  else downloadAppBtn.onclick = _ => window.open('https://github.com/IAFEnvoy/RMCreator-App/releases', '_blank');
}
