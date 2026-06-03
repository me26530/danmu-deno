import test from 'node:test';
import assert from 'node:assert/strict';

import { Globals } from './configs/globals.js';
import {
  addAnime,
  addEpisode,
  findAnimeIdByCommentId,
  findAnimeTitleById,
  findTitleById,
  findUrlById,
  getCommentCache,
  getSearchCache,
  migrateLegacyRuntimeCaches,
  setCommentCache,
  setSearchCache,
} from './utils/cache-util.js';

function resetRuntime() {
  Globals.init({ LOG_LEVEL: 'error', MAX_ANIMES: '1000' });
  Globals.MAX_ANIMES = 1000;
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.commentCache = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();
  Globals.requestHistory = new Map();
  Globals.episodeIdByKey = undefined;
  Globals.episodeById = undefined;
  Globals.animeByIdentity = undefined;
  Globals.animeLinkByCommentId = undefined;
  Globals.runtimeCacheIndexRefs = undefined;
}

function createAnime({ animeId, source = 'dandan', title = '缓存索引番剧', links = null }) {
  return {
    animeId,
    bangumiId: `cache-index-${source}-${animeId}`,
    animeTitle: `${title} from ${source}`,
    type: 'tvseries',
    typeDescription: 'TV动画',
    imageUrl: '',
    startDate: '2024-01-01T00:00:00.000Z',
    episodeCount: links?.length ?? 2,
    rating: 0,
    isFavorited: false,
    source,
    links: links || [
      { url: `https://example.com/${source}/${animeId}/1`, title: `【${source}】第1集` },
      { url: `https://example.com/${source}/${animeId}/2`, title: `【${source}】第2集` },
    ],
  };
}

function withArrayMethodSpy(methodName, fn) {
  const original = Array.prototype[methodName];
  let calls = 0;
  Array.prototype[methodName] = function spiedArrayMethod(...args) {
    calls += 1;
    return original.apply(this, args);
  };

  try {
    const result = fn();
    return { calls, result };
  } finally {
    Array.prototype[methodName] = original;
  }
}

test('episode lookups should use rebuilt O(1) runtime indexes without scanning episodeIds', () => {
  resetRuntime();

  const first = addEpisode('https://example.com/video/1', '第1集');
  assert.equal(first.id, 10002);

  const duplicateResult = withArrayMethodSpy('find', () => addEpisode('https://example.com/video/1', '第1集'));
  assert.equal(duplicateResult.result.id, first.id);
  assert.equal(duplicateResult.calls, 0, 'duplicate addEpisode should not scan episodeIds with Array.find');

  const lookupResult = withArrayMethodSpy('find', () => ({
    url: findUrlById(first.id),
    title: findTitleById(first.id),
  }));
  assert.deepEqual(lookupResult.result, {
    url: 'https://example.com/video/1',
    title: '第1集',
  });
  assert.equal(lookupResult.calls, 0, 'findUrlById/findTitleById should not scan episodeIds with Array.find');

  const migrationResult = withArrayMethodSpy('map', () => migrateLegacyRuntimeCaches());
  assert.equal(migrationResult.result, false);
  assert.equal(migrationResult.calls, 0, 'already migrated runtime caches should not be remigrated with Array.map');
});

test('runtime indexes should rebuild from legacy arrays restored without index maps', () => {
  resetRuntime();

  Globals.episodeIds = [{ id: 93001, url: 'https://legacy.example/ep1', title: '旧缓存第1集' }];
  Globals.episodeById = undefined;
  Globals.episodeIdByKey = undefined;
  Globals.runtimeCacheIndexRefs = undefined;

  assert.equal(findUrlById(93001), 'https://legacy.example/ep1');
  assert.equal(findTitleById(93001), '旧缓存第1集');

  const duplicate = addEpisode('https://legacy.example/ep1', '旧缓存第1集');
  assert.equal(duplicate.id, 93001, 'legacy episode should be found through rebuilt composite-key index');
});

test('anime identity and comment-id lookups should use runtime indexes without scanning animes', () => {
  resetRuntime();

  const anime = createAnime({ animeId: 94001, source: 'dandan' });
  assert.equal(addAnime(anime), true);
  const firstCommentId = Globals.animes[0].links[0].id;

  const lookupResult = withArrayMethodSpy('find', () => ({
    animeTitle: findAnimeTitleById(firstCommentId),
    animeInfo: findAnimeIdByCommentId(firstCommentId),
  }));

  assert.equal(lookupResult.result.animeTitle, anime.animeTitle);
  assert.deepEqual(lookupResult.result.animeInfo, [anime.animeId, anime.source, '【dandan】第1集']);
  assert.equal(lookupResult.calls, 0, 'comment-id lookups should not scan anime.links with Array.find');

  const replacement = createAnime({
    animeId: 94001,
    source: 'dandan',
    title: '缓存索引番剧 更新',
    links: [{ url: 'https://example.com/dandan/94001/new-1', title: '【dandan】新版第1集' }],
  });
  const replaceResult = withArrayMethodSpy('findIndex', () => addAnime(replacement));
  assert.equal(replaceResult.result, true);
  assert.equal(replaceResult.calls, 0, 'same-identity replacement should not scan animes with Array.findIndex');
  assert.equal(Globals.animes.length, 1);
  assert.equal(Globals.animes[0].animeTitle, replacement.animeTitle);
});

test('SEARCH_CACHE_MINUTES=0 should disable search cache writes and hits', () => {
  resetRuntime();
  Globals.envs.searchCacheMinutes = 0;

  setSearchCache('禁用搜索缓存', [{ animeId: 1, animeTitle: '禁用搜索缓存' }]);

  assert.equal(Globals.searchCache.size, 0);
  assert.equal(getSearchCache('禁用搜索缓存'), null);
});

test('COMMENT_CACHE_MINUTES=0 should disable comment cache writes and hits', () => {
  resetRuntime();
  Globals.envs.commentCacheMinutes = 0;

  setCommentCache('https://example.test/video/1', [{ p: '0,1,25,16777215,0,0,0,0', m: '弹幕' }]);

  assert.equal(Globals.commentCache.size, 0);
  assert.equal(getCommentCache('https://example.test/video/1'), null);
});
