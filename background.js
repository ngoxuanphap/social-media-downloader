'use strict';

// JSZip must be imported at the top level of the service worker
importScripts('jszip.min.js');

// ── Inject Referer headers for all CDN downloads (declarativeNetRequest) ────
// chrome.downloads.download() cannot set Referer via JS (forbidden header);
// declarativeNetRequest operates at the network layer and can set it.
const DNR_RULES = [
  { id: 9001, urlFilter: '||tiktok.com',       referer: 'https://www.tiktok.com/'   },
  { id: 9002, urlFilter: '||tiktokcdn.com',    referer: 'https://www.tiktok.com/'   },
  { id: 9003, urlFilter: '||tiktokv.com',      referer: 'https://www.tiktok.com/'   },
  { id: 9004, urlFilter: '||cdninstagram.com', referer: 'https://www.instagram.com/' },
  { id: 9005, urlFilter: '||fbcdn.net',        referer: 'https://www.facebook.com/' },
];

(async () => {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: DNR_RULES.map(r => r.id),
      addRules: DNR_RULES.map(r => ({
        id: r.id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          // Inject correct Referer so CDN accepts the request
          requestHeaders: [{ header: 'Referer', operation: 'set', value: r.referer }],
          // Override CORS response headers so service worker fetch() can read the body.
          // TikTok/Instagram/Facebook CDN returns ACAO for their own origins;
          // setting ACAO:* and removing ACAC lets the extension origin through.
          responseHeaders: [
            { header: 'Access-Control-Allow-Origin',      operation: 'set',    value: '*' },
            { header: 'Access-Control-Allow-Credentials', operation: 'remove'             },
          ],
        },
        condition: {
          urlFilter: r.urlFilter,
          // No resourceTypes filter → rule fires for ALL request types,
          // including service worker fetch() which isn't classified as
          // xmlhttprequest/media/etc. in the DNR resource type enum.
        },
      })),
    });
  } catch (e) {
    console.warn('[XMD] DNR setup failed:', e.message);
  }
})();

/**
 * background.js — Service Worker
 *
 * Handles DOWNLOAD, DOWNLOAD_BATCH, RELAY, CREATE_ZIP messages.
 * Downloads files to Downloads/XMedia/<username>/.
 * Adds Referer header so Twitter CDN accepts the request.
 */

const queue = [];
let busy = false;
const activeDownloads = new Set();

chrome.downloads.onChanged.addListener(delta => {
  if (!delta || !activeDownloads.has(delta.id)) return;
  const s = delta.state?.current;
  if (s === 'complete' || s === 'interrupted') activeDownloads.delete(delta.id);
});

/**
 * Fetch a URL via service worker and return as a base64 data URL.
 * DNR rules inject the correct Referer at the network layer for this fetch.
 * This is necessary because chrome.downloads.download() bypasses DNR
 * and cannot set Referer via JS (forbidden header).
 */
