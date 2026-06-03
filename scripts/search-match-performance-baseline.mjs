#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { Globals } from '../danmu_api/configs/globals.js';
import { addAnime, setSearchCache, getSearchCache } from '../danmu_api/utils/cache-util.js';
import { applyMergeLogic } from '../danmu_api/utils/merge-util.js';
import { searchAnime } from '../danmu_api/apis/dandan-api.js';

const DEFAULT_SIZES = [25, 100, 500];
const DEFAULT_LINKS_PER_ANIME = 12;
const DEFAULT_SOURCE_COUNT = 5;

function parseArgs(argv) {
  const options = {
    sizes: DEFAULT_SIZES,
    linksPerAnime: DEFAULT_LINKS_PER_ANIME,
    sourceCount: DEFAULT_SOURCE_COUNT,
    includeMerge: true,
    mergeMaxSize: 25,
    outputJson: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--sizes=')) {
      options.sizes = arg.slice('--sizes='.length)
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);
    } else if (arg.startsWith('--links=')) {
      const value = Number.parseInt(arg.slice('--links='.length), 10);
      if (Number.isFinite(value) && value > 0) options.linksPerAnime = value;
    } else if (arg.startsWith('--sources=')) {
      const value = Number.parseInt(arg.slice('--sources='.length), 10);
      if (Number.isFinite(value) && value > 0) options.sourceCount = value;
    } else if (arg === '--skip-merge') {
      options.includeMerge = false;
    } else if (arg.startsWith('--merge-max=')) {
      const value = Number.parseInt(arg.slice('--merge-max='.length), 10);
      if (Number.isFinite(value) && value > 0) options.mergeMaxSize = value;
    } else if (arg === '--json') {
      options.outputJson = true;
    }
  }

  if (options.sizes.length === 0) options.sizes = DEFAULT_SIZES;
  return options;
}

function resetRuntime(extraEnv = {}) {
  Globals.init({
    LOG_LEVEL: 'error',
    MAX_ANIMES: '100000',
    SOURCE_ORDER: 'dandan,bilibili,animeko,tencent,youku',
    MERGE_SOURCE_PAIRS: '',
    ...extraEnv,
  });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.logBuffer = [];
  Globals.requestHistory = new Map();
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();
  Globals.searchCache = new Map();
  Globals.commentCache = new Map();
  Globals.lastSelectMap = new Map();
  Globals.reqRecords = [];
  Globals.localCacheValid = false;
  Globals.redisValid = false;
  Globals.localRedisValid = false;
}

function elapsedMs(start) {
  return Number((performance.now() - start).toFixed(3));
}

function makeLinks({ source, animeIndex, linksPerAnime }) {
  return Array.from({ length: linksPerAnime }, (_, index) => {
    const episodeNo = index + 1;
    return {
      name: String(episodeNo),
      url: `mock://${source}/${animeIndex}/episode/${episodeNo}`,
      title: `【${source}】第${episodeNo}集`,
    };
  });
}

function makeAnime({ source, animeIndex, linksPerAnime, titleGroup = animeIndex }) {
  const numericSource = source.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const animeId = numericSource * 100000 + animeIndex;
  const titleNo = String(titleGroup).padStart(4, '0');
  return {
    animeId,
    bangumiId: `${source}-${animeIndex}`,
    animeTitle: `性能基线番剧${titleNo}(2026)【TV动画】from ${source}`,
    aliases: [`性能基线番剧${titleNo}`],
    type: 'tvseries',
    typeDescription: 'TV动画',
    imageUrl: '',
    startDate: '2026-01-01',
    episodeCount: linksPerAnime,
    rating: 0,
    isFavorited: true,
    source,
    links: makeLinks({ source, animeIndex, linksPerAnime }),
  };
}

function makeVodCandidate({ animeIndex, linksPerAnime }) {
  const episodes = Array.from({ length: linksPerAnime }, (_, index) => {
    const episodeNo = index + 1;
    return `第${episodeNo}集$https://vod.example/perf/${animeIndex}/${episodeNo}`;
  }).join('#');

  return {
    vod_id: 900000 + animeIndex,
    vod_name: `性能Lazy番剧 ${String(animeIndex).padStart(4, '0')}`,
    vod_year: '2026',
    type_name: 'TV动画',
    vod_pic: '',
    vod_play_from: 'qq',
    vod_play_url: episodes,
  };
}

