import BaseSource from './base.js';
import { globals } from '../configs/globals.js';
import { log } from "../utils/log-util.js";
import { httpGet, httpPost } from "../utils/http-util.js";
import { addAnime, removeEarliestAnime } from "../utils/cache-util.js";
import { simplized } from "../utils/zh-util.js";
import { SegmentListResponse } from '../models/dandan-model.js';
import { preferSeasonCandidatesIfPresent, resolveQuerySeason, titleMatches } from "../utils/common-util.js";
import { searchBangumiData } from '../utils/bangumi-data-util.js';
import { mapWithConcurrency, resolveSourceConcurrency } from '../utils/concurrency-util.js';

// =====================
// 获取Animeko弹幕（https://github.com/open-ani/animeko）
// =====================

// 接口健康状态缓存 (全局共享，跨请求持久化，实现业务级智能路由)
// 根据部署时区动态确定节点优先级，并记录当前健康的节点 URL
const API_HEALTH = {
  danmu: null,
  subject: null
};

// Animeko 详情数据短效缓存
const SUBJECT_CACHE = new Map();
const SUBJECT_CACHE_TTL = 3 * 60 * 1000; // 缓存有效期：3 分钟 (180000 毫秒)
const SUBJECT_CACHE_MAX_SIZE = 100; // 最大缓存条目数

// 内置 Bangumi API 反代镜像；用于 Animeko 的 Bangumi 搜索接口和 Bangumi V0 详情兜底；Animeko V2 详情/弹幕接口在显式配置 PROXY_URL 时同样支持 animeko@ 专用反代。
const BANGUMI_V0_BASE = 'https://api.bgm.tv';
const BUILTIN_BANGUMI_V0_MIRROR = 'https://api.bangumi.one';

/**
 * Animeko 源适配器 (基于 Bangumi API 搜索 + Animeko API 详情)
 * 提供深度元数据搜索、结果过滤及条目关系检测功能
 */
export default class AnimekoSource extends BaseSource {

  /**
   * 获取标准 HTTP 请求头
   * @returns {Object} 请求头对象
   */
  get headers() {
    return {
      "Content-Type": "application/json",
      "User-Agent": `huangxd-/danmu_api/${globals.version}(https://github.com/huangxd-/danmu_api)`,
    };
  }

  /**
   * 将 Bangumi 官方 V0 URL 改写到内置镜像，保留路径与 query。
   * @param {string} targetUrl Bangumi 官方接口完整 URL
   * @returns {string|null} 镜像 URL，构造失败时返回 null
   */
  _getBuiltInBangumiMirrorUrl(targetUrl) {
    try {
      const targetObj = new URL(targetUrl);
      const mirrorObj = new URL(BUILTIN_BANGUMI_V0_MIRROR);
      targetObj.protocol = mirrorObj.protocol;
      targetObj.host = mirrorObj.host;
      if (mirrorObj.pathname !== '/') {
        targetObj.pathname = mirrorObj.pathname.replace(/\/$/, '') + targetObj.pathname;
      }
      return targetObj.toString();
    } catch {
      return null;
    }
  }

  /**
   * 为 Bangumi API 搜索请求应用代理。
   * 优先使用用户 PROXY_URL；未配置时使用内置镜像，并保留直连作为兜底。
   */
  _getSearchRequestUrls(targetUrl) {
    const urls = [];
    const configuredUrl = globals.makeProxyUrl(targetUrl);
    if (configuredUrl && configuredUrl !== targetUrl) {
      urls.push(configuredUrl);
    } else {
      const mirrorUrl = this._getBuiltInBangumiMirrorUrl(targetUrl);
      if (mirrorUrl) urls.push(mirrorUrl);
    }

    if (!urls.includes(targetUrl)) {
      urls.push(targetUrl);
    }

    return urls;
  }

  /**
   * 为 Bangumi V0 详情兜底接口生成请求 URL。
   * 注意：必须先构造完整 endpoint，再应用代理，避免正向代理 query 被截断。
   * @param {string} targetUrl Bangumi 官方接口完整 URL
   * @returns {Array<string>} 请求 URL 队列
   */
  _getBangumiV0RequestUrls(targetUrl) {
    const urls = [];
    const configuredUrl = globals.makeProxyUrl(targetUrl);
    if (configuredUrl && configuredUrl !== targetUrl) {
      urls.push(configuredUrl);
    }

    const mirrorUrl = this._getBuiltInBangumiMirrorUrl(targetUrl);
    if (mirrorUrl && !urls.includes(mirrorUrl)) {
      urls.push(mirrorUrl);
    }

    if (!urls.includes(targetUrl)) {
      urls.push(targetUrl);
    }

    return urls;
  }

