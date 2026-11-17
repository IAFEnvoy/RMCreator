const fontFiles = new Map();

export function matchesUnicodeRange(range, text) {
  if (!range) return true;
  const points = Array.from(text, character => character.codePointAt(0));
  return range.split(',').some(part => {
    const value = part.trim().replace(/^U\+/i, '');
    const [start, end = start] = value.includes('?')
      ? [value.replace(/\?/g, '0'), value.replace(/\?/g, 'f')]
      : value.split('-');
    const low = parseInt(start, 16), high = parseInt(end, 16);
    return points.some(point => point >= low && point <= high);
  });
}

async function readFontRules(sheet, visited) {
  if (!sheet || visited.has(sheet)) return [];
  visited.add(sheet);
  let rules;
  try { rules = [...sheet.cssRules]; }
  catch {
    if (!sheet.href) return [];
    const response = await fetch(sheet.href, { cache: 'force-cache' });
    if (!response.ok) throw new Error('无法读取导出字体样式');
    const parsed = new CSSStyleSheet();
    parsed.replaceSync(await response.text());
    rules = [...parsed.cssRules];
  }
  const result = [];
  for (const rule of rules) {
    if (rule.type === CSSRule.FONT_FACE_RULE) result.push({ rule, base: sheet.href || document.baseURI });
    else if (rule.type === CSSRule.IMPORT_RULE) result.push(...await readFontRules(rule.styleSheet, visited));
  }
  return result;
}

function fontDataURL(url) {
  if (!fontFiles.has(url)) {
    const request = fetch(url, { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('无法读取导出字体');
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }).catch(error => { fontFiles.delete(url); throw error; });
    fontFiles.set(url, request);
  }
  return fontFiles.get(url);
}

export async function exportFontCSS(root, filter) {
  const usedFonts = new Map();
  const normalize = family => family.trim().replace(/^["']|["']$/g, '');
  const visit = element => {
    if (!filter(element)) return;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('');
    if (text.trim()) for (const family of style.fontFamily.split(',')) {
      const name = normalize(family), uses = usedFonts.get(name) || [];
      uses.push({ text, weight: Number(style.fontWeight) || 400, style: style.fontStyle });
      usedFonts.set(name, uses);
    }
    for (const child of element.children) visit(child);
  };
  visit(root);
  const visited = new Set();
  const rules = (await Promise.all([...document.styleSheets].map(sheet => readFontRules(sheet, visited)))).flat();
  const usedRules = rules.filter(({ rule }) => {
    const uses = usedFonts.get(normalize(rule.style.fontFamily));
    const weights = rule.style.fontWeight.trim().split(/\s+/).map(Number);
    const low = weights[0] || 400, high = weights[1] || low;
    return uses?.some(use => use.weight >= low && use.weight <= high
      && (!rule.style.fontStyle || rule.style.fontStyle === use.style)
      && matchesUnicodeRange(rule.style.getPropertyValue('unicode-range'), use.text));
  });
  return (await Promise.all(usedRules.map(async ({ rule, base }) => {
    let css = rule.cssText;
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const url = new URL(match[1], base).href;
      css = css.replace(match[0], `url("${await fontDataURL(url)}")`);
    }
    return css;
  }))).join('\n');
}
