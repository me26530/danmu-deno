import BaseSource from './base.js';
import { log } from "../utils/log-util.js";
import { getDoubanInfoByImdbId } from "../utils/douban-util.js";
import { getTmdbExternalIds, searchTmdbTitles} from "../utils/tmdb-util.js";
import { getImdbepisodes, getImdbSeasons } from "../utils/imdb-util.js";
import { globals } from '../configs/globals.js';
import { mapWithConcurrency, resolveSourceConcurrency } from '../utils/concurrency-util.js';

// =====================
// 获取TMDB源播放链接
// =====================
export default class TmdbSource extends BaseSource {
  constructor(doubanSource) {
    super('BaseSource');
    this.doubanSource = doubanSource;
  }

  async _getDoubanInfo(finalImdbId, mediaType) {
    if (!finalImdbId) return null;
    const doubanInfo = await getDoubanInfoByImdbId(finalImdbId);
    if (!doubanInfo || !doubanInfo?.data) return null;
    const url = doubanInfo?.data?.id; // "https://api.douban.com/movie/1299131"
    if (url) {
      const parts = url.split("/"); // ["https:", "", "api.douban.com", "movie", "1299131"]
      const doubanId = parts.pop(); // 最后一个就是 ID
      const typeName = mediaType === 'movie' ? '电影' : '电视剧';
      if (doubanId) {
        return {
          layout: "subject", target_id: doubanId, type_name: typeName,
          target: {cover_url: doubanInfo.data?.image, title: doubanInfo.data?.alt_title}
        };
      }
    }
    return null;
  }

  async getDoubanIdByTmdbId(mediaType, tmdbId) {
    try {
      const doubanIds = [];

      const response = await getTmdbExternalIds(mediaType, tmdbId);

      const imdbId = response.data?.imdb_id;

      if (!imdbId) return [];

      if (mediaType === 'movie') {
        const doubanInfo = await this._getDoubanInfo(imdbId, mediaType);
        if (doubanInfo) doubanIds.push(doubanInfo);
      } else {
        const seasons = await getImdbSeasons(imdbId);
        log("info", "imdb seasons:", seasons.data.seasons);

        const seasonDoubanInfos = await mapWithConcurrency(
          seasons?.data?.seasons ?? [],
          resolveSourceConcurrency('tmdb', globals),
          async (season) => {
          let finalImdbId = imdbId;
          log("info", "imdb season:", season.season);

          try {
            if (Number(season.season) !== 1) {
              const episodes = await getImdbepisodes(imdbId, season.season);
              finalImdbId = episodes.data?.episodes.find((ep) => ep.episodeNumber === 1)?.id ?? "";
            }

            return await this._getDoubanInfo(finalImdbId, mediaType);
          } catch (error) {
            log("error", `处理第 ${season.season} 季失败，继续执行其他季:`, error);
            return null;
          }
          }
        );
        doubanIds.push(...seasonDoubanInfos.filter(Boolean));
      }

      return doubanIds;
    } catch (error) {
      log("error", "getTmdbIds error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  async search(keyword) {
    try {
      const response = await searchTmdbTitles(keyword);

      const data = response.data;

      let tmpAnimes = [];

      let tmdbItems = [];
      if (data?.results?.length > 0) {
        tmdbItems = data.results.filter(item => (item.name || item.title) === keyword);
      }

      log("info", `tmdb items.length: ${tmdbItems.length}`);

      const doubanResults = await mapWithConcurrency(
        tmdbItems,
        resolveSourceConcurrency('tmdb', globals),
        async (tmdbItem) => {
        try {
          const doubanIds = await this.getDoubanIdByTmdbId(tmdbItem.media_type, tmdbItem.id);
          return doubanIds;
        } catch (error) {
          log("error", `获取 TMDB ID ${tmdbItem.id} 的豆瓣 ID 失败，继续处理其他条目:`, error);
          return []; // 失败返回空数组，不中断合并
        }
        }
      );
      tmpAnimes = [...tmpAnimes, ...doubanResults.flat()];

      return tmpAnimes;
    } catch (error) {
      log("error", "getTmdbAnimes error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  async getEpisodes(id) {}

  async handleAnimes(sourceAnimes, queryTitle, curAnimes, options = {}, legacyDetailStore = null) {
    const handleOptions = legacyDetailStore instanceof Map
      ? { ...(options && !(options instanceof Map) ? options : {}), detailStore: legacyDetailStore }
      : options instanceof Map
        ? { detailStore: options }
        : (options || {});
    return this.doubanSource.handleAnimes(sourceAnimes, queryTitle, curAnimes, handleOptions);
  }

  async getEpisodeDanmu(id) {}

  formatComments(comments) {}
}