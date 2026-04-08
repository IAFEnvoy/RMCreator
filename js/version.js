export const version = '1.0-beta.2';

export async function loadVersion() {
  let commit = await fetch('/commit.json')
    .then(res => res.json())
    .then(res => res.commit.substring(0, 7))
    .catch(console.log);
  if (!commit) commit = 'dev';
  document.getElementById("rmcVersion").innerText = `v${version}-${commit}`;
}