  /**
   * 校验 Bangumi 搜索响应结构，避免镜像返回 malformed 数据时误判为成功。
   * @param {Object|null} resp HTTP 响应
   * @returns {boolean}
   */
  _isBangumiSearchResponseValid(resp) {
    return !!(resp && resp.data && Array.isArray(resp.data.data));
  }

  /**
   * 为 Animeko V2 详情/弹幕请求应用用户配置的代理。
   * 这些接口没有内置镜像；未命中 PROXY_URL 时保持原始节点 URL 以继续按健康状态降级。
   * @param {string} targetUrl Animeko 原始接口 URL
   * @returns {string} 代理后的 URL 或原始 URL
   */
  _getAnimekoRequestUrl(targetUrl) {
    return globals.makeProxyUrl(targetUrl) || targetUrl;
  }

  /**
   * 动态获取基于部署时区的 Animeko 节点优先级列表 (完全反转官方逻辑)
   * @returns {Array<string>} 节点 URL 数组
   */
  _getAnimekoServerPriority() {
    // 获取当前运行环境的时区偏移 (分钟)，UTC+8 为 -480
    const isUTC8 = new Date().getTimezoneOffset() === -480;

    if (isUTC8) {
      // 原中国时区 (UTC+8) 优先级: api.animeko.org, danmaku-global.myani.org, danmaku-cn.myani.org, s1.animeko.openani.org
      // 完全反转后优先级:
      return [
        "https://s1.animeko.openani.org",
        "https://danmaku-cn.myani.org",
        "https://danmaku-global.myani.org",
        "https://api.animeko.org"
      ];
    } else {
      // 原其他时区优先级: danmaku-global.myani.org, api.animeko.org, s1.animeko.openani.org, danmaku-cn.myani.org
      // 完全反转后优先级:
      return [
        "https://danmaku-cn.myani.org",
        "https://s1.animeko.openani.org",
        "https://api.animeko.org",
        "https://danmaku-global.myani.org"
      ];
    }
  }

  /**
   * 将成功的 Animeko 详情数据写入短效缓存。
   * @param {number} subjectId 条目 ID
   * @param {Object} data 详情数据
   */
  _cacheSubjectData(subjectId, data) {
    SUBJECT_CACHE.set(subjectId, {
      data,
      timestamp: Date.now()
    });

    if (SUBJECT_CACHE.size > SUBJECT_CACHE_MAX_SIZE) {
      const firstKey = SUBJECT_CACHE.keys().next().value;
      SUBJECT_CACHE.delete(firstKey);
    }
  }

  /**
   * 通过单个 Animeko V2 节点获取条目详情。
   * @param {string} hostUrl Animeko 节点 URL
   * @param {number} subjectId 条目 ID
   * @returns {Promise<Object|null>}
   */
  async _fetchAnimekoV2SubjectFromServer(hostUrl, subjectId) {
    const targetUrl = `${hostUrl}/v2/subjects/${subjectId}`;
    const requestUrl = this._getAnimekoRequestUrl(targetUrl);

    log("info", `[Animeko] Animeko API 请求节点: ${hostUrl} (${subjectId})`);
    const resp = await httpGet(requestUrl, {
      headers: this.headers,
      timeout: 3000 // 限制节点请求超时时间为 3000 毫秒，加速故障节点跳过与轮询降级
    });

    if (resp && resp.data && resp.data.id) {
      return resp.data;
    }
    return null;
  }

  /**
   * 通过 Bangumi V0 请求队列拉取 JSON，并按调用方校验响应结构。
   * @param {string} targetUrl Bangumi 官方接口完整 URL
   * @param {Object} options 请求选项
   * @param {Function} options.validate 响应校验函数
   * @param {string} options.label 日志标签
   * @param {number} options.timeout 超时时间
   * @returns {Promise<{ok: boolean, data: any}>}
   */
  async _fetchBangumiV0Json(targetUrl, { validate, label, timeout = 3000 }) {
    const requestUrls = this._getBangumiV0RequestUrls(targetUrl);
    for (const requestUrl of requestUrls) {
      try {
        const resp = await httpGet(requestUrl, {
          headers: this.headers,
          timeout
        });

        if (validate(resp)) {
          return { ok: true, data: resp.data };
        }
        log("warn", `[Animeko] ${label} 节点返回无效数据: ${requestUrl}`);
      } catch (error) {
        log("warn", `[Animeko] ${label} 节点请求失败: ${requestUrl} - ${error.message}`);
      }
    }

    return { ok: false, data: null };
  }

