import test from 'node:test';
import assert from 'node:assert/strict';
import { addAnime } from './utils/cache-util.js';
import TmdbSource from './sources/tmdb.js';
import VodSource from './sources/vod.js';
import HanjutvSource from './sources/hanjutv.js';
import AcfunSource from './sources/acfun.js';
import EzdmwSource from './sources/ezdmw.js';
import TencentSource from './sources/tencent.js';
import BilibiliSource from './sources/bilibili.js';
import AiyifanSource from './sources/aiyifan.js';
import DandanSource from './sources/dandan.js';
import { Globals, globals } from './configs/globals.js';

function resetRuntime() {
  Globals.init({ LOG_LEVEL: 'error', MAX_ANIMES: '1000' });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();
  globals.vodAllowedPlatforms = ['qq', 'qiyi', 'youku', 'acfun', 'ezdmw', 'hanjutv'];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('addAnime should accept handleAnimes options object with detailStore', () => {
  resetRuntime();

  const detailStore = new Map();
  addAnime({
    animeId: 810001,
    bangumiId: 'source-options-detail-store',
    animeTitle: 'Options DetailStore 测试',
    type: 'tvseries',
    typeDescription: 'TV动画',
    imageUrl: '',
    startDate: '2026-01-01',
    episodeCount: 1,
    rating: 0,
    isFavorited: true,
    source: 'test',
    links: [{ url: 'https://example.test/options/1', title: '第1集' }],
  }, { detailStore, querySeason: 2 });

  assert.ok(detailStore.has('bangumi:test:source-options-detail-store'));
  assert.equal(detailStore.get('bangumi:test:source-options-detail-store').animeTitle, 'Options DetailStore 测试');
});

test('TmdbSource.handleAnimes should forward options object to DoubanSource without positional shift', async () => {
  const calls = [];
  const options = { detailStore: new Map(), querySeason: 2, queryYear: 2026 };
  const doubanSource = {
    async handleAnimes(...args) {
      calls.push(args);
      return ['ok'];
    },
  };
  const source = new TmdbSource(doubanSource);

  const result = await source.handleAnimes([{ target_id: 'tmdb-1' }], '透传测试', [], options);

  assert.deepEqual(result, ['ok']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], options);
  assert.equal(calls[0].length, 4);
});

test('VodSource.handleAnimes should keep vodName positional arg and accept options object as detailStore', async () => {
  resetRuntime();
  const detailStore = new Map();
  const curAnimes = [];
  const source = new VodSource();

  await source.handleAnimes([{
    vod_id: 820001,
    vod_name: 'VOD参数测试',
    vod_year: '2026',
    type_name: 'TV动画',
    vod_pic: '',
    vod_play_from: 'qq',
    vod_play_url: '第1集$https://vod.example.test/ep1',
  }], 'VOD参数测试', curAnimes, 'Server-A', { detailStore, querySeason: 2 });

  assert.equal(curAnimes.length, 1);
  assert.match(curAnimes[0].animeTitle, /from Server-A$/);
  assert.ok(detailStore.has('bangumi:vod:820001'));
});

test('HanjutvSource.handleAnimes should pass options object through addAnime detailStore', async () => {
  resetRuntime();
  const detailStore = new Map();
  const curAnimes = [];

  class TestHanjutvSource extends HanjutvSource {
    async buildAnimePayload() {
      return {
        summary: {
          animeId: 830001,
          bangumiId: 'hanjutv-options-1',
          animeTitle: '韩剧TV参数测试(2026)【韩剧】from hanjutv',
          type: '韩剧',
          typeDescription: '韩剧',
          imageUrl: '',
          startDate: '2026-01-01',
          episodeCount: 1,
          rating: 0,
          isFavorited: true,
          source: 'hanjutv',
        },
        links: [{ name: '第1集', url: 'hanjutv:hxq:830001', title: '【hanjutv】 第1集' }],
      };
    }
  }

  await new TestHanjutvSource().handleAnimes([{ name: '韩剧TV参数测试' }], '韩剧TV参数测试', curAnimes, { detailStore, querySeason: 2 });

  assert.equal(curAnimes.length, 1);
  assert.ok(detailStore.has('bangumi:hanjutv:hanjutv-options-1'));
});

test('AcfunSource.handleAnimes should pass options object through addAnime detailStore', async () => {
  resetRuntime();
  const detailStore = new Map();
  const curAnimes = [];

  class TestAcfunSource extends AcfunSource {
    async getEpisodes() {
      return [{ videoId: 'acfun-video-1', durationMillis: 720000, episodeName: '第1话', title: '第1话' }];
    }
  }

  await new TestAcfunSource().handleAnimes([{
    bangumiId: 'acfun-options-1',
    title: 'Acfun参数测试',
    year: 2026,
    type: '番剧',
    imageUrl: '',
  }], 'Acfun参数测试', curAnimes, { detailStore, querySeason: 2 });

  assert.equal(curAnimes.length, 1);
  assert.ok(detailStore.has('bangumi:acfun:acfun-options-1'));
});

