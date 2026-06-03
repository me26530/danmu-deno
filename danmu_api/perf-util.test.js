import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerfCollector } from './utils/perf-util.js';
import { Globals } from './configs/globals.js';
import { setSearchCache } from './utils/cache-util.js';
import { searchAnime } from './apis/dandan-api.js';

test('createPerfCollector(false) should behave like a no-op collector', async () => {
  const perf = createPerfCollector(false);

  const token = perf.start('search');
  const ended = perf.end(token);
  const wrapped = await perf.wrap('noop-task', async () => 42);

  assert.equal(ended, null);
  assert.equal(wrapped, 42);
  assert.equal(perf.entries.length, 0);
  assert.deepEqual(perf.snapshot(), []);
  assert.equal(perf.summary().count, 0);
});

test('createPerfCollector(true) should record nested timings', async () => {
  const perf = createPerfCollector(true);

  const value = await perf.wrap('outer', async () => {
    const token = perf.start('inner');
    await new Promise((resolve) => setImmediate(resolve));
    perf.end(token, { detailRequests: 3 });
    return 'ok';
  });

  assert.equal(value, 'ok');
  assert.equal(perf.entries.length, 2);
  assert.equal(perf.summary().count, 2);
  assert.equal(perf.summary().names.outer.count, 1);
  assert.equal(perf.summary().names.inner.count, 1);
  assert.equal(perf.entries[0].name, 'outer');
  assert.equal(perf.entries[1].name, 'inner');
  assert.ok(perf.entries[1].durationMs >= 0);
  assert.equal(perf.entries[1].meta.detailRequests, 3);
});

test('searchAnime should record optional perf timings without changing response schema', async () => {
  Globals.init({
    LOG_LEVEL: 'error',
    SOURCE_ORDER: 'dandan',
    MAX_ANIMES: '1000',
  });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();

  const detailStore = new Map();
  const cachedAnime = {
    animeId: 700001,
    bangumiId: 'perf-cache-hit',
    animeTitle: '性能采集缓存命中番剧',
    type: 'tvseries',
    typeDescription: 'TV动画',
    imageUrl: '',
    startDate: '2026-01-01',
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: 'dandan',
  };
  setSearchCache('性能采集缓存命中番剧', [cachedAnime], detailStore);

  const perf = createPerfCollector(true);
  const response = await searchAnime(
    new URL('https://example.test/api/v2/search/anime?keyword=%E6%80%A7%E8%83%BD%E9%87%87%E9%9B%86%E7%BC%93%E5%AD%98%E5%91%BD%E4%B8%AD%E7%95%AA%E5%89%A7'),
    null,
    null,
    detailStore,
    { perfCollector: perf }
  );
  const body = await response.json();

  assert.deepEqual(Object.keys(body).sort(), ['animes', 'errorCode', 'errorMessage', 'success'].sort());
  assert.equal(body.success, true);
  assert.equal(body.animes.length, 1);
  assert.ok(perf.entries.some((entry) => entry.name === 'searchAnime.total'));
  assert.ok(perf.entries.some((entry) => entry.name === 'searchAnime.cache'));
});

test('searchAnime should parse valid season context for perf metadata', async () => {
  Globals.init({ LOG_LEVEL: 'error', SOURCE_ORDER: 'dandan' });
  Globals.searchCache = new Map();
  const perf = createPerfCollector(true);

  await searchAnime(
    new URL('https://example.test/api/v2/search/anime?keyword=%E5%AD%A3%E5%BA%A6%E5%85%83%E6%95%B0%E6%8D%AE&season=2'),
    null,
    null,
    new Map(),
    { perfCollector: perf }
  );

  const totalEntry = perf.entries.find((entry) => entry.name === 'searchAnime.total');
  assert.equal(totalEntry?.meta.querySeason, 2);
});

test('searchAnime should isolate season-specific cache from unseasoned cache', async () => {
  Globals.init({ LOG_LEVEL: 'error', SOURCE_ORDER: 'dandan' });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();

  const detailStore = new Map();
  setSearchCache('缓存隔离番剧', [{
    animeId: 710001,
    bangumiId: 'unseasoned-cache-entry',
    animeTitle: '缓存隔离番剧 第一季',
    type: 'tvseries',
    typeDescription: 'TV动画',
    imageUrl: '',
    startDate: '2026-01-01',
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: 'dandan',
  }], detailStore);

  const perf = createPerfCollector(true);
  const response = await searchAnime(
    new URL('https://example.test/api/v2/search/anime?keyword=%E7%BC%93%E5%AD%98%E9%9A%94%E7%A6%BB%E7%95%AA%E5%89%A7&season=2'),
    null,
    null,
    new Map(),
    { perfCollector: perf }
  );
  const body = await response.json();
  const cacheEntry = perf.entries.find((entry) => entry.name === 'searchAnime.cache');

  assert.equal(cacheEntry?.meta.hit, false);
  assert.equal(body.success, true);
  assert.deepEqual(body.animes, []);
});

test('searchAnime match-internal legacy cache fallback should not return explicit wrong-season candidates', async () => {
  Globals.init({ LOG_LEVEL: 'error', SOURCE_ORDER: 'dandan' });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();

  setSearchCache('旧缓存季度过滤番剧', [
    {
      animeId: 720001,
      bangumiId: 'legacy-cache-s1',
      animeTitle: '旧缓存季度过滤番剧 第一季',
      type: 'tvseries',
      typeDescription: 'TV动画',
      imageUrl: '',
      startDate: '2025-01-01',
      episodeCount: 1,
      rating: 0,
      isFavorited: true,
      source: 'dandan',
    },
    {
      animeId: 720002,
      bangumiId: 'legacy-cache-s2',
      animeTitle: '旧缓存季度过滤番剧 第二季',
      type: 'tvseries',
      typeDescription: 'TV动画',
      imageUrl: '',
      startDate: '2026-01-01',
      episodeCount: 1,
      rating: 0,
      isFavorited: true,
      source: 'dandan',
    },
    {
      animeId: 720003,
      bangumiId: 'legacy-cache-s3',
      animeTitle: '旧缓存季度过滤番剧 第三季',
      type: 'tvseries',
      typeDescription: 'TV动画',
      imageUrl: '',
      startDate: '2027-01-01',
      episodeCount: 1,
      rating: 0,
      isFavorited: true,
      source: 'dandan',
    },
  ], new Map());

  const response = await searchAnime(
    new URL('https://example.test/api/v2/search/anime?keyword=%E6%97%A7%E7%BC%93%E5%AD%98%E5%AD%A3%E5%BA%A6%E8%BF%87%E6%BB%A4%E7%95%AA%E5%89%A7&season=2'),
    null,
    null,
    new Map(),
    { allowUnseasonedCacheFallback: true }
  );
  const body = await response.json();

  assert.deepEqual(body.animes.map(anime => anime.bangumiId), ['legacy-cache-s2']);
});
