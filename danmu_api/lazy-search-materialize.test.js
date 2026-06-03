import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import { searchAnime, getBangumi } from './apis/dandan-api.js';
import { handleClearCache } from './apis/system-api.js';
import { handleRequest } from './worker.js';
import { addAnime } from './utils/cache-util.js';
import { convertToAsciiSum } from './utils/codec-util.js';
import TencentSource from './sources/tencent.js';
import YoukuSource from './sources/youku.js';
import IqiyiSource from './sources/iqiyi.js';
import MangoSource from './sources/mango.js';
import BilibiliSource from './sources/bilibili.js';
import Kan360Source from './sources/kan360.js';
import TMDBSource from './sources/tmdb.js';
import DoubanSource from './sources/douban.js';
import RenrenSource from './sources/renren.js';
import BahamutSource from './sources/bahamut.js';
import CustomSource from './sources/custom.js';
import MiguSource from './sources/migu.js';
import SohuSource from './sources/sohu.js';
import LeshiSource from './sources/leshi.js';
import XiguaSource from './sources/xigua.js';
import MaiduiduiSource from './sources/maiduidui.js';
import AcfunSource from './sources/acfun.js';
import AiyifanSource from './sources/aiyifan.js';
import AnimekoSource from './sources/animeko.js';
import EzdmwSource from './sources/ezdmw.js';
import HanjutvSource from './sources/hanjutv.js';

function resetRuntime() {
  Globals.init({
    LOG_LEVEL: 'error',
    SOURCE_ORDER: 'vod',
    VOD_SERVERS: 'MockVod@https://mock-vod.example',
    VOD_RETURN_MODE: 'all',
    VOD_REQUEST_TIMEOUT: '1000',
    MERGE_SOURCE_PAIRS: '',
    MAX_ANIMES: '1000',
    SEARCH_CACHE_MINUTES: '30',
  });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.searchCache = new Map();
  Globals.commentCache = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();
  Globals.lazyDetailDescriptors = new Map();
}

function mockVodFetch(rawCandidates) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ list: rawCandidates }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('lazy manual VOD search should keep API schema and materialize details on bangumi lookup', async () => {
  resetRuntime();
  const vodMock = mockVodFetch([
    {
      vod_id: 940001,
      vod_name: '懒加载测试番剧',
      vod_year: '2026',
      type_name: 'TV动画',
      vod_pic: 'https://img.example/lazy.jpg',
      vod_play_from: 'qq',
      vod_play_url: '第1集$https://vod.example/lazy/ep1#第2集$https://vod.example/lazy/ep2',
    },
  ]);

  try {
    const response = await searchAnime(
      new URL('https://example.test/api/v2/search/anime?keyword=%E6%87%92%E5%8A%A0%E8%BD%BD%E6%B5%8B%E8%AF%95%E7%95%AA%E5%89%A7'),
      null,
      null,
      new Map(),
      { lazySearch: true }
    );
    const body = await response.json();

    assert.deepEqual(Object.keys(body).sort(), ['animes', 'errorCode', 'errorMessage', 'success'].sort());
    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].source, 'vod');
    assert.equal(body.animes[0].bangumiId, '940001');
    assert.equal(body.animes[0].episodeCount, 2);
    assert.equal('links' in body.animes[0], false);
    assert.equal(Globals.animes.length, 0, 'lazy search must not add full anime into global runtime cache');
    assert.equal(Globals.episodeIds.length, 0, 'lazy search must not allocate comment ids before materialization');
    assert.equal(Globals.searchCache.has('lazy:懒加载测试番剧'), true, 'lazy search should use a lazy-specific search cache key');
    assert.equal(Globals.searchCache.has('懒加载测试番剧'), false, 'lazy search must not pollute the eager search cache key');

    const bangumiResponse = await getBangumi('/api/v2/bangumi/940001', null, 'vod');
    const bangumiBody = await bangumiResponse.json();

    assert.equal(bangumiBody.success, true);
    assert.equal(bangumiBody.bangumi.bangumiId, '940001');
    assert.equal(bangumiBody.bangumi.episodes.length, 2);
    assert.equal(bangumiBody.bangumi.episodes[0].episodeTitle, '【qq】 第1集');
    assert.equal(Globals.animes.length, 1, 'bangumi lookup should materialize the full anime once');
    assert.equal(Globals.episodeIds.length, 2, 'materialization should allocate real comment ids for episodes');
  } finally {
    vodMock.restore();
  }
});

