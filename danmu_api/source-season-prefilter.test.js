import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from './configs/globals.js';
import BilibiliSource from './sources/bilibili.js';
import DandanSource from './sources/dandan.js';
import AnimekoSource from './sources/animeko.js';
import BahamutSource from './sources/bahamut.js';
import TencentSource from './sources/tencent.js';
import YoukuSource from './sources/youku.js';
import IqiyiSource from './sources/iqiyi.js';
import MangoSource from './sources/mango.js';
import MiguSource from './sources/migu.js';
import SohuSource from './sources/sohu.js';
import LeshiSource from './sources/leshi.js';
import XiguaSource from './sources/xigua.js';
import VodSource from './sources/vod.js';
import CustomSource from './sources/custom.js';
import AcfunSource from './sources/acfun.js';
import EzdmwSource from './sources/ezdmw.js';
import HanjutvSource from './sources/hanjutv.js';
import RenrenSource from './sources/renren.js';
import Kan360Source from './sources/kan360.js';
import MaiduiduiSource from './sources/maiduidui.js';
import AiyifanSource from './sources/aiyifan.js';
import DoubanSource from './sources/douban.js';

function resetRuntime() {
  Globals.init({ LOG_LEVEL: 'error', MAX_ANIMES: '1000' });
  Globals.animes = [];
  Globals.episodeIds = [];
  Globals.episodeNum = 10001;
  Globals.animeDetailsCache = new Map();
  Globals.episodeDetailsCache = new Map();
  Globals.vodAllowedPlatforms = ['qq', 'youku', 'iqiyi', 'bilibili', 'mgtv', 'migu'];
}

class CountingBilibiliSource extends BilibiliSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getEpisodes(id) {
    this.detailIds.push(id);
    return [{ link: `https://www.bilibili.com/bangumi/play/ep${id}`, title: '第1话' }];
  }
}

class CountingDandanSource extends DandanSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getEpisodes(id) {
    this.detailIds.push(id);
    return {
      episodes: [{ episodeTitle: '第1集', episodeNumber: 1, episodeId: Number(id) * 10 + 1, airDate: '2026-01-01' }],
      titles: [],
      relateds: [],
      type: 'tvseries',
      typeDescription: 'TV动画',
      imageUrl: '',
    };
  }
}

class CountingAnimekoSource extends AnimekoSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getEpisodes(id) {
    this.detailIds.push(id);
    return [{ type: 0, sort: 1, ep: 1, id: Number(id) * 10 + 1, name_cn: '第1话', airdate: '2026-01-01' }];
  }
}

class CountingBahamutSource extends BahamutSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getEpisodes(id) {
    this.detailIds.push(id);
    return {
      video: { title: '第1集' },
      anime: {
        title: '间谍过家家',
        episodes: {
          0: [{ episode: 1, videoSn: Number(id) * 10 + 1 }],
        },
      },
    };
  }
}

test('Batch A sources should request details only for target season when explicit target candidates exist', async () => {
  resetRuntime();
  const options = { detailStore: new Map(), querySeason: 2 };

  const bilibili = new CountingBilibiliSource();
  await bilibili.handleAnimes([
    { mediaId: 'ss101', title: '间谍过家家', year: 2022, type: '番剧' },
    { mediaId: 'ss102', title: '间谍过家家 第二季', year: 2023, type: '番剧' },
    { mediaId: 'ss103', title: '间谍过家家 第三季', year: 2025, type: '番剧' },
  ], '间谍过家家', [], options);
  assert.deepEqual(bilibili.detailIds, ['ss102']);

  const dandan = new CountingDandanSource();
  await dandan.handleAnimes([
    { animeId: 201, animeTitle: '间谍过家家', imageUrl: '', rating: 0, startDate: '2022-01-01' },
    { animeId: 202, animeTitle: '间谍过家家 第二季', imageUrl: '', rating: 0, startDate: '2023-01-01' },
    { animeId: 203, animeTitle: '间谍过家家 第三季', imageUrl: '', rating: 0, startDate: '2025-01-01' },
  ], '间谍过家家', [], options);
  assert.deepEqual(dandan.detailIds, [202]);

  const animeko = new CountingAnimekoSource();
  await animeko.handleAnimes([
    { id: 301, name: 'SPY×FAMILY', name_cn: '间谍过家家', air_date: '2022-01-01', aliases: [] },
    { id: 302, name: 'SPY×FAMILY Season 2', name_cn: '间谍过家家 第二季', air_date: '2023-01-01', aliases: [] },
    { id: 303, name: 'SPY×FAMILY Season 3', name_cn: '间谍过家家 第三季', air_date: '2025-01-01', aliases: [] },
  ], '间谍过家家', [], options);
  assert.deepEqual(animeko.detailIds, [302]);

  const bahamut = new CountingBahamutSource();
  await bahamut.handleAnimes([
    { video_sn: 401, title: '间谍过家家', info: '2022' },
    { video_sn: 402, title: '间谍过家家 第二季', info: '2023' },
    { video_sn: 403, title: '间谍过家家 第三季', info: '2025' },
  ], '间谍过家家', [], options);
  assert.deepEqual(bahamut.detailIds, [402]);
});

