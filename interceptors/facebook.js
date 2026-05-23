/**
 * interceptor_facebook.js — MAIN WORLD
 *
 * Intercepts Facebook's GraphQL API responses (fetch + XHR) to extract
 * video and photo URLs from feeds, profiles, watch, and reels.
 *
 * Facebook sends newline-delimited JSON (multiple objects per response).
 * We parse each line separately and deep-scan for known CDN URL shapes.
 *
 * Dispatches '__xmd_found__' CustomEvent on document with:
 *   { videoItems: {url,date}[], photoItems: {url,date}[] }
 *
 * content.js (ISOLATED world) listens for this event.
 */
(function () {
  'use strict';

  function resolveUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return '';
    if (rawUrl.startsWith('http')) return rawUrl;
    if (rawUrl.startsWith('//')) return location.protocol + rawUrl;
    if (rawUrl.startsWith('/')) return location.origin + rawUrl;
    return rawUrl;
  }

  function isFBEndpoint(rawUrl) {
    const url = resolveUrl(rawUrl);
    return (
      url.includes('/api/graphql') ||
      url.includes('/graphql') ||
      url.includes('graph.facebook.com/')
    );
  }

  /** True for any fbcdn.net CDN URL (Facebook + Instagram shared CDN) */
  function isFBCDN(url) {
    return typeof url === 'string' && url.includes('.fbcdn.net/');
  }

  const seenVideos = new Set();
  const seenPhotos = new Set();

  /**
   * Scan ALL string values in the response tree for fbcdn.net URLs.
   * Classify by hostname:
   *   video-*.fbcdn.net  → video
   *   scontent-*.fbcdn.net / external-*.fbcdn.net → photo
   * This is format-agnostic and survives Facebook's JSON structure changes.
   */
  function scanStrings(val, videoItems, photoItems, depth) {
    if (depth > 25 || val == null) return;
    if (typeof val === 'string') {
      if (!val.startsWith('https://') || !val.includes('.fbcdn.net/')) return;
      try { new URL(val); } catch (_) { return; } // must be valid URL
      const host = new URL(val).hostname;
      if (host.startsWith('video-')) {
        if (!seenVideos.has(val)) { seenVideos.add(val); videoItems.push({ url: val, date: null }); }
      } else if (host.startsWith('scontent') || host.startsWith('external') || host.startsWith('z-p')) {
        // also check playable_url / playable_url_quality_hd patterns on scontent hosts
        if (!seenPhotos.has(val)) { seenPhotos.add(val); photoItems.push({ url: val, date: null }); }
      }
      // Also catch video URLs that may be on scontent hosts but have .mp4 extension
      if (val.includes('.mp4') && !seenVideos.has(val)) {
        seenPhotos.delete(val); // remove from photos if added
        seenVideos.add(val);
        // move to videoItems (replace photo entry if any)
        const pi = photoItems.findIndex(p => p.url === val);
        if (pi !== -1) { const [item] = photoItems.splice(pi, 1); videoItems.push(item); }
        else videoItems.push({ url: val, date: null });
      }
      return;
    }
    if (typeof val !== 'object') return;
    const entries = Array.isArray(val) ? val : Object.values(val);
    for (const child of entries) scanStrings(child, videoItems, photoItems, depth + 1);
  }

  function processObj(obj) {
    const videoItems = [], photoItems = [];
    scanStrings(obj, videoItems, photoItems, 0);
    if (videoItems.length || photoItems.length) {
      document.dispatchEvent(
        new CustomEvent('__xmd_found__', { detail: { videoItems, photoItems } })
      );
    }
  }

  /**
   * Facebook GraphQL responses are newline-delimited JSON.
   * Each line may be prefixed with "for(;;);" (anti-hijack token).
   * Parse each line separately after stripping that prefix.
   */
  function stripFBPrefix(s) {
    return s.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, '').trim();
  }

  function parseAndProcess(text) {
    for (const line of text.split('\n')) {
      const s = stripFBPrefix(line.trim());
      if (!s || s[0] !== '{' && s[0] !== '[') continue;
      try { processObj(JSON.parse(s)); } catch (_) {}
    }
  }

  // ── Patch window.fetch ─────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const rawUrl = typeof input === 'string' ? input : (input?.url ?? '');
    const response = await _fetch(input, init);
    if (isFBEndpoint(rawUrl)) {
      response.clone().text().then(parseAndProcess).catch(() => {});
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
    if (isFBEndpoint(this.__xmdUrl)) {
      this.addEventListener('load', () => {
        try { parseAndProcess(this.responseText); } catch (_) {}
      });
    }
    return _send.apply(this, arguments);
  };
})();
