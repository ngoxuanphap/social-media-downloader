/**
 * interceptor_tiktok.js — MAIN WORLD
 *
 * Intercepts TikTok's API responses (fetch + XHR) to extract video URLs
 * from user profiles, feeds, search results, and explore pages.
 *
 * Dispatches '__xmd_found__' CustomEvent on document with:
 *   { videoItems: {url,date}[], photoItems: [] }
 *   date = 'yyyymmdd' (UTC) derived from item.createTime (Unix timestamp)
 *
 * content.js (ISOLATED world) listens for this event.
 */
(function () {
  'use strict';

  // TikTok API endpoints that return video item lists
  const TIKTOK_ENDPOINTS = [
    '/api/post/item_list',
    '/api/recommend/item_list',
    '/api/user/post',
    '/api/video/feed',
    '/api/search/item',
    '/api/explore/item_list',
    '/aweme/v1/feed',
    '/aweme/v1/aweme/post',
  ];

  function isTikTokEndpoint(url) {
    if (typeof url !== 'string') return false;
    return TIKTOK_ENDPOINTS.some(ep => url.includes(ep));
  }

  function parseDate(createTime) {
    if (!createTime) return null;
    try {
      const d = new Date(Number(createTime) * 1000);
      if (isNaN(d)) return null;
      const y  = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}${mo}${dy}`;
    } catch (_) { return null; }
  }

  const seenVideos = new Set();

  function tryParseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  /**
   * Extract video URL from a TikTok item.
   * Tries multiple field paths across API versions.
   */
  function extractItem(item) {
    if (!item || typeof item !== 'object') return null;
    const date = parseDate(item.createTime || item.create_time);

    const video = item.video || {};
    const urlCandidates = [
      video.play_addr?.url_list?.[0],
      video.download_addr?.url_list?.[0],
      typeof video.playAddr     === 'string' ? video.playAddr     : null,
      typeof video.downloadAddr === 'string' ? video.downloadAddr : null,
      ...(Array.isArray(video.bitrateInfo)
        ? video.bitrateInfo.map(b => b?.PlayAddr?.UrlList?.[0]).filter(Boolean)
        : []),
      video.play_addr?.url_list?.[1],
      video.download_addr?.url_list?.[1],
    ].filter(u => typeof u === 'string' && u.startsWith('http'));

    for (const url of urlCandidates) {
      if (!seenVideos.has(url)) {
        seenVideos.add(url);
        return { url, date };
      }
    }
    return null;
  }

  /**
   * Recursively walk the parsed response tree.
   * Extracts any object that has a (createTime|create_time) + video field.
   * This handles any nesting depth and any API response wrapper shape.
   */
  function findItems(obj, videoItems, depth) {
    if (depth > 12 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const child of obj) findItems(child, videoItems, depth + 1);
      return;
    }
    if ((obj.createTime || obj.create_time) && obj.video) {
      const v = extractItem(obj);
      if (v) videoItems.push(v);
      return;
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') findItems(val, videoItems, depth + 1);
    }
  }

  function processData(data) {
    try {
      const videoItems = [];
      findItems(data, videoItems, 0);
      if (videoItems.length) {
        document.dispatchEvent(
          new CustomEvent('__xmd_found__', { detail: { videoItems, photoItems: [] } })
        );
      }
    } catch (_) {}
  }

  // ── Patch window.fetch ─────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    const response = await _fetch(input, init);
    if (isTikTokEndpoint(url)) {
      response.clone().text().then(text => {
        const data = tryParseJson(text);
        if (data) processData(data);
      }).catch(() => {});
    }
    return response;
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xmdUrl = String(url || '');
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (isTikTokEndpoint(this.__xmdUrl)) {
      this.addEventListener('load', () => {
        const data = tryParseJson(this.responseText);
        if (data) processData(data);
      });
    }
    return _send.apply(this, arguments);
  };
})();
