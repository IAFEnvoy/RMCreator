import './theme.js';
import './shell.css';

const tools = [
  ['route', '线路图绘制', '../route-map/'],
  ['station', '车站空间设计', '../station-designer/'],
];

export function appSwitcher(current) {
  const title = tools.find(([id]) => id === current)?.[1] || '选择工具';
  return `<div class="rm-app-identity"><a class="rm-brand" href="../" aria-label="RMCreator 首页">RMCreator</a><span class="rm-brand-divider"></span><details class="rm-switcher"><summary aria-label="切换设计工具"><span>${title}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><nav aria-label="设计工具">${tools.map(([id, label, href]) => `<a href="${href}" aria-label="${label}"${id === current ? ' aria-current="page"' : ''}>${label}${id === current ? '<span aria-hidden="true">✓</span>' : ''}</a>`).join('')}</nav></details></div>`;
}

document.addEventListener('click', event => {
  document.querySelectorAll('.rm-switcher[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.rm-switcher[open]').forEach(menu => { menu.open = false; });
});