test('TencentSource.handleAnimes should keep candidate order when detail requests finish out of order', async () => {
  resetRuntime();
  Globals.envs.sourceDetailConcurrency = 2;
  const curAnimes = [];
  const gates = new Map();
  const started = [];

  class TestTencentSource extends TencentSource {
    async getEpisodes(mediaId) {
      started.push(mediaId);
      await gates.get(mediaId).promise;
      return [{ vid: `${mediaId}-ep1`, title: '第1集', unionTitle: '第1集' }];
    }
  }

  gates.set('media-a', deferred());
  gates.set('media-b', deferred());

  const source = new TestTencentSource();
  const promise = source.handleAnimes([
    { mediaId: 'media-a', title: '腾讯甲', year: 2026, type: '动漫', imageUrl: '' },
    { mediaId: 'media-b', title: '腾讯乙', year: 2026, type: '动漫', imageUrl: '' },
  ], '腾讯', curAnimes, null);

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['media-a', 'media-b']);

  gates.get('media-b').resolve();
  await new Promise(resolve => setImmediate(resolve));
  gates.get('media-a').resolve();
  await promise;

  assert.deepEqual(curAnimes.map(anime => anime.bangumiId), ['media-a', 'media-b']);
  assert.deepEqual(Globals.animes.map(anime => anime.bangumiId), ['media-a', 'media-b']);
});

test('representative sources should keep candidate order after bounded detail concurrency', async () => {
  async function assertOrderForSource(SourceClass, candidates, expectedIds, getEpisodesImpl) {
    resetRuntime();
    Globals.envs.sourceDetailConcurrency = 2;
    const curAnimes = [];
    const gates = new Map(expectedIds.map(id => [id, deferred()]));
    const started = [];

    class TestSource extends SourceClass {
      async getEpisodes(mediaId, embeddedPlaylist) {
        const id = String(mediaId);
        started.push(id);
        await gates.get(id).promise;
        return getEpisodesImpl(id, embeddedPlaylist);
      }
    }

    const promise = new TestSource().handleAnimes(candidates, '并发顺序', curAnimes, null);

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, expectedIds);

    gates.get(expectedIds[1]).resolve();
    await new Promise(resolve => setImmediate(resolve));
    gates.get(expectedIds[0]).resolve();
    await promise;

    assert.deepEqual(curAnimes.map(anime => String(anime.bangumiId)), expectedIds);
    assert.deepEqual(Globals.animes.map(anime => String(anime.bangumiId)), expectedIds);
  }

  await assertOrderForSource(
    BilibiliSource,
    [
      { mediaId: 'ss910001', title: '并发顺序A', year: 2026, type: '动漫', imageUrl: '', aliases: [] },
      { mediaId: 'ss910002', title: '并发顺序B', year: 2026, type: '动漫', imageUrl: '', aliases: [] },
    ],
    ['ss910001', 'ss910002'],
    id => [{ link: `https://www.bilibili.com/bangumi/play/ep${id}`, title: '第1话' }]
  );

  await assertOrderForSource(
    AiyifanSource,
    [
      { mediaId: 'aiyifan-order-a', title: '并发顺序A', year: 2026, type: '动漫', imageUrl: '' },
      { mediaId: 'aiyifan-order-b', title: '并发顺序B', year: 2026, type: '动漫', imageUrl: '' },
    ],
    ['aiyifan-order-a', 'aiyifan-order-b'],
    id => [{ id: `${id}-ep1`, name: '第1集', link: `https://aiyifan.example.test/${id}/1` }]
  );
});

test('EzdmwSource.handleAnimes should pass options object through addAnime detailStore', async () => {
  resetRuntime();
  const detailStore = new Map();
  const curAnimes = [];

  class TestEzdmwSource extends EzdmwSource {
    async getBangumiDetail() {
      return {
        title: 'E站参数测试',
        year: '2026',
        typeDescription: 'TV动画',
        startDate: '2026-01-01',
        episodes: [{ name: '第1集', url: 'https://ezdmw.example.test/ep1' }],
      };
    }
  }

  await new TestEzdmwSource().handleAnimes([{ id: 'ezdmw-options-1', title: 'E站参数测试', imageUrl: '' }], 'E站参数测试', curAnimes, { detailStore, querySeason: 2 });

  assert.equal(curAnimes.length, 1);
  assert.ok(detailStore.has('bangumi:ezdmw:ezdmw-options-1'));
});

test('DandanSource related candidates should honor options querySeason when query title has no season marker', async () => {
  resetRuntime();
  const detailIds = [];
  const curAnimes = [];

  class TestDandanSource extends DandanSource {
    async getEpisodes(id) {
      detailIds.push(Number(id));
      const relateds = Number(id) === 1
        ? [
            { animeId: 2, animeTitle: '间谍过家家 第二季', imageUrl: '', rating: 0 },
            { animeId: 3, animeTitle: '间谍过家家 第三季', imageUrl: '', rating: 0 },
          ]
        : [];
      return {
        episodes: [{ episodeTitle: '第1集', episodeNumber: 1, episodeId: Number(id) * 10 + 1, airDate: '2026-01-01' }],
        titles: [],
        relateds,
        type: 'tvseries',
        typeDescription: 'TV动画',
        imageUrl: '',
      };
    }
  }

  await new TestDandanSource().handleAnimes([
    { animeId: 1, animeTitle: '间谍过家家', imageUrl: '', rating: 0, startDate: '2022-01-01' },
  ], '间谍过家家', curAnimes, { detailStore: new Map(), querySeason: 2 });

  assert.deepEqual(detailIds, [1, 2, 3], 'related candidates may need detail fetch before season validation');
  assert.deepEqual([...new Set(curAnimes.map(anime => anime.animeId))].sort((a, b) => a - b), [1, 2]);
  assert.equal(curAnimes.some(anime => anime.animeId === 3), false);
});
