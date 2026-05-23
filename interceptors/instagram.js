/**
 * interceptor_instagram.js — MAIN WORLD
 *
 * Intercepts Instagram's API responses (fetch + XHR) to extract
 * the highest-quality video and photo URLs from posts, reels, stories.
 *
 * Dispatches '__xmd_found__' CustomEvent on document with:
 *   { videoItems: {url,date}[], photoItems: {url,date}[] }
 *   date = 'yyyymmdd' (UTC) derived from item.taken_at (Unix timestamp)
 *
 * content.js (ISOLATED world) listens for this event.
 */
(function () {
  'use strict';

  // Resolve relative URLs → always produce an absolute URL string
  function resolveUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return '';
    if (rawUrl.startsWith('http')) return rawUrl;
    if (rawUrl.startsWith('//')) return location.protocol + rawUrl;
    if (rawUrl.startsWith('/')) return location.origin + rawUrl;
    return rawUrl;
  }

  function isInstaEndpoint(rawUrl) {
    const url = resolveUrl(rawUrl);
    return (
      url.includes('/api/v1/') ||
      url.includes('/api/graphql') ||
      url.includes('/graphql/query') ||
      (url.includes('i.instagram.com') && url.includes('/api/'))
    );
  }

  function parseDate(takenAt) {
    if (!takenAt) return null;
    try {
      const d = new Date(Number(takenAt) * 1000);
      if (isNaN(d)) return null;
      const y  = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}${mo}${dy}`;
    } catch (_) { return null; }
  }

  function isCdnUrl(url) {
    return typeof url === 'string' && (
      /^https:\/\/[a-z0-9.-]+\.cdninstagram\.com\//.test(url) ||
      url.includes('.fbcdn.net/')
    );
  }

  const seenVideos = new Set();
  const seenPhotos = new Set();

  /**
   * Extract a single media item (post, reel, story frame).
   * Instagram item shape:
   *   { taken_at, video_versions: [{width, url}], image_versions2: {candidates:[{url}]}, carousel_media:[] }
   */
  function extractItem(item, videoItems, photoItems) {
    if (!item || typeof item !== 'object') return;
    // Support both Unix seconds fields
    const date = parseDate(item.taken_at || item.taken_at_timestamp);

    // ── Video: pick highest-width from video_versions ──────────────────
    const versions = item.video_versions;
    if (Array.isArray(versions) && versions.length > 0) {
      const best = versions.reduce(
        (a, b) => ((b.width || 0) > (a.width || 0) ? b : a),
        versions[0]
      );
      const url = best.url;
      if (isCdnUrl(url) && !seenVideos.has(url)) {
        seenVideos.add(url);
        // Thumbnail: image_versions2.candidates — pick smallest (last) candidate
        const imgCands = item.image_versions2?.candidates;
        const thumbUrl = Array.isArray(imgCands) && imgCands.length
          ? imgCands[imgCands.length - 1].url
          : null;
        const thumb = isCdnUrl(thumbUrl) ? thumbUrl : null;
        videoItems.push({ url, date, thumb });
      }
    }

    // ── Video: old GraphQL shape uses video_url ───────────────────────
    if (!item.video_versions && typeof item.video_url === 'string' && isCdnUrl(item.video_url)) {
      if (!seenVideos.has(item.video_url)) {
        seenVideos.add(item.video_url);
        const rawThumb = item.thumbnail_url || item.display_url || null;
        const thumb = isCdnUrl(rawThumb) ? rawThumb : null;
        videoItems.push({ url: item.video_url, date, thumb });
      }
    }

    // ── Photo: first candidate = highest resolution ────────────────────
    const candidates = item.image_versions2?.candidates;
    if (!item.video_versions && !item.video_url && Array.isArray(candidates) && candidates.length > 0) {
      const url = candidates[0].url;
      if (isCdnUrl(url) && !seenPhotos.has(url)) {
        seenPhotos.add(url);
        photoItems.push({ url, date });
      }
    }
    // Old GraphQL shape: display_url for photos
    if (!item.video_versions && !item.video_url && typeof item.display_url === 'string' && isCdnUrl(item.display_url)) {
      if (!seenPhotos.has(item.display_url)) {
        seenPhotos.add(item.display_url);
        photoItems.push({ url: item.display_url, date });
      }
    }

    // ── Carousel (multi-image/video post) ─────────────────────────────
    const carousel = item.carousel_media || item.edge_sidecar_to_children?.edges;
    if (Array.isArray(carousel)) {
      for (const media of carousel) {
        // GraphQL edges wrap in { node: ... }
        extractItem(media.node || media, videoItems, photoItems);
      }
    }
  }

  /**
   * Walk the entire parsed response tree recursively.
   * Extracts any object that looks like an Instagram media item.
   */
  function walk(obj, videoItems, photoItems, depth) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const child of obj) walk(child, videoItems, photoItems, depth + 1);
      return;
    }

    // If this looks like a media item, extract and stop recursing into it
    if (
      obj.taken_at !== undefined || obj.taken_at_timestamp !== undefined ||
      obj.video_versions !== undefined || obj.image_versions2 !== undefined ||
      obj.video_url !== undefined || obj.display_url !== undefined
    ) {
      extractItem(obj, videoItems, photoItems);
      return;
    }

    // Recurse into ALL object keys (handles xdt_api__v1__... and other dynamic keys)
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') {
        walk(val, videoItems, photoItems, depth + 1);
      }
    }
  }

  function processData(data) {
    try {
      const videoItems = [], photoItems = [];
      walk(data, videoItems, photoItems, 0);
      if (videoItems.length || photoItems.length) {
        document.dispatchEvent(
          new CustomEvent('__xmd_found__', { detail: { videoItems, photoItems } })
        );
      }
    } catch (_) {}
  }

  // ── Parse a text body as JSON (handles text/plain responses too) ────────
  function tryParseJson(text) {
    if (!text) return null;
    // Strip leading "for(;;);" or "])}while(1);" anti-hijack prefixes
    const clean = text.replace(/^[)\]}'"]*for\s*\(\s*;\s*;\s*\)\s*;/, '')
                       .replace(/^while\s*\(\s*1\s*\)\s*;/, '')
                       .trim();
    try { return JSON.parse(clean); } catch (_) { return null; }
  }

  // ── Patch window.fetch ─────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input?.url ?? '');
    const response = await _fetch(input, init);
    if (isInstaEndpoint(rawUrl)) {
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
    if (isInstaEndpoint(this.__xmdUrl)) {
      this.addEventListener('load', () => {
        const data = tryParseJson(this.responseText);
        if (data) processData(data);
      });
    }
    return _send.apply(this, arguments);
  };

  // ── Scan page-embedded JSON (Instagram pre-loads data in <script> tags) ─
  function scanEmbeddedData() {
    document.querySelectorAll(
      'script[type="application/json"], script[type="application/ld+json"]'
    ).forEach(el => {
      const data = tryParseJson(el.textContent);
      if (data) processData(data);
    });
  }

  // ── Hook Instagram's SPA data loader ─────────────────────────────────
  function hookDataLoader() {
    // __additionalDataLoaded(path, data) is called for SPA page transitions
    const orig = window.__additionalDataLoaded;
    window.__additionalDataLoaded = function (path, data) {
      try { if (data) processData(data); } catch (_) {}
      if (typeof orig === 'function') return orig.apply(this, arguments);
    };
    // __dispatchCustomEvent fires events with media data
    const origDCE = window.__dispatchCustomEvent;
    window.__dispatchCustomEvent = function (name, data) {
      try { if (data) processData(data); } catch (_) {}
      if (typeof origDCE === 'function') return origDCE.apply(this, arguments);
    };
  }

  hookDataLoader();

  // Scan after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbeddedData, { once: true });
  } else {
    scanEmbeddedData();
  }
})();
