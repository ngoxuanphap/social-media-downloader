/**
 * interceptor.js — MAIN WORLD
 *
 * Patches window.fetch and XMLHttpRequest to intercept X/Twitter's
 * GraphQL API responses and extract the highest-bitrate MP4 video URLs
 * as well as full-resolution photo URLs.
 *
 * Dispatches a CustomEvent ('__xmd_found__') on document with:
 *   { videoItems: {url,date}[], photoItems: {url,date}[] }
 *   date = 'yyyymmdd' of the tweet's posting date (UTC), or null
 *
 * content.js (ISOLATED world) listens for this event — CustomEvents on
 * document are shared across both worlds.
 */
(function () {
  'use strict';

  // GraphQL endpoint names that carry tweet media
  const MEDIA_ENDPOINTS = [
    'TweetDetail',
    'HomeTimeline',
    'UserTweets',
    'UserTweetsAndReplies',
    'SearchTimeline',
    'Likes',
    'Bookmarks',
    'ListLatestTweetsTimeline',
    'TweetResultByRestId',
    'FavoritedByTimeline',
    'RetweetedByTimeline',
    'UserMedia',
    'UserHighlightsTweets',
    'TweetDetailBundle',
  ];

  function isMediaEndpoint(url) {
    if (typeof url !== 'string') return false;
    if (!url.includes('/graphql/')) return false;
    return MEDIA_ENDPOINTS.some(ep => url.includes(ep));
  }

  /**
   * Parse Twitter's created_at string → 'yyyymmdd' (UTC).
   * Input: "Mon May 20 15:30:00 +0000 2024"
   */
  function parseTweetDate(str) {
    if (!str) return null;
    try {
      const d = new Date(str);
      if (isNaN(d)) return null;
      const y  = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}${mo}${dy}`;
    } catch (_) { return null; }
  }

  /**
   * Walk a parsed JSON object and extract:
   *   - highest-bitrate MP4 URL from every video_info.variants block
   *   - original photo URL from every media item with type === 'photo'
   * tweetDate is propagated from parent objects that have legacy.created_at
   */
  function extractMedia(obj, seenVideos, seenPhotos, tweetDate) {
    if (!seenVideos) seenVideos = new Set();
    if (!seenPhotos) seenPhotos = new Set();

    const videoItems = [];
    const photoItems = [];

    if (!obj || typeof obj !== 'object') return { videoItems, photoItems };

    // Capture tweet date from legacy.created_at and propagate to descendants
    const date = (obj.legacy?.created_at
      ? parseTweetDate(obj.legacy.created_at)
      : null) || tweetDate || null;
    if (obj.video_info && Array.isArray(obj.video_info.variants)) {
      const mp4 = obj.video_info.variants.filter(
        v =>
          v.content_type === 'video/mp4' &&
          typeof v.bitrate === 'number' &&
          typeof v.url === 'string' &&
          v.url.startsWith('https://video.twimg.com/')
      );
      if (mp4.length > 0) {
        mp4.sort((a, b) => b.bitrate - a.bitrate);
        const best = mp4[0].url;
        if (!seenVideos.has(best)) {
          seenVideos.add(best);
          // media_url_https on the same object is the video poster / thumbnail
          const thumb = typeof obj.media_url_https === 'string' &&
                        obj.media_url_https.startsWith('https://pbs.twimg.com/')
            ? obj.media_url_https.replace(/\?.*$/, '') + '?format=jpg&name=thumb'
            : null;
          videoItems.push({ url: best, date, thumb });
        }
      }
    }

    // ── Photos ─────────────────────────────────────────────────────────
    if (
      obj.type === 'photo' &&
      typeof obj.media_url_https === 'string' &&
      obj.media_url_https.startsWith('https://pbs.twimg.com/')
    ) {
      const origUrl = obj.media_url_https.replace(/\?.*$/, '') + '?format=jpg&name=orig';
      if (!seenPhotos.has(origUrl)) {
        seenPhotos.add(origUrl);
        photoItems.push({ url: origUrl, date });
      }
    }

    // ── Recurse ────────────────────────────────────────────────────────
    const children = Array.isArray(obj) ? obj : Object.values(obj);
    for (const child of children) {
      if (child && typeof child === 'object') {
        const r = extractMedia(child, seenVideos, seenPhotos, date);
        for (const item of r.videoItems) videoItems.push(item);
        for (const item of r.photoItems) photoItems.push(item);
      }
    }

    return { videoItems, photoItems };
  }

  /** Dispatch found items to content.js via shared DOM CustomEvent */
  function dispatch(videoItems, photoItems) {
    if (!videoItems.length && !photoItems.length) return;
    document.dispatchEvent(
      new CustomEvent('__xmd_found__', { detail: { videoItems, photoItems } })
    );
  }

  function processData(data) {
    try {
      const { videoItems, photoItems } = extractMedia(data);
      dispatch(videoItems, photoItems);
    } catch (_) {}
  }

  // ── Patch window.fetch ─────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    const response = await _fetch(input, init);
    if (isMediaEndpoint(url)) {
      response.clone().json().then(processData).catch(() => {});
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
    if (isMediaEndpoint(this.__xmdUrl)) {
      this.addEventListener('load', () => {
        try { processData(JSON.parse(this.responseText)); } catch (_) {}
      });
    }
    return _send.apply(this, arguments);
  };
})();