  /**
   * 获取 Bangumi V0 剧集列表完整数据。
   * Bangumi API 限制单次 limit=200，需循环获取完整列表以适配长篇番剧。
   * @param {number} subjectId 条目 ID
   * @returns {Promise<{ok: boolean, episodes: Array}>}
   */
  async _fetchV0AllEpisodes(subjectId) {
    let allEpisodes = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const targetUrl = `${BANGUMI_V0_BASE}/v0/episodes?subject_id=${subjectId}&limit=${limit}&offset=${offset}`;
      const result = await this._fetchBangumiV0Json(targetUrl, {
        label: `V0剧集(${subjectId}, offset=${offset})`,
        timeout: 3000,
        validate: resp => !!(resp && resp.data && Array.isArray(resp.data.data))
      });

      if (!result.ok) {
        return { ok: false, episodes: allEpisodes };
      }

      const currentBatch = result.data.data;
      if (currentBatch.length === 0) {
        break;
      }

      allEpisodes = allEpisodes.concat(currentBatch);

      if (currentBatch.length < limit) {
        break;
      }

      offset += limit;
      if (offset > 1600) {
        log("warn", `[Animeko] ID:${subjectId} 剧集数量超过安全限制(1600)，停止翻页`);
        break;
      }
    }

    return { ok: true, episodes: allEpisodes };
  }

  /**
   * 获取 Bangumi V0 关联条目。
   * @param {number} subjectId 条目 ID
   * @returns {Promise<{ok: boolean, relations: Array}>}
   */
  async _fetchV0Relations(subjectId) {
    const targetUrl = `${BANGUMI_V0_BASE}/v0/subjects/${subjectId}/subjects`;
    const result = await this._fetchBangumiV0Json(targetUrl, {
      label: `V0关联(${subjectId})`,
      timeout: 3000,
      validate: resp => !!(resp && Array.isArray(resp.data))
    });

    return {
      ok: result.ok,
      relations: result.ok ? result.data : []
    };
  }

  /**
   * 通过 Bangumi V0 端点构造 Animeko V2-like 详情数据。
   * 只有剧集接口成功才视为完整 fallback，避免 relation-only 数据污染详情缓存。
   * @param {number} subjectId 条目 ID
   * @returns {Promise<Object|null>}
   */
  async _fetchBangumiV0Subject(subjectId) {
    const [episodesResult, relationsResult] = await Promise.all([
      this._fetchV0AllEpisodes(subjectId),
      this._fetchV0Relations(subjectId)
    ]);

    if (!episodesResult || !episodesResult.ok) {
      log("warn", `[Animeko] Bangumi V0 fallback 未获得可用剧集数据: ${subjectId}`);
      return null;
    }

    const resultData = {
      id: subjectId,
      episodes: episodesResult.episodes.map(ep => ({
        episodeId: ep.id,
        sort: ep.sort,
        ep: ep.ep,
        type: ep.type === 0 ? 'MAIN' : (ep.type === 1 ? 'SP' : String(ep.type)),
        name: ep.name || '',
        nameCn: ep.name_cn || '',
        airdate: ep.airdate || ''
      }))
    };

    if (relationsResult && relationsResult.ok && Array.isArray(relationsResult.relations)) {
      resultData.relations = relationsResult.relations;
    }

    return resultData;
  }

  /**
   * 通过 Animeko API 获取条目详情（含剧集与关联数据，智能路由降级）
   * 使用短效缓存策略兼顾请求去重与动态数据(剧集)的时效性
   * @param {number} subjectId 条目 ID
   * @returns {Promise<Object|null>}
   */
  async _fetchAnimekoSubject(subjectId) {
    // 检查缓存是否存在且在有效期内
    const cached = SUBJECT_CACHE.get(subjectId);
    if (cached && (Date.now() - cached.timestamp < SUBJECT_CACHE_TTL)) {
      return cached.data;
    }

    const servers = this._getAnimekoServerPriority();

    let currentHost = API_HEALTH.subject;
    if (!currentHost || !servers.includes(currentHost)) {
      currentHost = servers[0];
      API_HEALTH.subject = servers[0];
    }

    let startIndex = servers.indexOf(currentHost);
    if (startIndex === -1) startIndex = 0;

    for (let i = 0; i < servers.length; i++) {
      const hostIndex = (startIndex + i) % servers.length;
      const hostUrl = servers[hostIndex];

      try {
        const data = await this._fetchAnimekoV2SubjectFromServer(hostUrl, subjectId);
        if (data) {
          if (API_HEALTH.subject !== hostUrl) {
            log("info", `[Animeko] Animeko API 详情节点健康状态更新: ${API_HEALTH.subject} -> ${hostUrl}`);
            API_HEALTH.subject = hostUrl;
          }

          this._cacheSubjectData(subjectId, data);
          return data;
        }
        log("warn", `[Animeko] Animeko API 节点 ${hostUrl} 返回无效数据`);
      } catch (error) {
        log("warn", `[Animeko] Animeko API 节点请求失败: ${hostUrl} - ${error.message}`);
      }
    }

    const fallbackData = await this._fetchBangumiV0Subject(subjectId);
    if (fallbackData) {
      log("info", `[Animeko] Animeko V2 全部失败，已使用 Bangumi V0 详情兜底: ${subjectId}`);
      this._cacheSubjectData(subjectId, fallbackData);
      return fallbackData;
    }

    // 所有节点均失败，重置至优先级最高的首选节点
    log("warn", `[Animeko] Animeko API 与 Bangumi V0 详情兜底均失败，重置至首选节点`);
    API_HEALTH.subject = servers[0];
    return null;
  }

  /**
   * 搜索动画条目
   * 使用 Bangumi V0 POST 接口进行搜索，支持偏移翻页、结果过滤及关系检测
   * @param {string} keyword 搜索关键词
   * @returns {Promise<Array>} 转换后的搜索结果列表
   */
  async search(keyword) {
    if (globals.useBangumiData) {
      const localMatches = await searchBangumiData(keyword, ['bangumi']);
      if (localMatches.length > 0) {
        log("info", `[Animeko] Bangumi-Data 本地命中 ${localMatches.length} 条数据`);
        const mapped = localMatches.map(m => {
          const displayTitle = m.titles.find(t => t && t.includes(keyword)) || m.titles[1] || m.title;
          const finalTitle = displayTitle + (m.titleSuffix || '');

          return {
            id: parseInt(m.siteId),
            name: m.title,
            name_cn: finalTitle,
            imageUrl: m.imageUrl || m.images?.common || m.images?.large || '',
            date: m.begin,
            startDate: m.begin,
            episodeCount: Number(m.eps || m.total_episodes || 0),
            score: 0,
            platform: m.typeStr,
            aliases: [...m.titles]
          };
        });

        // 本地匹配结果同样执行关系检测
        if (mapped.length > 1) {
          const withRelations = await this.checkRelationsAndModifyTitles(mapped);
          log("info", `[Animeko] 搜索完成（Bangumi-Data + 关系检测），共找到 ${withRelations.length} 个有效结果`);
          return this.transformResults(withRelations);
        }

        return this.transformResults(mapped);
      }
    }

    try {
      // 标准化函数
      const searchKeyword = keyword.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
      log("info", `[Animeko] 开始搜索 (V0): ${searchKeyword}`);

      let allFilteredResults = [];
      let offset = 0;
      const limit = 20;

      while (true) {
        const searchUrl = `https://api.bgm.tv/v0/search/subjects?limit=${limit}&offset=${offset}`;
        const searchUrls = this._getSearchRequestUrls(searchUrl);

        const payload = {
          keyword: searchKeyword,
          filter: {
            type: [2] // 2 代表动画类型
          }
        };

        let resp = null;
        for (const requestUrl of searchUrls) {
          try {
            resp = await httpPost(requestUrl, JSON.stringify(payload), {
              headers: this.headers,
              timeout: 5000
            });
            if (this._isBangumiSearchResponseValid(resp)) break;
            log("warn", `[Animeko] Bangumi 搜索节点返回无效数据: ${requestUrl}`);
          } catch (error) {
            log("warn", `[Animeko] Bangumi 搜索节点失败: ${requestUrl} - ${error.message}`);
          }
        }

        if (!this._isBangumiSearchResponseValid(resp)) {
          log("info", `[Animeko] 搜索请求失败或无有效数据返回 (offset: ${offset})`);
          break;
        }

        const currentBatch = resp.data.data;

        if (currentBatch.length === 0) {
          break;
        }

        // 执行结果相关度过滤 (剔除强大的模糊搜索带来的杂项)
        const filteredBatch = this.filterSearchResults(currentBatch, keyword);

        if (filteredBatch.length > 0) {
          allFilteredResults = allFilteredResults.concat(filteredBatch);
        }

        // 核心分页判断逻辑：根据原始批次数量判断是否还有下一页，不能用过滤后数量提前截断。
        if (currentBatch.length < limit) {
          log("info", `[Animeko] 当前批次返回 ${currentBatch.length} 个结果，停止翻页`);
          break;
        }

        offset += limit;

        // 安全熔断：限制最大翻页次数（例如获取前 60 条）防止特殊情况下的无意义消耗
        if (offset >= 60) {
          log("warn", `[Animeko] 搜索翻页达到安全上限(60)，强制停止`);
          break;
        }
      }

      if (allFilteredResults.length === 0) {
        log("info", "[Animeko] 过滤后无匹配结果");
        return [];
      }

      // 跨页合并后，为了防止多页触发同样的"智能季度匹配兜底"导致重复，这里做一次 ID 去重
      let uniqueResults = Array.from(new Map(allFilteredResults.map(item => [item.id, item])).values());

      // 检测条目间关系 (如处理续篇、剧场版等层级关系)
      if (uniqueResults.length > 1) {
        uniqueResults = await this.checkRelationsAndModifyTitles(uniqueResults);
      }

      log("info", `[Animeko] 搜索完成，共找到 ${uniqueResults.length} 个有效结果`);
      return this.transformResults(uniqueResults);
    } catch (error) {
      log("error", "[Animeko] Search error:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * 过滤搜索结果
   * 利用公共方法对主标题和别名进行匹配校验
   * @param {Array} list 原始 API 返回结果列表
   * @param {string} keyword 用户搜索关键词
   * @returns {Array} 过滤后的结果列表
   */
  filterSearchResults(list, keyword) {
    return list.filter(item => {
      const titles = [item.name, item.name_cn];

      // 提取 Bangumi API infobox 中的别名和中文名扩充对比池
      if (item.infobox && Array.isArray(item.infobox)) {
        item.infobox.forEach(info => {
          if (info.key === '别名' && Array.isArray(info.value)) {
            info.value.forEach(v => { if (v && v.v) titles.push(v.v); });
          }
          if (info.key === '中文名' && typeof info.value === 'string') {
            titles.push(info.value);
          }
        });
      }

      // 只要主标题、中文名或任一别名符合匹配条件，即保留该条目
      return titles.some(t => t && titleMatches(t, keyword));
    });
  }

  /**
   * 检查标题是否包含明确的季度或类型标识
   * @param {string} title 标题文本
   * @returns {boolean} 是否包含明确标识
   */
  hasExplicitSeasonInfo(title) {
    if (!title) return false;

    const pattern = /第?\s*(?:\d+|[一二三四五六七八九十]+)\s*[季期部]|Season\s*\d+|S\d+|Part\s*\d+|Act\s*\d+|Phase\s*\d+|The\s+Final\s+Season|OVA|OAD|剧场版|劇場版|Movie|Film|续[篇集]|外传|SP|(?<!\d)\d+$|\S+[篇章]/i

    return pattern.test(title);
  }

  /**
   * 批量检查条目关系并修正标题（使用 Animeko API 的 relations 数据）
   * 对于检测到的续作或衍生关系，在标题后追加标识
   * @param {Array} list 条目列表
   * @returns {Promise<Array>} 修正后的列表
   */
  async checkRelationsAndModifyTitles(list) {
    const checkLimit = Math.min(list.length, 3);

    for (let i = 0; i < checkLimit; i++) {
      for (let j = 0; j < checkLimit; j++) {
        if (i === j) continue;

        const subjectA = list[i];
        const subjectB = list[j];
        const nameA = subjectA.name_cn || subjectA.name;
        const nameB = subjectB.name_cn || subjectB.name;

        // 简单的包含关系预检
        if (nameB.includes(nameA) && nameB.length > nameA.length) {

          // 如果标题已有明确区分，跳过耗时的 API 检查
          if (this.hasExplicitSeasonInfo(nameB)) {
            continue;
          }

          // 使用 Animeko API 获取关联数据
          const v2Data = await this._fetchAnimekoSubject(subjectA.id);
          const relations = this._extractRelations(v2Data);
          const relationInfo = relations.find(r => r.id === subjectB.id);

          if (relationInfo) {
            log("info", `[Animeko] 检测到关系: [${nameA}] -> ${relationInfo.relation} -> [${nameB}]`);

            const targetRelations = ["续集", "番外篇", "主线故事", "前传", "不同演绎", "衍生"];

            if (targetRelations.includes(relationInfo.relation)) {
               let mark = relationInfo.relation;
               if (mark === '续集') mark = '续篇'; // 归一化处理

               subjectB._relation_mark = `(${mark})`;
            }
          }
        }
      }
    }
    return list;
  }

  /**
   * 从 Animeko API 响应中提取关联条目
   * @param {Object|null} v2Data 动画详情数据
   * @returns {Array} 关联条目数组
   */
  _extractRelations(v2Data) {
    if (!v2Data || !v2Data.relations) return [];

    const rel = v2Data.relations;

    // 处理数组格式的关联数据
    if (Array.isArray(rel)) {
      return rel.filter(item => item.type === 2).map(item => ({
        id: item.id,
        name: item.name_cn || item.name,
        relation: item.relation
      }));
    }

    // 处理结构化对象的关联数据，仅解析条目标识符
    const results = [];
    const seen = new Set();

    const mapRelations = (idArray, relationType) => {
      if (Array.isArray(idArray)) {
        idArray.forEach(id => {
          if (!id || seen.has(id)) return;
          seen.add(id);
          results.push({ id: id, name: '', relation: relationType });
        });
      }
    };

    mapRelations(rel.sequelSubjects, '续集');
    mapRelations(rel.prequelSubjects, '前传');
    mapRelations(rel.sideStorySubjects, '番外篇');
    mapRelations(rel.alternativeSettingSubjects, '不同演绎');
    mapRelations(rel.characterSubjects, '衍生');
    mapRelations(rel.seriesMainSubjectIds, '主线故事');

    return results;
  }

  /**
   * 从 Animeko API 模板化 infobox 中提取指定键值
   * @param {Object} infobox
   * @param {string} targetKey
   * @returns {string|null}
   */
  _extractInfoboxValue(infobox, targetKey) {
    if (!infobox || !infobox.fields || !Array.isArray(infobox.fields)) return null;
    const field = infobox.fields.find(f => f.key === targetKey);
    if (field && field.values && field.values.length > 0) {
      return field.values[0].v || null;
    }
    return null;
  }

  _ExtractInfoboxAliases(infobox) {
    const aliases = [];
    if (!infobox || !infobox.fields || !Array.isArray(infobox.fields)) return aliases;
    infobox.fields.forEach(field => {
      if (field.key === '别名' && Array.isArray(field.values)) {
        field.values.forEach(v => { if (v && v.v && !aliases.includes(v.v)) aliases.push(v.v); });
      }
    });
    return aliases;
  }

  /**
   * 将 API 结果转换为统一的数据格式
   * @param {Array} results API 原始结果
   * @returns {Array} 转换后的数据
   */
  transformResults(results) {
    return results.map(item => {
      let typeDesc = "动漫";
      if (item.platform) {
        switch (item.platform) {
          case "TV": case 1: typeDesc = "TV动画"; break;
          case "Web": typeDesc = "Web动画"; break;
          case "OVA": typeDesc = "OVA"; break;
          case "Movie": typeDesc = "剧场版"; break;
          default: typeDesc = typeof item.platform === 'number' ? "TV动画" : item.platform;
        }
      }

      // 识别 3D 与 2D 标签并追加至类型描述
      let is3D = false;
      let is2D = false;
      if (item.tags && Array.isArray(item.tags)) {
          item.tags.forEach(tag => {
              const tagName = tag.name || tag;
              if (tagName === '3D') is3D = true;
              if (tagName === '2D') is2D = true;
          });
      }
      if (is3D) typeDesc = "3D" + typeDesc;
      else if (is2D) typeDesc = "2D" + typeDesc;

      const titleSuffix = item._relation_mark ? ` ${item._relation_mark}` : "";

      // 提取别名列表 (用于合并工具进行模糊匹配)
      const aliases = Array.isArray(item.aliases) ? [...item.aliases] : [];

      // Animeko API infobox 为模板结构，Bangumi V0 为扁平结构，统一处理
      if (item.infobox) {
        if (Array.isArray(item.infobox)) {
          // Bangumi V0 扁平格式
          item.infobox.forEach(info => {
            if (info.key === '别名' && Array.isArray(info.value)) {
              info.value.forEach(v => {
                if (v && v.v && !aliases.includes(v.v)) aliases.push(v.v);
              });
            }
          });
        } else if (item.infobox.fields) {
          // Animeko API 模板格式
          const boxAliases = this._ExtractInfoboxAliases(item.infobox);
          boxAliases.forEach(a => { if (!aliases.includes(a)) aliases.push(a); });
        }
      }

      // 将中文名也作为别名的一种补充
      if (item.name_cn && item.name_cn !== item.name) {
          aliases.push(item.name_cn);
      }
      // Animeko API 使用 nameCn 字段
      if (item.nameCn && item.nameCn !== item.name) {
          if (!aliases.includes(item.nameCn)) aliases.push(item.nameCn);
      }

      // 统一日期字段（Animeko API 用 airDate，Bangumi V0 用 date）
      const airDate = item.airDate || item.date || "";

      return {
        id: item.id,
        name: item.name,
        name_cn: (item.name_cn || item.nameCn || item.name) + titleSuffix,
        aliases: aliases,
        images: item.images,
        imageUrl: item.imageUrl || item.cover || (item.images ? (item.images.common || item.images.large || item.images.medium || item.images.small || '') : ''),
        air_date: airDate,
        startDate: airDate,
        episodeCount: Number(item.eps || item.total_episodes || item.episodeCount || 0),
        score: item.score ? parseFloat(item.score) : 0,
        typeDescription: typeDesc
      };
    });
  }

  /**
   * 获取剧集列表（通过 Animeko API，含主备降级）
   * @param {number} subjectId 条目 ID
   * @returns {Promise<Array>} 剧集数组
   */
  async getEpisodes(subjectId) {
    try {
      const v2Data = await this._fetchAnimekoSubject(subjectId);
      if (!v2Data || !v2Data.episodes || !Array.isArray(v2Data.episodes)) {
        if (v2Data) log("info", `[Animeko] Subject ${subjectId} 无剧集数据 (Animeko API)`);
        return [];
      }

      return v2Data.episodes.map(ep => ({
        id: ep.episodeId,
        sort: parseInt(ep.sort) || 0,
        ep: ep.ep,
        type: ep.type === 'MAIN' ? 0 : (ep.type === 'SP' ? 1 : ep.type),
        name: ep.name || "",
        name_cn: ep.nameCn || "",
        airdate: ep.airdate || ""
      }));

    } catch (error) {
      log("error", "[Animeko] GetEpisodes error:", {
        message: error.message,
        id: subjectId
      });
      return [];
    }
  }

  /**
   * 处理搜索结果
   * @param {Array} sourceAnimes 原始数据
   * @param {string} queryTitle 关键词
   * @param {Array} curAnimes 结果池
   * @param {Map} detailStore 详情缓存
   * @param {number|null} querySeason 目标季度
   */
  async handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore = null) {
    const tmpAnimes = [];

    if (!sourceAnimes || !Array.isArray(sourceAnimes)) {
      if (sourceAnimes) log("error", "[Animeko] sourceAnimes is not a valid array");
      return [];
    }

    // 提取搜索词中的明确季度信息；优先使用调度层传入的 SearchContext。
    const querySeason = resolveQuerySeason(queryTitle, detailStore);
    const filteredAnimes = preferSeasonCandidatesIfPresent(
      sourceAnimes,
      querySeason,
      anime => anime.name_cn || anime.name || ''
    );

    if (filteredAnimes !== sourceAnimes) {
      log("info", `[Animeko] 结果已命中目标季(第${querySeason}季)，跳过非目标季相关请求`);
    }

    const processedPayloads = await mapWithConcurrency(
      filteredAnimes,
      resolveSourceConcurrency('animeko', globals),
      async (anime) => {
        try {
          const eps = await this.getEpisodes(anime.id);
          let links = [];

          let effectiveStartDate = anime.air_date || anime.startDate || "";

          if (Array.isArray(eps)) {
            eps.sort((a, b) => (a.sort || 0) - (b.sort || 0));

            for (const ep of eps) {
              if (ep.type !== 0) continue; // 仅保留本篇

              if (!effectiveStartDate && ep.airdate) {
                effectiveStartDate = ep.airdate;
              }

              const epNum = ep.sort || ep.ep;
              const epName = ep.name_cn || ep.name || "";
              const fullTitle = `第${epNum}话 ${epName}`.trim();

              links.push({
                "name": `${epNum}`,
                "url": ep.id.toString(),
                "title": `【animeko】 ${fullTitle}`
              });
            }
          }

          if (links.length === 0) return null;

          const yearStr = effectiveStartDate ? new Date(effectiveStartDate).getFullYear() : "";
          const transformedAnime = {
            animeId: anime.id,
            bangumiId: String(anime.id),
            animeTitle: `${anime.name_cn || anime.name}(${yearStr})【${anime.typeDescription || '动漫'}】from animeko`,
            aliases: anime.aliases || [],
            type: "动漫",
            typeDescription: anime.typeDescription || "动漫",
            imageUrl: anime.imageUrl || (anime.images ? (anime.images.common || anime.images.large || anime.images.medium || anime.images.small || '') : ""),
            startDate: effectiveStartDate,
            episodeCount: links.length,
            rating: anime.score || 0,
            isFavorited: true,
            source: "animeko",
          };

          return { anime: transformedAnime, links };
        } catch (error) {
          log("error", `[Animeko] Error processing anime ${anime.id}: ${error.message}`);
          return null;
        }
      }
    );

    for (const payload of processedPayloads) {
      if (!payload) continue;
      tmpAnimes.push(payload.anime);
      addAnime({...payload.anime, links: payload.links}, detailStore);
      if (globals.animes.length > globals.MAX_ANIMES) removeEarliestAnime();
    }

    this.sortAndPushAnimesByYear(tmpAnimes, curAnimes);
    return processedPayloads;
  }

  /**
   * 获取完整弹幕列表
   * 采用与详情一致的独立健康检查轮询机制与动态时区优先级
   * @param {string} episodeId 剧集 ID 或 完整 API URL
   * @returns {Promise<Array>} 弹幕数组
   */
  async getEpisodeDanmu(episodeId) {
    // 1. 提取真实 ID
    // 兼容分片请求传递过来的完整 URL 或 纯 ID
    let realId = String(episodeId).trim();

    if (realId.includes('/')) {
      const parts = realId.split('/');
      realId = parts[parts.length - 1];
    }

    if (realId.includes('?')) {
      realId = realId.split('?')[0];
    }

    if (!realId) {
      log("error", "[Animeko] 无效的 episodeId");
      return [];
    }

    const servers = this._getAnimekoServerPriority();

    let currentHost = API_HEALTH.danmu;
    if (!currentHost || !servers.includes(currentHost)) {
      currentHost = servers[0];
      API_HEALTH.danmu = servers[0];
    }

    let startIndex = servers.indexOf(currentHost);
    if (startIndex === -1) startIndex = 0;

    for (let i = 0; i < servers.length; i++) {
        const hostIndex = (startIndex + i) % servers.length;
        const hostUrl = servers[hostIndex];
        const targetUrl = `${hostUrl}/v1/danmaku/${realId}`;
        const requestUrl = this._getAnimekoRequestUrl(targetUrl);

        log("info", `[Animeko] 尝试使用 ${hostUrl} 节点获取弹幕`);

        try {
            const resp = await httpGet(requestUrl, {
              headers: this.headers,
              timeout: 3000 // 限制节点请求超时时间为 3000 毫秒，加速故障节点跳过与轮询降级
            });

            if (resp && resp.data) {
                const danmuList = resp.data.danmakuList;
                if (danmuList && Array.isArray(danmuList)) {
                    if (API_HEALTH.danmu !== hostUrl) {
                        log("info", `[Animeko] 弹幕域节点健康状态更新: ${API_HEALTH.danmu} -> ${hostUrl}`);
                        API_HEALTH.danmu = hostUrl;
                    }
                    log("info", `[Animeko] 成功获取弹幕，共 ${danmuList.length} 条 (${hostUrl}节点)`);
                    return danmuList;
                }
            }
            log("info", `[Animeko] ${hostUrl} 节点获取失败/无数据，触发降级`);
        } catch (error) {
            log("warn", `[Animeko] 请求节点失败: ${hostUrl} - ${error.message}`);
        }
    }

    // 所有节点轮换完毕仍未获取到数据，重置健康状态至首选节点
    log("info", `[Animeko] 弹幕域所有降级节点均失败，重置健康状态至首选节点`);
    API_HEALTH.danmu = servers[0];

    return [];
  }

  /**
   * 获取分段弹幕列表定义
   * 使用完整的 API URL 填充 url 字段，以通过 format 校验
   */
  async getEpisodeDanmuSegments(id) {
    return new SegmentListResponse({
      "type": "animeko",
      "segmentList": [{
        "type": "animeko",
        "segment_start": 0,
        "segment_end": 30000,
        "url": String(id)
      }]
    });
  }

  /**
   * 获取具体分片的弹幕数据
   * 标准实现：返回原始数据，格式化交由父类统一处理
   */
  async getEpisodeSegmentDanmu(segment) {
    // 增加 trim 防止 URL 意外空格
    const url = (segment.url || '').trim();
    if (!url) return [];

    // 返回原始数据，格式化交由父类统一处理
    return this.getEpisodeDanmu(url);
  }

  /**
   * 格式化弹幕为标准格式
   * @param {Array} comments 原始弹幕数据
   * @returns {Array} 格式化后的弹幕
   */
  formatComments(comments) {
    if (!Array.isArray(comments)) return [];
    const locationMap = { "NORMAL": 1, "TOP": 5, "BOTTOM": 4 };

    return comments
      .filter(item => item && item.danmakuInfo)
      .map(item => {
        const info = item.danmakuInfo;
        const time = (Number(info.playTime) / 1000).toFixed(2);
        const mode = locationMap[info.location] || 1;
        const color = info.color === -1 ? 16777215 : info.color;
        const text = globals.danmuSimplifiedTraditional === 'simplified' ? simplized(info.text) : info.text;

        return {
          cid: item.id,
          p: `${time},${mode},${color},[animeko]`,
          m: text
        };
      });
  }
}