test('lazy VOD search cache hit should restore descriptors before bangumi materialization', async () => {
  resetRuntime();
  const vodMock = mockVodFetch([
    {
      vod_id: 940011,
      vod_name: '懒加载缓存恢复番剧',
      vod_year: '2026',
      type_name: 'TV动画',
      vod_pic: '',
      vod_play_from: 'qq',
      vod_play_url: '第1集$https://vod.example/cache-restore/ep1#第2集$https://vod.example/cache-restore/ep2',
    },
  ]);

  try {
    const searchUrl = new URL('https://example.test/api/v2/search/anime?keyword=%E6%87%92%E5%8A%A0%E8%BD%BD%E7%BC%93%E5%AD%98%E6%81%A2%E5%A4%8D%E7%95%AA%E5%89%A7');
    const firstResponse = await searchAnime(searchUrl, null, null, new Map(), { lazySearch: true });
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.success, true);
    assert.equal(firstBody.animes.length, 1);
    assert.ok(Globals.lazyDetailDescriptors.has('vod:940011'), 'first lazy search should register descriptor');
    assert.equal(vodMock.calls.length, 1);

    Globals.lazyDetailDescriptors = new Map();
    Globals.animes = [];
    Globals.episodeIds = [];

    const cachedResponse = await searchAnime(searchUrl, null, null, new Map(), { lazySearch: true });
    const cachedBody = await cachedResponse.json();
    assert.equal(cachedBody.success, true);
    assert.equal(cachedBody.animes.length, 1);
    assert.equal(vodMock.calls.length, 1, 'second lazy search should hit cache instead of refetching VOD');
    assert.ok(Globals.lazyDetailDescriptors.has('vod:940011'), 'cache hit should rehydrate the lazy descriptor');

    const bangumiResponse = await getBangumi('/api/v2/bangumi/940011', null, 'vod');
    const bangumiBody = await bangumiResponse.json();
    assert.equal(bangumiBody.success, true);
    assert.equal(bangumiBody.bangumi.episodes.length, 2);
    assert.equal(bangumiBody.bangumi.episodes[0].episodeTitle, '【qq】 第1集');
  } finally {
    vodMock.restore();
  }
});

test('lazy VOD search should keep every returned result materializable beyond search cache max items', async () => {
  resetRuntime();
  Globals.searchCacheMaxItems = 300;
  const rawCandidates = Array.from({ length: 350 }, (_, index) => ({
    vod_id: 970000 + index,
    vod_name: `宽搜索懒加载番剧 ${index}`,
    vod_year: '2026',
    type_name: 'TV动画',
    vod_pic: `https://img.example/wide-${index}.jpg`,
    vod_play_from: 'qq',
    vod_play_url: `第1集$https://vod.example/wide/${index}/ep1`,
  }));
  const vodMock = mockVodFetch(rawCandidates);

  try {
    const response = await searchAnime(
      new URL('https://example.test/api/v2/search/anime?keyword=%E5%AE%BD%E6%90%9C%E7%B4%A2%E6%87%92%E5%8A%A0%E8%BD%BD%E7%95%AA%E5%89%A7'),
      null,
      null,
      new Map(),
      { lazySearch: true }
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 350);
    assert.equal(new Set(Globals.lazyDetailDescriptors.values()).size, 350);

    const firstBangumi = await getBangumi('/api/v2/bangumi/970000', null, 'vod');
    const firstBody = await firstBangumi.json();
    assert.equal(firstBody.success, true, 'first returned lazy result should still be materializable');
    assert.equal(firstBody.bangumi.bangumiId, '970000');

    const lastBangumi = await getBangumi('/api/v2/bangumi/970349', null, 'vod');
    const lastBody = await lastBangumi.json();
    assert.equal(lastBody.success, true, 'last returned lazy result should be materializable');
    assert.equal(lastBody.bangumi.bangumiId, '970349');
  } finally {
    vodMock.restore();
  }
});

