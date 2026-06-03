import test from 'node:test';
import assert from 'node:assert/strict';
import AnimekoSource from './sources/animeko.js';
import { Globals } from './configs/globals.js';

function resetRuntime(env = {}) {
  Globals.init({ LOG_LEVEL: 'error', MAX_ANIMES: '1000', ...env });
  Globals.deployPlatform = '';
}

test('Animeko Bangumi search uses built-in mirror first and keeps direct fallback', () => {
  resetRuntime();
  const source = new AnimekoSource();
  const urls = source._getSearchRequestUrls('https://api.bgm.tv/v0/search/subjects?limit=20&offset=0');

  assert.deepEqual(urls, [
    'https://api.bangumi.one/v0/search/subjects?limit=20&offset=0',
    'https://api.bgm.tv/v0/search/subjects?limit=20&offset=0',
  ]);
});

test('Animeko Bangumi search honors configured animeko@ proxy before direct fallback', () => {
  resetRuntime({ PROXY_URL: 'animeko@https://mirror.example.test/base' });
  const source = new AnimekoSource();
  const urls = source._getSearchRequestUrls('https://api.bgm.tv/v0/search/subjects?limit=20&offset=0');

  assert.deepEqual(urls, [
    'https://mirror.example.test/base/v0/search/subjects?limit=20&offset=0',
    'https://api.bgm.tv/v0/search/subjects?limit=20&offset=0',
  ]);
});

test('Animeko V2 subject requests honor configured animeko@ proxy', () => {
  resetRuntime({ PROXY_URL: 'animeko@https://mirror.example.test/base' });
  const source = new AnimekoSource();

  assert.equal(
    source._getAnimekoRequestUrl('https://s1.animeko.openani.org/v2/subjects/400602'),
    'https://mirror.example.test/base/v2/subjects/400602'
  );
});

test('Animeko danmaku myani requests honor configured animeko@ proxy', () => {
  resetRuntime({ PROXY_URL: 'animeko@https://mirror.example.test/base' });
  const source = new AnimekoSource();

  assert.equal(
    source._getAnimekoRequestUrl('https://danmaku-cn.myani.org/v1/danmaku/1227087'),
    'https://mirror.example.test/base/v1/danmaku/1227087'
  );
});

test('Animeko filterSearchResults matches infobox 中文名 value', () => {
  resetRuntime();
  const source = new AnimekoSource();
  const results = source.filterSearchResults([
    {
      id: 1,
      name: 'Some Japanese Title',
      name_cn: '',
      infobox: [
        { key: '中文名', value: '镜像中文名测试' },
      ],
    },
  ], '镜像中文名测试');

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 1);
});

test('Animeko Bangumi V0 fallback proxy encodes the complete endpoint URL', () => {
  resetRuntime({ PROXY_URL: 'http://proxy.example.test' });
  Globals.deployPlatform = 'node';
  const source = new AnimekoSource();
  const targetUrl = 'https://api.bgm.tv/v0/episodes?subject_id=400602&limit=200&offset=0';
  const urls = source._getBangumiV0RequestUrls(targetUrl);

  assert.equal(new URL(urls[0]).searchParams.get('url'), targetUrl);
  assert.equal(urls[1], 'https://api.bangumi.one/v0/episodes?subject_id=400602&limit=200&offset=0');
  assert.equal(urls[2], targetUrl);
});

test('Animeko subject fetch falls back to Bangumi V0 when all V2 nodes fail', async () => {
  resetRuntime();

  class V0FallbackSource extends AnimekoSource {
    constructor() {
      super();
      this.v2Calls = [];
      this.v0Calls = [];
    }

    _getAnimekoServerPriority() {
      return ['https://v2-a.example.test', 'https://v2-b.example.test'];
    }

    async _fetchAnimekoV2SubjectFromServer(hostUrl, subjectId) {
      this.v2Calls.push(`${hostUrl}:${subjectId}`);
      return null;
    }

    async _fetchBangumiV0Subject(subjectId) {
      this.v0Calls.push(subjectId);
      return {
        id: subjectId,
        episodes: [
          { episodeId: 1001, sort: 1, ep: 1, type: 'MAIN', name: 'Episode 1', nameCn: '第一话', airdate: '2023-09-29' },
        ],
        relations: [
          { id: 400603, name: '续作', relation: '续集' },
        ],
      };
    }
  }

  const source = new V0FallbackSource();
  const data = await source._fetchAnimekoSubject(490001);

  assert.deepEqual(source.v2Calls, [
    'https://v2-a.example.test:490001',
    'https://v2-b.example.test:490001',
  ]);
  assert.deepEqual(source.v0Calls, [490001]);
  assert.equal(data.episodes[0].episodeId, 1001);
  assert.equal(data.relations[0].id, 400603);
});

test('Animeko Bangumi V0 subject fallback rejects relation-only responses', async () => {
  resetRuntime();

  class RelationOnlySource extends AnimekoSource {
    async _fetchV0AllEpisodes() {
      return { ok: false, episodes: [] };
    }

    async _fetchV0Relations() {
      return { ok: true, relations: [{ id: 400603, relation: '续集' }] };
    }
  }

  const source = new RelationOnlySource();
  const data = await source._fetchBangumiV0Subject(490002);

  assert.equal(data, null);
});

test('Animeko search response validation requires a Bangumi data array', () => {
  resetRuntime();
  const source = new AnimekoSource();

  assert.equal(source._isBangumiSearchResponseValid({ data: { data: [] } }), true);
  assert.equal(source._isBangumiSearchResponseValid({ data: '<html>not json</html>' }), false);
  assert.equal(source._isBangumiSearchResponseValid({ data: { error: 'bad gateway' } }), false);
});

test('Animeko structured relations include main story ids once', () => {
  resetRuntime();
  const source = new AnimekoSource();
  const relations = source._extractRelations({
    relations: {
      sequelSubjects: [400603],
      seriesMainSubjectIds: [400602, 400603],
    },
  });

  assert.deepEqual(relations, [
    { id: 400603, name: '', relation: '续集' },
    { id: 400602, name: '', relation: '主线故事' },
  ]);
});
