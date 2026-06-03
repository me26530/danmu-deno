import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSeasonNumberFromAnimeTitle,
  preferSeasonCandidatesIfPresent,
} from './utils/common-util.js';

test('preferSeasonCandidatesIfPresent should keep only target season when present', () => {
  const candidates = [
    { title: '间谍过家家' },
    { title: '间谍过家家 第二季' },
    { title: '间谍过家家 第三季' },
  ];

  const filtered = preferSeasonCandidatesIfPresent(candidates, 2, item => item.title);

  assert.deepEqual(filtered.map(item => item.title), ['间谍过家家 第二季']);
});

test('preferSeasonCandidatesIfPresent should fall back to original candidates when target season is absent', () => {
  const candidates = [
    { title: '间谍过家家' },
    { title: '间谍过家家 第三季' },
  ];

  const filtered = preferSeasonCandidatesIfPresent(candidates, 2, item => item.title);

  assert.equal(filtered, candidates, 'fallback should keep original array identity to avoid hidden reordering');
  assert.deepEqual(filtered.map(item => item.title), ['间谍过家家', '间谍过家家 第三季']);
});

test('preferSeasonCandidatesIfPresent should treat unmarked titles as season one only for season-one queries', () => {
  const candidates = [
    { title: '葬送的芙莉莲' },
    { title: '葬送的芙莉莲 第二季' },
    { title: '葬送的芙莉莲 第1季' },
  ];

  const filtered = preferSeasonCandidatesIfPresent(candidates, 1, item => item.title);

  assert.deepEqual(filtered.map(item => item.title), ['葬送的芙莉莲', '葬送的芙莉莲 第1季']);
});

test('season helper should not mis-detect Gundam 00 as a season but should detect Oshi no Ko 2', () => {
  assert.deepEqual(extractSeasonNumberFromAnimeTitle('机动战士高达00'), {
    season: null,
    baseTitle: '机动战士高达00',
  });

  assert.deepEqual(extractSeasonNumberFromAnimeTitle('我推的孩子2'), {
    season: 2,
    baseTitle: '我推的孩子',
  });
});