test('lazy VOD search should use source-aware bangumi ids when multiple servers return the same vod_id', async () => {
  resetRuntime();
  Globals.init({
    LOG_LEVEL: 'error',
    SOURCE_ORDER: 'vod',
    VOD_SERVERS: 'MockA@https://mock-vod-a.example,MockB@https://mock-vod-b.example',
    VOD_RETURN_MODE: 'all',
    VOD_REQUEST_TIMEOUT: '1000',
    MERGE_SOURCE_PAIRS: '',
    MAX_ANIMES: '1000',
    SEARCH_CACHE_MINUTES: '30',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    const fromA = textUrl.includes('mock-vod-a.example');
    return new Response(JSON.stringify({
      list: [
        {
          vod_id: 940020,
          vod_name: '同ID多站番剧',
          vod_year: '2026',
          type_name: 'TV动画',
          vod_pic: '',
          vod_play_from: 'qq',
          vod_play_url: fromA
            ? 'A第1集$https://vod-a.example/same-id/ep1'
            : 'B第1集$https://vod-b.example/same-id/ep1',
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await searchAnime(
      new URL('https://example.test/api/v2/search/anime?keyword=%E5%90%8CID%E5%A4%9A%E7%AB%99%E7%95%AA%E5%89%A7'),
      null,
      null,
      new Map(),
      { lazySearch: true }
    );
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.animes.length, 2);

    const bangumiIds = body.animes.map(anime => anime.bangumiId);
    assert.equal(new Set(bangumiIds).size, 2, 'same vod_id from different VOD servers must be selectable separately');
    assert.ok(bangumiIds.every(id => id !== '940020'), 'duplicate VOD summaries should not expose the ambiguous raw id as bangumiId');

    const firstBangumi = await (await getBangumi(`/api/v2/bangumi/${encodeURIComponent(bangumiIds[0])}`, null, 'vod')).json();
    const secondBangumi = await (await getBangumi(`/api/v2/bangumi/${encodeURIComponent(bangumiIds[1])}`, null, 'vod')).json();
    const episodeTitles = [
      firstBangumi.bangumi.episodes[0].episodeTitle,
      secondBangumi.bangumi.episodes[0].episodeTitle,
    ].sort();
    assert.deepEqual(episodeTitles, ['【qq】 A第1集', '【qq】 B第1集']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function prepareLazyVodDescriptor(vodId = 940002) {
  const vodMock = mockVodFetch([
    {
      vod_id: vodId,
      vod_name: '懒加载清理番剧',
      vod_year: '2026',
      type_name: 'TV动画',
      vod_pic: '',
      vod_play_from: 'qq',
      vod_play_url: '第1集$https://vod.example/cleanup/ep1',
    },
  ]);

  try {
    await searchAnime(
      new URL('https://example.test/api/v2/search/anime?keyword=%E6%87%92%E5%8A%A0%E8%BD%BD%E6%B8%85%E7%90%86%E7%95%AA%E5%89%A7'),
      null,
      null,
      new Map(),
      { lazySearch: true }
    );
  } finally {
    vodMock.restore();
  }
}

test('plain /api/v2/search/anime route should use lazy VOD summaries without adding query parameters', async () => {
  resetRuntime();
  const vodMock = mockVodFetch([
    {
      vod_id: 940010,
      vod_name: '普通接口懒搜索番剧',
      vod_year: '2026',
      type_name: 'TV动画',
      vod_pic: '',
      vod_play_from: 'qq',
      vod_play_url: '第1集$https://vod.example/plain/ep1#第2集$https://vod.example/plain/ep2',
    },
  ]);

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E6%99%AE%E9%80%9A%E6%8E%A5%E5%8F%A3%E6%87%92%E6%90%9C%E7%B4%A2%E7%95%AA%E5%89%A7'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'vod',
        VOD_SERVERS: 'MockVod@https://mock-vod.example',
        VOD_RETURN_MODE: 'all',
        VOD_REQUEST_TIMEOUT: '1000',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].bangumiId, '940010');
    assert.equal(body.animes[0].episodeCount, 2);
    assert.equal('links' in body.animes[0], false);
    assert.equal(Globals.animes.length, 0, 'plain public search route must not eagerly add full VOD anime');
    assert.equal(Globals.episodeIds.length, 0, 'plain public search route must not allocate comment ids during search');
    assert.equal(Globals.searchCache.has('lazy:普通接口懒搜索番剧'), true, 'plain public search route should populate the lazy search cache');
    assert.equal(Globals.searchCache.has('普通接口懒搜索番剧'), false, 'plain public search route should not populate the eager search cache');

    const bangumiResponse = await handleRequest(
      new Request('https://example.test/api/v2/bangumi/940010'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'vod',
        VOD_SERVERS: 'MockVod@https://mock-vod.example',
        VOD_RETURN_MODE: 'all',
        VOD_REQUEST_TIMEOUT: '1000',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const bangumiBody = await bangumiResponse.json();
    assert.equal(bangumiBody.success, true);
    assert.equal(bangumiBody.bangumi.episodes.length, 2);
    assert.equal(bangumiBody.bangumi.episodes[0].episodeTitle, '【qq】 第1集');
    assert.equal(Globals.episodeIds.length, 2, 'bangumi lookup through the existing endpoint should materialize comment ids');
  } finally {
    vodMock.restore();
  }
});

test('lazy VOD descriptor should expire with search cache window before materialization', async () => {
  resetRuntime();
  await prepareLazyVodDescriptor(940002);
  const descriptor = Globals.lazyDetailDescriptors.get('vod:940002');
  assert.ok(descriptor, 'lazy descriptor should be registered before expiry check');
  descriptor.createdAt = Date.now() - (Globals.searchCacheMinutes + 1) * 60 * 1000;

  const bangumiResponse = await getBangumi('/api/v2/bangumi/940002', null, 'vod');
  const bangumiBody = await bangumiResponse.json();

  assert.equal(bangumiResponse.status, 404);
  assert.equal(bangumiBody.success, false);
  assert.equal(Globals.lazyDetailDescriptors.has('vod:940002'), false);
});

test('clear cache should drop lazy VOD descriptors as well as normal runtime caches', async () => {
  resetRuntime();
  await prepareLazyVodDescriptor(940003);
  assert.ok(Globals.lazyDetailDescriptors.has('vod:940003'));

  const clearResponse = await handleClearCache();
  const clearBody = await clearResponse.json();
  assert.equal(clearBody.success, true);
  assert.equal(Globals.lazyDetailDescriptors.size, 0);

  const bangumiResponse = await getBangumi('/api/v2/bangumi/940003', null, 'vod');
  assert.equal(bangumiResponse.status, 404);
});

function mockDandanFetch() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    calls.push(textUrl);
    const parsed = new URL(textUrl);
    const path = parsed.searchParams.get('path') || '';

    if (path.startsWith('/v2/search/anime')) {
      return new Response(JSON.stringify({
        animes: [
          {
            animeId: 950001,
            bangumiId: '950001',
            animeTitle: '爱情懒搜索测试',
            type: 'tvseries',
            typeDescription: 'TV动画',
            imageUrl: 'https://img.example/dandan-1.jpg',
            startDate: '2026-01-01T00:00:00',
            episodeCount: 2,
            rating: 0,
          },
          {
            animeId: 950002,
            bangumiId: '950002',
            animeTitle: '爱情懒搜索测试 第二季',
            type: 'tvseries',
            typeDescription: 'TV动画',
            imageUrl: 'https://img.example/dandan-2.jpg',
            startDate: '2027-01-01T00:00:00',
            episodeCount: 1,
            rating: 0,
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const bangumiMatch = path.match(/^\/v2\/bangumi\/(\d+)/);
    if (bangumiMatch) {
      const id = bangumiMatch[1];
      return new Response(JSON.stringify({
        bangumi: {
          animeId: Number(id),
          animeTitle: id === '950001' ? '爱情懒搜索测试' : '爱情懒搜索测试 第二季',
          imageUrl: `https://img.example/dandan-${id}.jpg`,
          type: 'tvseries',
          typeDescription: 'TV动画',
          startDate: id === '950001' ? '2026-01-01T00:00:00' : '2027-01-01T00:00:00',
          rating: 0,
          titles: [
            { language: '主标题', title: id === '950001' ? '爱情懒搜索测试' : '爱情懒搜索测试 第二季' },
          ],
          relateds: [],
          episodes: id === '950001'
            ? [
                { episodeId: 951001, episodeTitle: '第1集', episodeNumber: 1, airDate: '2026-01-01T00:00:00' },
                { episodeId: 951002, episodeTitle: '第2集', episodeNumber: 2, airDate: '2026-01-08T00:00:00' },
              ]
            : [
                { episodeId: 952001, episodeTitle: '第1集', episodeNumber: 1, airDate: '2027-01-01T00:00:00' },
              ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    calls,
    detailCalls() {
      return calls.filter(call => {
        const parsed = new URL(call);
        return (parsed.searchParams.get('path') || '').startsWith('/v2/bangumi/');
      });
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function resetDandanRuntime() {
  resetRuntime();
  Globals.sourceOrderArr = ['dandan'];
  Globals.useBangumiData = false;
}

test('lazy public Dandan search should not fan out bangumi detail requests until selected', async () => {
  resetDandanRuntime();
  const dandanMock = mockDandanFetch();

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E7%88%B1%E6%83%85'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'dandan',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 2);
    const targetSummary = body.animes.find(anime => String(anime.bangumiId) === '950001');
    assert.ok(targetSummary, 'search results should include the target Dandan summary');
    assert.equal(targetSummary.source, 'dandan');
    assert.equal(targetSummary.episodeCount, 2);
    assert.equal('links' in targetSummary, false);
    assert.equal(Globals.animes.length, 0, 'lazy Dandan search must not add full anime into global runtime cache');
    assert.equal(Globals.episodeIds.length, 0, 'lazy Dandan search must not allocate comment ids during search');
    assert.equal(dandanMock.detailCalls().length, 0, 'lazy Dandan search must not call /v2/bangumi for every search result');

    const bangumiResponse = await handleRequest(
      new Request('https://example.test/api/v2/bangumi/950001'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'dandan',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const bangumiBody = await bangumiResponse.json();

    assert.equal(bangumiBody.success, true);
    assert.equal(bangumiBody.bangumi.bangumiId, '950001');
    assert.equal(bangumiBody.bangumi.episodes.length, 2);
    assert.equal(dandanMock.detailCalls().length, 1, 'only the selected Dandan bangumi should be materialized');
    assert.equal(Globals.episodeIds.length, 2, 'materialized Dandan bangumi should allocate real comment ids');
  } finally {
    dandanMock.restore();
  }
});

const OFFICIAL_SOURCE_MATRIX = [
  ['360', Kan360Source],
  ['tmdb', TMDBSource],
  ['douban', DoubanSource],
  ['renren', RenrenSource],
  ['hanjutv', HanjutvSource],
  ['bahamut', BahamutSource],
  ['custom', CustomSource],
  ['tencent', TencentSource],
  ['youku', YoukuSource],
  ['iqiyi', IqiyiSource],
  ['imgo', MangoSource],
  ['bilibili', BilibiliSource],
  ['migu', MiguSource],
  ['sohu', SohuSource],
  ['leshi', LeshiSource],
  ['xigua', XiguaSource],
  ['maiduidui', MaiduiduiSource],
  ['acfun', AcfunSource],
  ['aiyifan', AiyifanSource],
  ['animeko', AnimekoSource],
  ['ezdmw', EzdmwSource],
];

function installOfficialSourcePrototypeStubs() {
  const handleCalls = new Map(OFFICIAL_SOURCE_MATRIX.map(([source]) => [source, 0]));
  const originals = [];

  for (const [source, SourceClass] of OFFICIAL_SOURCE_MATRIX) {
    const originalSearch = SourceClass.prototype.search;
    const originalHandleAnimes = SourceClass.prototype.handleAnimes;
    originals.push(() => {
      SourceClass.prototype.search = originalSearch;
      SourceClass.prototype.handleAnimes = originalHandleAnimes;
    });

    SourceClass.prototype.search = async () => [{
      provider: source,
      mediaId: `${source}-media-1`,
      title: `全源懒搜索测试 ${source}`,
      type: '动漫',
      year: 2026,
      imageUrl: `https://img.example/${source}.jpg`,
      episodeCount: 1,
      aliases: [`全源懒搜索测试${source}`],
    }];

    SourceClass.prototype.handleAnimes = async function(sourceAnimes, queryTitle, curAnimes, detailStore = null) {
      handleCalls.set(source, handleCalls.get(source) + 1);
      for (const anime of sourceAnimes || []) {
        const mediaId = anime.mediaId || `${source}-media-1`;
        const numericAnimeId = convertToAsciiSum(mediaId);
        const summary = {
          animeId: numericAnimeId,
          bangumiId: mediaId,
          animeTitle: `${anime.title}(${anime.year})【${anime.type}】from ${source}`,
          type: anime.type,
          typeDescription: anime.type,
          imageUrl: anime.imageUrl,
          startDate: `${anime.year}-01-01T00:00:00`,
          episodeCount: 1,
          rating: 0,
          isFavorited: true,
          source,
          aliases: anime.aliases || [],
        };
        curAnimes.push(summary);
        addAnime({
          ...summary,
          links: [{
            name: '1',
            url: `https://video.example/${source}/${mediaId}/1`,
            title: `【${source}】 第1集`,
          }],
        }, detailStore);
      }
      return curAnimes;
    };
  }

  return {
    handleCalls,
    totalHandleCalls() {
      return Array.from(handleCalls.values()).reduce((sum, value) => sum + value, 0);
    },
    restore() {
      originals.reverse().forEach(restore => restore());
    },
  };
}

function fullOfficialSourceEnv() {
  return {
    LOG_LEVEL: 'error',
    SOURCE_ORDER: OFFICIAL_SOURCE_MATRIX.map(([source]) => source).join(','),
    MERGE_SOURCE_PAIRS: '',
    MAX_ANIMES: '1000',
    SEARCH_CACHE_MINUTES: '30',
    RATE_LIMIT_MAX_REQUESTS: '0',
    USE_BANGUMI_DATA: 'false',
  };
}

test('lazy Hanjutv search summary should preserve nested poster and publish year metadata', async () => {
  resetRuntime();
  Globals.sourceOrderArr = ['hanjutv'];
  Globals.useBangumiData = false;
  const originalSearch = HanjutvSource.prototype.search;

  HanjutvSource.prototype.search = async () => [{
    sid: 'MdcTscpxpH1EyBiTr417',
    name: '打架吧鬼神',
    category: 1,
    image: {
      thumb: 'https://img.example/hanjutv-thumb.jpg',
      poster: 'https://img.example/hanjutv-poster.jpg',
    },
    publishTime: 1468166400000,
    totalEpisode: 16,
    animeId: 376282,
    _variant: 'tv',
  }];

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E6%89%93%E6%9E%B6%E5%90%A7%E9%AC%BC%E7%A5%9E'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'hanjutv',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].source, 'hanjutv');
    assert.equal(body.animes[0].animeTitle, '打架吧鬼神(2016)【韩剧】from hanjutv');
    assert.equal(body.animes[0].imageUrl, 'https://img.example/hanjutv-thumb.jpg');
    assert.equal(body.animes[0].startDate, '2016-01-01T00:00:00Z');
    assert.equal(body.animes[0].episodeCount, 16);
    assert.equal('links' in body.animes[0], false);
  } finally {
    HanjutvSource.prototype.search = originalSearch;
  }
});

test('lazy Animeko summary should preserve Bangumi poster date and episode count metadata', async () => {
  resetRuntime();
  Globals.sourceOrderArr = ['animeko'];
  Globals.useBangumiData = false;
  const originalSearch = AnimekoSource.prototype.search;

  AnimekoSource.prototype.search = async () => [{
    id: 400602,
    name: 'Sousou no Frieren',
    name_cn: '葬送的芙莉莲',
    images: {
      common: 'https://lain.bgm.tv/pic/cover/c/7f/b2/400602.jpg',
      large: 'https://lain.bgm.tv/pic/cover/l/7f/b2/400602.jpg',
    },
    air_date: '2023-09-29',
    eps: 28,
    total_episodes: 28,
    score: 8.8,
    typeDescription: 'TV动画',
  }];

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E8%91%AC%E9%80%81%E7%9A%84%E8%8A%99%E8%8E%89%E8%8E%B2'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'animeko',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 1);
    assert.equal(body.animes[0].source, 'animeko');
    assert.equal(body.animes[0].imageUrl, 'https://lain.bgm.tv/pic/cover/c/7f/b2/400602.jpg');
    assert.equal(body.animes[0].startDate, '2023-01-01T00:00:00Z');
    assert.equal(body.animes[0].episodeCount, 28);
    assert.equal('links' in body.animes[0], false);
  } finally {
    AnimekoSource.prototype.search = originalSearch;
  }
});

test('lazy generic summaries should preserve legacy name/img/url shaped source metadata', async () => {
  resetRuntime();
  const originalMiguSearch = MiguSource.prototype.search;
  const originalXiguaSearch = XiguaSource.prototype.search;
  const originalMaiduiduiSearch = MaiduiduiSource.prototype.search;

  MiguSource.prototype.search = async () => [{
    name: '非标懒搜索测试',
    type: '电视剧',
    year: '2025',
    img: 'https://img.example/migu.jpg',
    url: 'https://v3-sc.miguvideo.com/program/v4/cont/content-info/migu-ep-1/1',
    epsId: 'migu-ep-1',
  }];
  XiguaSource.prototype.search = async () => [{
    name: '非标懒搜索测试',
    type: '电视剧',
    year: '2024',
    img: 'https://img.example/xigua.jpg',
    url: 'https://m.ixigua.com/video/1234567890',
  }];
  MaiduiduiSource.prototype.search = async () => [{
    name: '非标懒搜索测试',
    type: '剧集',
    year: '2023',
    img: 'https://img.example/maiduidui.jpg',
    url: 'maiduidui-uuid-1',
  }];

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E9%9D%9E%E6%A0%87%E6%87%92%E6%90%9C%E7%B4%A2%E6%B5%8B%E8%AF%95'),
      {
        LOG_LEVEL: 'error',
        SOURCE_ORDER: 'migu,xigua,maiduidui',
        MERGE_SOURCE_PAIRS: '',
        MAX_ANIMES: '1000',
        SEARCH_CACHE_MINUTES: '30',
        RATE_LIMIT_MAX_REQUESTS: '0',
        USE_BANGUMI_DATA: 'false',
      },
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, 3);

    const bySource = new Map(body.animes.map(anime => [anime.source, anime]));
    assert.equal(bySource.get('migu')?.bangumiId, 'migu-ep-1');
    assert.equal(bySource.get('migu')?.imageUrl, 'https://img.example/migu.jpg');
    assert.equal(bySource.get('migu')?.startDate, '2025-01-01T00:00:00Z');
    assert.equal(bySource.get('xigua')?.bangumiId, '1234567890');
    assert.equal(bySource.get('xigua')?.imageUrl, 'https://img.example/xigua.jpg');
    assert.equal(bySource.get('xigua')?.startDate, '2024-01-01T00:00:00Z');
    assert.equal(bySource.get('maiduidui')?.bangumiId, 'maiduidui-uuid-1');
    assert.equal(bySource.get('maiduidui')?.imageUrl, 'https://img.example/maiduidui.jpg');
    assert.equal(bySource.get('maiduidui')?.startDate, '2023-01-01T00:00:00Z');
    assert.ok(body.animes.every(anime => !('links' in anime)));
  } finally {
    MiguSource.prototype.search = originalMiguSearch;
    XiguaSource.prototype.search = originalXiguaSearch;
    MaiduiduiSource.prototype.search = originalMaiduiduiSearch;
  }
});

test('plain manual search should return poster year type and episode summary for every enabled source without links', async () => {
  resetRuntime();
  const officialStub = installOfficialSourcePrototypeStubs();

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E5%85%A8%E6%BA%90%E6%87%92%E6%90%9C%E7%B4%A2%E6%B5%8B%E8%AF%95'),
      fullOfficialSourceEnv(),
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, OFFICIAL_SOURCE_MATRIX.length);
    assert.equal(officialStub.totalHandleCalls(), 0, 'manual lazy search must not materialize any source during the search step');

    const bySource = new Map(body.animes.map(anime => [anime.source, anime]));
    for (const [source] of OFFICIAL_SOURCE_MATRIX) {
      const anime = bySource.get(source);
      assert.ok(anime, `missing ${source} summary`);
      assert.equal(anime.bangumiId, `${source}-media-1`, `${source} bangumiId should preserve raw identity`);
      assert.equal(anime.imageUrl, `https://img.example/${source}.jpg`, `${source} poster should be returned`);
      assert.equal(anime.startDate, '2026-01-01T00:00:00Z', `${source} year should be normalized into startDate`);
      assert.equal(anime.typeDescription, '动漫', `${source} type should be returned`);
      assert.equal(anime.episodeCount, 1, `${source} episode count should be returned`);
      assert.equal('links' in anime, false, `${source} search summary must not expose links`);
    }
  } finally {
    officialStub.restore();
  }
});

test('lazy public search with all official sources should not call source handleAnimes until a result is selected', async () => {
  resetRuntime();
  const officialStub = installOfficialSourcePrototypeStubs();
  const env = fullOfficialSourceEnv();

  try {
    const response = await handleRequest(
      new Request('https://example.test/api/v2/search/anime?keyword=%E5%85%A8%E6%BA%90%E6%87%92%E6%90%9C%E7%B4%A2%E6%B5%8B%E8%AF%95'),
      env,
      'test',
      '127.0.0.1'
    );
    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.animes.length, OFFICIAL_SOURCE_MATRIX.length);
    assert.equal(officialStub.totalHandleCalls(), 0, 'public lazy search must not fan out official-source detail/materialization handlers');
    assert.equal(Globals.animes.length, 0, 'lazy official search must not add full anime into global runtime cache');
    assert.equal(Globals.episodeIds.length, 0, 'lazy official search must not allocate comment ids during search');
    assert.ok(body.animes.every(anime => !('links' in anime)), 'lazy official summaries must not expose full episode links');

    const selected = body.animes.find(anime => anime.source === 'tencent');
    assert.ok(selected, 'search results should include a Tencent lazy summary');

    const bangumiResponse = await handleRequest(
      new Request(`https://example.test/api/v2/bangumi/${encodeURIComponent(selected.bangumiId)}`),
      env,
      'test',
      '127.0.0.1'
    );
    const bangumiBody = await bangumiResponse.json();

    assert.equal(bangumiBody.success, true);
    assert.equal(bangumiBody.bangumi.bangumiId, selected.bangumiId);
    assert.equal(bangumiBody.bangumi.episodes.length, 1);
    assert.equal(officialStub.handleCalls.get('tencent'), 1, 'selected source should materialize exactly once');
    assert.equal(officialStub.totalHandleCalls(), 1, 'selecting one result must not materialize other official sources');
    assert.equal(Globals.episodeIds.length, 1, 'selected official source should allocate comment ids only after materialization');
  } finally {
    officialStub.restore();
  }
});