async function fetchAsDataUrl(url) {
  // credentials:'omit' required when ACAO is overridden to '*' (wildcard + credentials = CORS error)
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mime = res.headers.get('content-type') || 'application/octet-stream';
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB chunks avoids stack overflow on large files
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Twitter CDN URLs (no Referer restriction — direct download works) */
function isTwitterUrl(url) {
  return url.startsWith('https://video.twimg.com/') || url.startsWith('https://pbs.twimg.com/');
}

async function drain() {
  if (busy || !queue.length) return;
  busy = true;

  const { url, filename, username, tabId } = queue.shift();
  const folder = username ? `XMedia/${sanitize(username)}/` : 'XMedia/';
  const fullFilename = folder + sanitize(filename);

  try {
    if (!isTwitterUrl(url) && tabId) {
      // For TikTok / Instagram / Facebook CDN:
      // Service worker fetch() is CORS-blocked (extension origin ≠ CDN allowed origins).
      // Content script fetches from page origin (CORS passes) and returns a blob URL.
      // Background then calls chrome.downloads.download() with that blob URL.
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'FETCH_DOWNLOAD', url }, async reply => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!reply?.ok) return reject(new Error(reply?.reason || 'fetch_download_failed'));
          try {
            const dlId = await chrome.downloads.download({
              url: reply.blobUrl,
              filename: fullFilename,
              conflictAction: 'uniquify',
              saveAs: false,
            });
            if (dlId) activeDownloads.add(dlId);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    } else {
      // Twitter: direct download (no Referer restriction, no CORS issue)
      // Fallback (no tabId): best-effort via service worker fetchAsDataUrl
      let dlUrl = url;
      if (!isTwitterUrl(url)) dlUrl = await fetchAsDataUrl(url);

      const dlId = await chrome.downloads.download({
        url: dlUrl,
        filename: fullFilename,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      if (dlId) activeDownloads.add(dlId);
      else console.warn('[XMD] download() returned no ID for:', url);
    }
  } catch (err) {
    console.error('[XMD] Download error:', url, err.message);
    // Record error for popup
    chrome.storage.local.get(['dlErrors'], r => {
      const errs = (r.dlErrors || []).slice(-20);
      errs.push(err.message);
      chrome.storage.local.set({ dlErrors: errs });
    });
  }

  // Increment counter
  const { downloadedCount = 0 } = await chrome.storage.local.get(['downloadedCount']);
  await chrome.storage.local.set({ downloadedCount: downloadedCount + 1 });

  // Throttle between items (150 ms keeps Chrome happy without being slow)
  setTimeout(() => { busy = false; drain(); }, 150);
}

/** Strip characters illegal in filenames / folder names */
function sanitize(str) {
  return String(str || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 128);
}

/** Return the correct Referer header value for a given CDN URL */
function getReferer(url) {
  if (url.includes('tiktok.com') || url.includes('tiktokcdn') || url.includes('tiktokv.com'))
    return 'https://www.tiktok.com/';
  if (url.includes('cdninstagram.com'))
    return 'https://www.instagram.com/';
  if (url.includes('fbcdn.net'))
    return 'https://www.facebook.com/';
  return 'https://x.com/';
}

/** Only allow known-safe CDN domains across all supported platforms */
function isSafe(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  return (
    // X / Twitter
    url.startsWith('https://video.twimg.com/') ||
    url.startsWith('https://pbs.twimg.com/') ||
    // Instagram CDN (scontent-*.cdninstagram.com, etc.)
    /^https:\/\/[a-z0-9.-]+\.cdninstagram\.com\//.test(url) ||
    // Facebook & Instagram shared CDN (*.fbcdn.net)
    /^https:\/\/[a-z0-9.-]+\.fbcdn\.net\//.test(url) ||
    // TikTok video CDN (any *.tiktok.com subdomain, tiktokv.com, tiktokcdn)
    /^https:\/\/[a-z0-9.-]+\.tiktok\.com\//.test(url) ||
    /^https:\/\/[a-z0-9.-]+\.tiktokcdn(?:-[a-z]+)?\.com\//.test(url) ||
    /^https:\/\/[a-z0-9.-]+\.tiktokv\.com\//.test(url)
  );
}

// ── Side Panel setup (Chrome 114+) ─────────────────────────────────────────
// Makes clicking the extension icon toggle the side panel instead of a popup.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});
chrome.runtime.onStartup?.addListener?.(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ── Scroll-keeper ports ────────────────────────────────────────────────────
// Content script connects to 'xmd-scroll' when a scan starts.
// This keeps the service worker alive and drives scroll ticks,
// which means scrolling continues even when the tab is in the background.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'xmd-scroll') return;
  let interval = null;

  port.onMessage.addListener(msg => {
    if (msg.type === 'START') {
      clearInterval(interval);
      const delay = Math.max(800, Number(msg.delay) || 2000);
      interval = setInterval(() => {
        try { port.postMessage({ type: 'TICK' }); }
        catch (_) { clearInterval(interval); interval = null; }
      }, delay);
    }
    if (msg.type === 'STOP') {
      clearInterval(interval);
      interval = null;
    }
  });

  port.onDisconnect.addListener(() => {
    clearInterval(interval);
    interval = null;
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {

  // ── Relay from widget.js → content.js on same tab ──────────────────
  if (msg.type === 'RELAY') {
    const tabId = _sender.tab?.id;
    if (!tabId) { reply({ ok: false, reason: 'no_tab' }); return true; }
    chrome.tabs.sendMessage(tabId, msg.payload, resp => {
      const err = chrome.runtime.lastError;
      reply(err ? { ok: false, reason: err.message } : (resp || { ok: true }));
    });
    return true;
  }

  // ── Create ZIP and download ─────────────────────────────────────────
  if (msg.type === 'CREATE_ZIP') {
    // Reply immediately — long-running ZIP would time out the message port (MV3)
    reply({ ok: true, started: true });
    chrome.storage.local.set({ zipProgress: { pct: 0 } });
    createZip(msg.items || [], msg.username || null)
      .catch(e => {
        chrome.storage.local.set({ zipProgress: { error: true, reason: e.message } });
      });
    return true;
  }

  // ── Single download ────────────────────────────────────────────────
  if (msg.type === 'DOWNLOAD') {
    if (!msg.url || !isSafe(msg.url)) {
      reply({ ok: false, reason: 'invalid_url' });
      return true;
    }
    queue.push({ url: msg.url, filename: msg.filename || 'media', username: msg.username || null, tabId: _sender.tab?.id ?? null });
    drain();
    reply({ ok: true, queued: queue.length });
  }

  // ── Batch download (from popup Download All / Download Selected) ───
  if (msg.type === 'DOWNLOAD_BATCH') {
    const items = Array.isArray(msg.items) ? msg.items : [];
    let added = 0;
    for (const item of items) {
      if (item.url && isSafe(item.url)) {
        queue.push({ url: item.url, filename: item.filename || 'media', username: item.username || null, tabId: _sender.tab?.id ?? null });
        added++;
      }
    }
    reply({ ok: true, queued: queue.length, added }); // reply immediately — don't block caller
    drain();
    return false;
  }

  if (msg.type === 'SCRAPE_DONE') {
    console.info(`[XMD] Scrape finished — ${msg.count} items captured.`);
  }

  // ── Stop all active downloads + clear queue ────────────────────────
  if (msg.type === 'STOP_DOWNLOADS') {
    queue.length = 0;
    busy = false;
    const ids = [...activeDownloads];
    activeDownloads.clear();
    let stopped = 0;
    Promise.allSettled(ids.map(id =>
      chrome.downloads.cancel(id).then(() => stopped++).catch(() => {})
    )).then(() => reply({ ok: true, stopped }));
    return true;
  }

  if (msg.type === 'QUEUE_SIZE') {
    reply({ size: queue.length });
  }

  return true;
});

// ───────────────────────────────────────────────────────────────────────────────
function p2(n) { return String(n).padStart(2, '0'); }

function zipFilename(url, type, prefix) {
  const base = url.split('?')[0].split('/').pop() || 'media';
  return prefix + base;
}

/** Build per-item prefix: yyyymmdd_username_ using tweetDate or today */
function buildItemPrefix(username, tweetDate) {
  const d   = new Date();
  const now = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
  const dt  = tweetDate || now;
  return username ? `${dt}_${username}_` : `${dt}_`;
}

/**
 * Fetch all items, create ZIP(s) and trigger browser download(s).
 * Splits into multiple ZIPs if raw data exceeds MAX_ZIP_BYTES per chunk
 * to avoid "Invalid string length" on very large collections.
 */
const MAX_ZIP_BYTES = 100 * 1024 * 1024; // 100 MB raw per chunk

async function createZip(items, username) {
  const safeItems = items.filter(i => i.url && isSafe(i.url));
  if (!safeItems.length) return { ok: false, reason: 'no_files_fetched' };

  const d   = new Date();
  const dt  = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;

  let zip        = new JSZip();
  let vidDir     = zip.folder('videos');
  let imgDir     = zip.folder('photos');
  let chunkBytes = 0;
  let chunkFiles = 0;
  let chunkIdx   = 0;
  let totalCount = 0;
  let needMulti  = false;   // will be set true if we actually flush mid-way

  // Download one finalized ZIP chunk
  async function flushChunk() {
    if (!chunkFiles) return;
    chunkIdx++;
    const partSuffix = needMulti || chunkIdx > 1
      ? `_part${String(chunkIdx).padStart(3, '0')}`
      : '';
    const zipName = `${dt}_${sanitize(username || 'download')}${partSuffix}.zip`;

    const base64  = await zip.generateAsync({ type: 'base64', compression: 'STORE' });
    const dataUrl = `data:application/zip;base64,${base64}`;
    await chrome.downloads.download({ url: dataUrl, filename: zipName, saveAs: false });

    // Reset for next chunk
    zip        = new JSZip();
    vidDir     = zip.folder('videos');
    imgDir     = zip.folder('photos');
    chunkBytes = 0;
    chunkFiles = 0;
  }

  for (let i = 0; i < safeItems.length; i++) {
    const { url, type, tweetDate } = safeItems[i];
    try {
      const res  = await fetch(url, { credentials: 'omit' });
      if (!res.ok) { console.warn('[XMD ZIP]', res.status, url); continue; }
      const data = await res.arrayBuffer();

      const itemPfx = buildItemPrefix(username, tweetDate);
      const fname   = zipFilename(url, type, itemPfx);
      (type === 'video' ? vidDir : imgDir).file(fname, data);
      chunkBytes += data.byteLength;
      chunkFiles++;
      totalCount++;
    } catch (e) {
      console.error('[XMD ZIP] fetch error:', e.message, url);
    }

    // Report progress
    const fname0 = url.split('?')[0].split('/').pop() || '';
    chrome.storage.local.set({
      zipProgress: { pct: Math.round(((i + 1) / safeItems.length) * 100), file: fname0, idx: i + 1, total: safeItems.length }
    });

    if (chunkBytes >= MAX_ZIP_BYTES) {
      needMulti = true;
      await flushChunk();
    }
  }

  // Flush remaining files (rename without _part suffix if there was only one chunk)
  await flushChunk();

  if (!totalCount) return { ok: false, reason: 'no_files_fetched' };
  chrome.storage.local.set({ zipProgress: { done: true, count: totalCount, parts: chunkIdx } });
  return { ok: true, count: totalCount, parts: chunkIdx };
}