function installVodFetchMock(candidates) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ list: candidates }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function bench(name, fn) {
  const start = performance.now();
  const result = await fn();
  return {
    name,
    elapsedMs: elapsedMs(start),
    ...result,
  };
}

async function benchmarkCacheWrite(size, linksPerAnime) {
  resetRuntime();
  const detailStore = new Map();
  return bench('cache-write:addAnime+addEpisode', async () => {
    for (let i = 0; i < size; i += 1) {
      addAnime(makeAnime({ source: 'dandan', animeIndex: i, linksPerAnime }), detailStore);
    }
    return {
      candidates: size,
      linksPerAnime,
      detailRequests: 0,
      storedAnimes: Globals.animes.length,
      storedEpisodes: Globals.episodeIds.length,
      detailStoreEntries: detailStore.size,
    };
  });
}

async function fakeDetailRequest(counter) {
  counter.detailRequests += 1;
  counter.active += 1;
  if (counter.active > counter.maxConcurrent) counter.maxConcurrent = counter.active;
  await new Promise((resolve) => setImmediate(resolve));
  counter.active -= 1;
}

async function benchmarkUnboundedFanout(size, linksPerAnime) {
  resetRuntime();
  const counter = { detailRequests: 0, active: 0, maxConcurrent: 0 };
  return bench('detail-fanout:unbounded-Promise.all', async () => {
    const candidates = Array.from({ length: size }, (_, index) => index);
    await Promise.all(candidates.map(async (animeIndex) => {
      await fakeDetailRequest(counter);
      return makeAnime({ source: 'dandan', animeIndex, linksPerAnime });
    }));
    return {
      candidates: size,
      linksPerAnime,
      detailRequests: counter.detailRequests,
      maxConcurrent: counter.maxConcurrent,
    };
  });
}

async function benchmarkSerialSourceHandling(size, sourceCount, linksPerAnime) {
  resetRuntime();
  const sources = ['dandan', 'bilibili', 'animeko', 'tencent', 'youku', 'iqiyi', 'migu', 'hanjutv'].slice(0, sourceCount);
  const counter = { detailRequests: 0, active: 0, maxConcurrent: 0 };
  return bench('source-handle:serial-sources+unbounded-source-detail', async () => {
    for (const source of sources) {
      const candidates = Array.from({ length: size }, (_, index) => index);
      await Promise.all(candidates.map(async (animeIndex) => {
        await fakeDetailRequest(counter);
        return makeAnime({ source, animeIndex, linksPerAnime });
      }));
    }
    return {
      candidatesPerSource: size,
      sources: sources.length,
      linksPerAnime,
      detailRequests: counter.detailRequests,
      maxConcurrent: counter.maxConcurrent,
    };
  });
}

async function benchmarkSearchCache(size, linksPerAnime) {
  resetRuntime();
  const detailStore = new Map();
  const results = Array.from({ length: size }, (_, animeIndex) => makeAnime({
    source: 'dandan',
    animeIndex,
    linksPerAnime,
  }));
  return bench('search-cache:set+get', async () => {
    setSearchCache('性能基线番剧', results, detailStore);
    const cached = getSearchCache('性能基线番剧', new Map());
    return {
      candidates: size,
      linksPerAnime,
      cacheHit: Array.isArray(cached),
      cachedResults: Array.isArray(cached) ? cached.length : 0,
      searchCacheEntries: Globals.searchCache.size,
    };
  });
}

