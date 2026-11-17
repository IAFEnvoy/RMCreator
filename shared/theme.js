import { ROUTE_STORAGE_KEYS } from './storage-keys.js';

export function themeTokens(input = '#2f6de5') {
  let hex = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(input) ? input.slice(0, 7) : '#2f6de5';
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const mix = (target, ratio) => '#' + rgb.map(c => Math.round(c + (target - c) * ratio).toString(16).padStart(2, '0')).join('');
  return {
    '--accent': hex, '--accent-rgb': rgb.join(', '),
    '--accent-strong': mix(0, .18), '--accent-soft': mix(255, .88),
    '--accent-focus': mix(255, .55), '--accent-ink': mix(0, .55),
    '--soft': mix(255, .88),
  };
}

export function applySharedTheme() {
  let accent;
  // The shared shell only reads this preference. Project stores remain separate.
  try { accent = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEYS.settings))?.themeAccentColor; } catch { /* Use defaults. */ }
  for (const [key, value] of Object.entries(themeTokens(accent))) document.documentElement.style.setProperty(key, value);
}

if (typeof window !== 'undefined') {
  applySharedTheme();
  window.addEventListener('storage', event => {
    if (event.key === ROUTE_STORAGE_KEYS.settings || event.key === null) applySharedTheme();
  });
}