function createCountingSource(BaseClass, makeEpisodes) {
  return class extends BaseClass {
    constructor() {
      super();
      this.detailIds = [];
    }

    async getEpisodes(id) {
      this.detailIds.push(id);
      return makeEpisodes(id);
    }
  };
}

test('Batch B video sources should request details only for target season when explicit target candidates exist', async () => {
  resetRuntime();
  const options = { detailStore: new Map(), querySeason: 2 };

  const cases = [
    {
      Source: createCountingSource(TencentSource, id => [{ vid: `${id}-v1`, unionTitle: '第1集' }]),
      candidates: [
        { mediaId: 'tx101', title: '间谍过家家', year: 2022, type: '动漫', aliases: [] },
        { mediaId: 'tx102', title: '间谍过家家 第二季', year: 2023, type: '动漫', aliases: [] },
        { mediaId: 'tx103', title: '间谍过家家 第三季', year: 2025, type: '动漫', aliases: [] },
      ],
      expected: ['tx102'],
    },
    {
      Source: createCountingSource(YoukuSource, id => [{ id: `${id}-v1`, title: '第1集', link: `https://v.youku.com/v_show/id_${id}.html` }]),
      candidates: [
        { mediaId: 'yk101', title: '间谍过家家', year: 2022, type: '动漫', cats: '动漫' },
        { mediaId: 'yk102', title: '间谍过家家 第二季', year: 2023, type: '动漫', cats: '动漫' },
        { mediaId: 'yk103', title: '间谍过家家 第三季', year: 2025, type: '动漫', cats: '动漫' },
      ],
      expected: ['yk102'],
    },
    {
      Source: createCountingSource(IqiyiSource, id => [{ order: 1, title: '第1集', link: `https://www.iqiyi.com/v_${id}.html` }]),
      candidates: [
        { mediaId: 'iq101', title: '间谍过家家', year: 2022, type: '动漫' },
        { mediaId: 'iq102', title: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { mediaId: 'iq103', title: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['iq102'],
    },
    {
      Source: createCountingSource(MangoSource, id => [{ video_id: `${id}-v1`, t1: '第1集', t2: '' }]),
      candidates: [
        { mediaId: 'mg101', title: '间谍过家家', year: 2022, type: '动漫' },
        { mediaId: 'mg102', title: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { mediaId: 'mg103', title: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['mg102'],
    },
    {
      Source: createCountingSource(MiguSource, id => [{ name: '第1集', pID: `${id}-p1` }]),
      candidates: [
        { url: 'https://migu.test/101', epsId: 'mi101', name: '间谍过家家', year: 2022, type: '动漫' },
        { url: 'https://migu.test/102', epsId: 'mi102', name: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { url: 'https://migu.test/103', epsId: 'mi103', name: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['https://migu.test/102'],
    },
    {
      Source: createCountingSource(SohuSource, id => [{ title: '第1集', url: `https://tv.sohu.com/v/${id}.html` }]),
      candidates: [
        { mediaId: 'sh101', title: '间谍过家家', year: 2022, type: '动漫' },
        { mediaId: 'sh102', title: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { mediaId: 'sh103', title: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['sh102'],
    },
    {
      Source: createCountingSource(LeshiSource, id => [{ title: '第1集', url: `https://www.le.com/ptv/vplay/${id}.html` }]),
      candidates: [
        { mediaId: 'ls101', title: '间谍过家家', year: 2022, type: '动漫' },
        { mediaId: 'ls102', title: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { mediaId: 'ls103', title: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['ls102'],
    },
    {
      Source: createCountingSource(XiguaSource, id => [{ title: '第1集', url: `https://www.ixigua.com/${id}/1` }]),
      candidates: [
        { url: 'https://www.ixigua.com/album/xg101', name: '间谍过家家', year: 2022, type: '动漫' },
        { url: 'https://www.ixigua.com/album/xg102', name: '间谍过家家 第二季', year: 2023, type: '动漫' },
        { url: 'https://www.ixigua.com/album/xg103', name: '间谍过家家 第三季', year: 2025, type: '动漫' },
      ],
      expected: ['xg102'],
    },
  ];

  for (const item of cases) {
    const source = new item.Source();
    await source.handleAnimes(item.candidates, '间谍过家家', [], options);
    assert.deepEqual(source.detailIds, item.expected, `${source.constructor.name} should prefilter target season`);
  }
});

class CountingEzdmwSource extends EzdmwSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getBangumiDetail(id) {
    this.detailIds.push(id);
    return {
      title: '间谍过家家 第二季',
      year: '2023',
      typeDescription: 'TV动画',
      startDate: '2023-01-01',
      episodes: [{ name: '第1集', url: `${id}-ep1` }],
    };
  }
}

class CountingHanjutvSource extends HanjutvSource {
  constructor() {
    super();
    this.detailIds = [];
  }

  async buildAnimePayload(anime) {
    const id = String(anime.sid || anime.tvSid || anime.animeId);
    this.detailIds.push(id);
    return {
      summary: {
        animeId: Number(anime.animeId || 1),
        bangumiId: id,
        animeTitle: `${anime.name}(2023)【韩剧】from hanjutv`,
        type: '韩剧',
        typeDescription: '韩剧',
        imageUrl: '',
        startDate: '2023-01-01',
        episodeCount: 1,
        rating: 0,
        isFavorited: true,
        source: 'hanjutv',
      },
      links: [{ name: '1', url: `${id}-ep1`, title: '【hanjutv】 第1集' }],
    };
  }
}

class CountingKan360Source extends Kan360Source {
  constructor() {
    super();
    this.detailIds = [];
  }

  async getEpisodesV2(cat, detailId, siteKey) {
    this.detailIds.push(detailId);
    return [{ name: '1', url: `https://360.test/${siteKey}/${detailId}/1` }];
  }
}

function makeCustomEpisodes(id) {
  return [{ episodeTitle: '第1集', episodeNumber: 1, episodeId: Number(String(id).replace(/\D/g, '') || 1) }];
}

function makePlainEpisodes(id) {
  return [{ title: '第1集', episodeId: `${id}-ep1`, link: `${id}-ep1`, videoId: `${id}-v1`, durationMillis: 240000 }];
}

test('Batch C sources should request/materialize details only for target season when explicit target candidates exist', async () => {
  resetRuntime();
  const options = { detailStore: new Map(), querySeason: 2 };

  const vod = new VodSource();
  const vodCurAnimes = [];
  await vod.handleAnimes([
    { vod_id: '101', vod_name: '间谍过家家', vod_pic: '', type_name: '动漫', vod_year: '2022', vod_play_from: 'qq', vod_play_url: '第1集$https://v.qq.com/vod101' },
    { vod_id: '102', vod_name: '间谍过家家 第二季', vod_pic: '', type_name: '动漫', vod_year: '2023', vod_play_from: 'qq', vod_play_url: '第1集$https://v.qq.com/vod102' },
    { vod_id: '103', vod_name: '间谍过家家 第三季', vod_pic: '', type_name: '动漫', vod_year: '2025', vod_play_from: 'qq', vod_play_url: '第1集$https://v.qq.com/vod103' },
  ], '间谍过家家', vodCurAnimes, 'Server-A', options);
  assert.equal(vodCurAnimes.length, 1, 'VodSource should materialize only target season');
  assert.match(vodCurAnimes[0].animeTitle, /第二季/);

  const cases = [
    {
      Source: createCountingSource(CustomSource, makeCustomEpisodes),
      args: [[
        { animeId: 101, bangumiId: 101, animeTitle: '间谍过家家', startDate: '2022-01-01', type: 'tvseries', typeDescription: 'TV动画', imageUrl: '', rating: 0 },
        { animeId: 102, bangumiId: 102, animeTitle: '间谍过家家 第二季', startDate: '2023-01-01', type: 'tvseries', typeDescription: 'TV动画', imageUrl: '', rating: 0 },
        { animeId: 103, bangumiId: 103, animeTitle: '间谍过家家 第三季', startDate: '2025-01-01', type: 'tvseries', typeDescription: 'TV动画', imageUrl: '', rating: 0 },
      ], '间谍过家家', [], options],
      expected: [102],
    },
    {
      Source: createCountingSource(AcfunSource, makePlainEpisodes),
      args: [[
        { bangumiId: 'ac101', title: '间谍过家家', year: 2022, type: '番剧' },
        { bangumiId: 'ac102', title: '间谍过家家 第二季', year: 2023, type: '番剧' },
        { bangumiId: 'ac103', title: '间谍过家家 第三季', year: 2025, type: '番剧' },
      ], '间谍过家家', [], options],
      expected: ['ac102'],
    },
    {
      Source: CountingEzdmwSource,
      args: [[
        { id: 'ez101', title: '间谍过家家', startDate: '2022-01-01' },
        { id: 'ez102', title: '间谍过家家 第二季', startDate: '2023-01-01' },
        { id: 'ez103', title: '间谍过家家 第三季', startDate: '2025-01-01' },
      ], '间谍过家家', [], options],
      expected: ['ez102'],
    },
    {
      Source: CountingHanjutvSource,
      args: [[
        { sid: 'hj101', animeId: 101, name: '间谍过家家', category: '韩剧' },
        { sid: 'hj102', animeId: 102, name: '间谍过家家 第二季', category: '韩剧' },
        { sid: 'hj103', animeId: 103, name: '间谍过家家 第三季', category: '韩剧' },
      ], '间谍过家家', [], options],
      expected: ['hj102'],
    },
    {
      Source: createCountingSource(RenrenSource, id => [{ episodeIndex: 1, episodeId: `${id}-ep1`, provider: 'rr', title: '第1集' }]),
      args: [[
        { mediaId: 'rr101', title: '间谍过家家', year: 2022, type: '动漫', imageUrl: '' },
        { mediaId: 'rr102', title: '间谍过家家 第二季', year: 2023, type: '动漫', imageUrl: '' },
        { mediaId: 'rr103', title: '间谍过家家 第三季', year: 2025, type: '动漫', imageUrl: '' },
      ], '间谍过家家', [], options],
      expected: ['rr102'],
    },
    {
      Source: CountingKan360Source,
      args: [[
        { titleTxt: '间谍过家家', title: '间谍过家家', cat_name: '动漫', en_id: 'k101', year: 2022, playlinks: { qq: 'https://v.qq.com/k101' } },
        { titleTxt: '间谍过家家 第二季', title: '间谍过家家 第二季', cat_name: '动漫', en_id: 'k102', year: 2023, playlinks: { qq: 'https://v.qq.com/k102' } },
        { titleTxt: '间谍过家家 第三季', title: '间谍过家家 第三季', cat_name: '动漫', en_id: 'k103', year: 2025, playlinks: { qq: 'https://v.qq.com/k103' } },
      ], '间谍过家家', [], options],
      expected: ['k102'],
    },
    {
      Source: createCountingSource(MaiduiduiSource, id => [{ title: '第1集', episodeId: `${id}-ep1` }]),
      args: [[
        { url: 'md101', name: '间谍过家家', year: 2022, type: '动漫', img: '' },
        { url: 'md102', name: '间谍过家家 第二季', year: 2023, type: '动漫', img: '' },
        { url: 'md103', name: '间谍过家家 第三季', year: 2025, type: '动漫', img: '' },
      ], '间谍过家家', [], options],
      expected: ['md102'],
    },
    {
      Source: createCountingSource(AiyifanSource, id => [{ title: '第1集', link: `https://www.iyf.tv/play/${id}/1` }]),
      args: [[
        { mediaId: 'ay101', title: '间谍过家家', year: 2022, type: '动漫', imageUrl: '' },
        { mediaId: 'ay102', title: '间谍过家家 第二季', year: 2023, type: '动漫', imageUrl: '' },
        { mediaId: 'ay103', title: '间谍过家家 第三季', year: 2025, type: '动漫', imageUrl: '' },
      ], '间谍过家家', [], options],
      expected: ['ay102'],
    },
  ];

  for (const item of cases) {
    const source = new item.Source();
    await source.handleAnimes(...item.args);
    assert.deepEqual(source.detailIds, item.expected, `${source.constructor.name} should prefilter target season`);
  }

  const douban = new DoubanSource();
  const doubanSettled = await douban.handleAnimes([
    { layout: 'movie', target_id: 'db101', target: { title: '间谍过家家' }, type_name: '电视剧' },
    { layout: 'movie', target_id: 'db102', target: { title: '间谍过家家 第二季' }, type_name: '电视剧' },
    { layout: 'movie', target_id: 'db103', target: { title: '间谍过家家 第三季' }, type_name: '电视剧' },
  ], '间谍过家家', [], options);
  assert.equal(doubanSettled.length, 1, 'Douban should prefilter candidates before materialization');
});