async function benchmarkManualVodSearch(size, linksPerAnime, lazySearch) {
  resetRuntime({
    SOURCE_ORDER: 'vod',
    VOD_SERVERS: 'MockVod@https://mock-vod.example',
    VOD_RETURN_MODE: 'all',
    MERGE_SOURCE_PAIRS: '',
  });
  Globals.lazyDetailDescriptors = new Map();
  const candidates = Array.from({ length: size }, (_, animeIndex) => makeVodCandidate({ animeIndex, linksPerAnime }));
  const vodMock = installVodFetchMock(candidates);
  const detailStore = new Map();

  try {
    return await bench(`manual-search:vod-${lazySearch ? 'lazy' : 'eager'}`, async () => {
      const response = await searchAnime(
        new URL('https://example.test/api/v2/search/anime?keyword=%E6%80%A7%E8%83%BDLazy%E7%95%AA%E5%89%A7'),
        null,
        null,
        detailStore,
        { lazySearch }
      );
      const body = await response.json();
      return {
        candidates: size,
        linksPerAnime,
        resultCount: Array.isArray(body.animes) ? body.animes.length : 0,
        fetchCalls: vodMock.calls,
        storedAnimes: Globals.animes.length,
        storedEpisodes: Globals.episodeIds.length,
        detailStoreEntries: detailStore.size,
        lazyDescriptors: Globals.lazyDetailDescriptors instanceof Map ? Globals.lazyDetailDescriptors.size : 0,
      };
    });
  } finally {
    vodMock.restore();
  }
}

async function benchmarkMerge(size, linksPerAnime) {
  resetRuntime({ MERGE_SOURCE_PAIRS: 'dandan&animeko' });
  const detailStore = new Map();
  const curAnimes = [];

  for (let i = 0; i < size; i += 1) {
    const primary = makeAnime({ source: 'dandan', animeIndex: i, linksPerAnime, titleGroup: i });
    const secondary = makeAnime({ source: 'animeko', animeIndex: i, linksPerAnime, titleGroup: i });
    addAnime(primary, detailStore);
    addAnime(secondary, detailStore);
    curAnimes.push({ ...primary, links: undefined });
    curAnimes.push({ ...secondary, links: undefined });
  }

  return bench('merge:applyMergeLogic', async () => {
    await applyMergeLogic(curAnimes, detailStore);
    return {
      candidatePairs: size,
      inputAnimes: size * 2,
      outputAnimes: curAnimes.length,
      linksPerAnime,
      detailStoreEntries: detailStore.size,
    };
  });
}

function printTextReport(report) {
  console.log('# danmu_api search/match performance baseline');
  console.log(`generatedAt: ${report.generatedAt}`);
  console.log(`node: ${report.node}`);
  console.log(`sizes: ${report.options.sizes.join(',')}`);
  console.log(`linksPerAnime: ${report.options.linksPerAnime}`);
  console.log(`sourceCount: ${report.options.sourceCount}`);
  console.log(`mergeMaxSize: ${report.options.mergeMaxSize}`);
  console.log('');
  for (const group of report.groups) {
    console.log(`## size=${group.size}`);
    for (const item of group.results) {
      const parts = Object.entries(item)
        .filter(([key]) => key !== 'name')
        .map(([key, value]) => `${key}=${value}`);
      console.log(`- ${item.name}: ${parts.join(' ')}`);
    }
    console.log('');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const groups = [];

  for (const size of options.sizes) {
    const results = [];
    results.push(await benchmarkUnboundedFanout(size, options.linksPerAnime));
    results.push(await benchmarkSerialSourceHandling(size, options.sourceCount, options.linksPerAnime));
    results.push(await benchmarkCacheWrite(size, options.linksPerAnime));
    results.push(await benchmarkSearchCache(size, options.linksPerAnime));
    results.push(await benchmarkManualVodSearch(size, options.linksPerAnime, false));
    results.push(await benchmarkManualVodSearch(size, options.linksPerAnime, true));
    if (options.includeMerge && size <= options.mergeMaxSize) {
      results.push(await benchmarkMerge(size, options.linksPerAnime));
    } else if (options.includeMerge) {
      results.push({
        name: 'merge:applyMergeLogic',
        elapsedMs: null,
        candidatePairs: size,
        inputAnimes: size * 2,
        skipped: true,
        reason: `size>${options.mergeMaxSize}; run with --merge-max=${size} for explicit stress test`,
      });
    }
    groups.push({ size, results });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    options,
    groups,
  };

  if (options.outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
