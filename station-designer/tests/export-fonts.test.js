import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUnicodeRange } from '../src/export-fonts.js';

test('PNG export includes the font subsets used by Chinese, Latin and supplementary characters', () => {
  assert.equal(matchesUnicodeRange('U+4E00-9FFF', '上海火车站'), true);
  assert.equal(matchesUnicodeRange('U+0000-00FF', '上海火车站'), false);
  assert.equal(matchesUnicodeRange('U+0000-00FF', 'Shanghai'), true);
  assert.equal(matchesUnicodeRange('U+20000-2FFFF', '𠮷'), true);
  assert.equal(matchesUnicodeRange('U+3000, U+4E0?, U+9F00-9FFF', '上'), true);
  assert.equal(matchesUnicodeRange('U+3000, U+4E0?, U+9F00-9FFF', '海'), false);
  assert.equal(matchesUnicodeRange('', '1号口'), true);
});
