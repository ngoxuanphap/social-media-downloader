/**
 * content.js — ISOLATED WORLD
 *
 * Features:
 *  - Receives video + photo URLs from interceptor.js (MAIN world)
 *  - Profile info extraction from DOM
 *  - Resume from checkpoint (skip already-downloaded URLs)
 *  - Organize by username (pass username to background)
 *  - Configurable scroll speed
 *  - Gallery URL accumulation in chrome.storage
 *  - Inject ⬇ download button on every <video> element
 */
(function () {
  'use strict';

  // ── Platform detection ────────────────────────────────────────────────────
  const PLATFORM = (() => {
    const h = location.hostname.replace(/^www\./, '');
    if (h === 'instagram.com') return 'instagram';
    if (h === 'tiktok.com')    return 'tiktok';
    if (h === 'facebook.com')  return 'facebook';
    return 'twitter';
  })();

  // ── State ──────────────────────────────────────────────────────────────
  const capturedUrls  = new Set();   // all seen URLs this page session
  const tweetVideoMap = new Map();   // tweetId → video URL

  let isRunning    = false;
  let currentOpts  = {};
  let scrollTimer  = null;
  let noChangeCount = 0;
  let lastHeight    = 0;
  let scanDebounce  = null;
  let bgPort        = null;   // background port for reliable tick-based scrolling

  // ── Extension context guard ────────────────────────────────────────────
  let _valid = true;
  function cc(fn) {
    if (!_valid) return;
    try { fn(); }
    catch (e) { if (String(e?.message).includes('Extension context')) _valid = false; }
  }

  // ── Reset stale 'running' status on fresh page load ───────────────────
  // If a previous scan was interrupted by navigation, storage may still say
  // 'running'. Reset it so the widget/popup show 'idle' immediately.
  cc(() => chrome.storage.local.get(['status'], r => {
    if (r.status === 'running') {
      cc(() => chrome.storage.local.set({ status: 'idle' }));
    }
  }));

  // ── Profile page guard ─────────────────────────────────────────────────
  // Scan is only allowed on profile/user pages, not feeds or system pages.
  function isProfilePage() {
    const path = location.pathname;
    if (PLATFORM === 'instagram') {
      const m = path.match(/^\/([A-Za-z0-9._]+)\/?/);
      if (!m) return false;
      const reserved = new Set(['explore','reels','direct','accounts','p','tv','reel','stories','ar','about','api','static']);
      return !reserved.has(m[1].toLowerCase());
    }
    if (PLATFORM === 'tiktok') {
      return /^\/@[A-Za-z0-9._]+/.test(path);
    }
    if (PLATFORM === 'facebook') {
      const m = path.match(/^\/([A-Za-z0-9.]+)/);
      if (!m) return false;
      const reserved = new Set(['marketplace','groups','watch','gaming','pages','events','stories','notifications','messages','friends','login','help','settings','bookmarks','search','people','photos','videos']);
      return !reserved.has(m[1].toLowerCase());
    }
    // Twitter / X
    const m = path.match(/^\/([A-Za-z0-9_]+)/);
    if (!m) return false;
    const reserved = new Set([
      'home','explore','notifications','messages','search',
      'settings','compose','i','hashtag','communities','jobs',
    ]);
    return !reserved.has(m[1].toLowerCase());
  }

  // ── Receive intercepted media from MAIN world (via CustomEvent) ────────
  document.addEventListener('__xmd_found__', e => {
    // New format: {url, date}[] items; old format (string[]) kept for compat
    const videoItems = e.detail?.videoItems || (e.detail?.videoUrls || []).map(u => ({ url: u, date: null }));
    const photoItems = e.detail?.photoItems || (e.detail?.photoUrls || []).map(u => ({ url: u, date: null }));

    const newItems = [];

    for (const { url, date, thumb } of videoItems) {
      if (currentOpts.scanVideos === false) continue;  // scan filter
      if (typeof url !== 'string') continue;
      if (!isKnownVideoUrl(url)) continue;
      if (capturedUrls.has(url)) continue;
      capturedUrls.add(url);

      const m = url.match(/\/(?:ext_tw_video|amplify_video|tweet_video)\/(\d+)\//);
      if (m) tweetVideoMap.set(m[1], url);

      newItems.push({ url, type: 'video', tweetDate: date, thumb: thumb || null });
    }

    for (const { url, date } of photoItems) {
      if (currentOpts.scanImages === false) continue;  // scan filter
      if (typeof url !== 'string') continue;
      if (!isKnownPhotoUrl(url)) continue;
      if (capturedUrls.has(url)) continue;
      capturedUrls.add(url);
      newItems.push({ url, type: 'photo', tweetDate: date });
    }

    if (!newItems.length) return;

    // Update detected counter
    cc(() => chrome.storage.local.get(['detectedCount'], r => {
      cc(() => chrome.storage.local.set({ detectedCount: (r.detectedCount || 0) + newItems.length }));
    }));

    // Append to gallery store (no hard cap — let user collect all media)
    cc(() => chrome.storage.local.get(['galleryUrls'], r => {
      let gallery = r.galleryUrls || [];
      for (const { url, type, tweetDate, thumb } of newItems) {
        if (!gallery.some(g => g.url === url)) gallery.push({ url, type, tweetDate: tweetDate || null, thumb: thumb || null });
      }
      cc(() => chrome.storage.local.set({ galleryUrls: gallery }));
    }));

    // Auto-download if active AND autoDownload option is enabled
    if (isRunning && currentOpts.autoDownload !== false) {
      for (const { url, type, tweetDate } of newItems) {
        if (type === 'video' && currentOpts.videos === false) continue;
        if (type === 'photo' && currentOpts.images === false) continue;
        sendDownload(url, type, tweetDate);
      }
    }
  });

  function p2(n) { return String(n).padStart(2, '0'); }

  // ── Download helper ────────────────────────────────────────────────────
  function sendDownload(url, type, tweetDate) {
    const username = currentOpts.username || null;

    // Build yyyymmdd_username_base filename
    const d   = new Date();
    const now = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`;
    const dt  = (typeof tweetDate === 'string' && tweetDate.length === 8) ? tweetDate : now;
    const base = url.split('?')[0].split('/').pop() || 'media';
    const filename = username ? `${dt}_${username}_${base}` : `${dt}_${base}`;

    cc(() => chrome.runtime.sendMessage({ type: 'DOWNLOAD', url, filename, username, mediaType: type }));

    // Save to checkpoint
    if (currentOpts.resume && currentOpts.username) {
      const key = `checkpoint_${currentOpts.username}`;
      cc(() => chrome.storage.local.get([key], r => {
        const saved = r[key] || [];
        if (!saved.includes(url)) {
          saved.push(url);
          if (saved.length > 3000) saved.splice(0, saved.length - 3000);
          cc(() => chrome.storage.local.set({ [key]: saved }));
        }
      }));
    }
  }

  // ── URL validation helpers (platform-aware) ────────────────────────────
  function isKnownVideoUrl(url) {
    if (PLATFORM === 'twitter')   return url.startsWith('https://video.twimg.com/');
    if (PLATFORM === 'instagram') return /^https:\/\/[a-z0-9.-]+\.cdninstagram\.com\//.test(url) || url.includes('.fbcdn.net/');
    if (PLATFORM === 'tiktok') {
      // Accept any HTTPS URL whose hostname is in the TikTok family
      try {
        const host = new URL(url).hostname;
        return host.includes('tiktok.com') || host.includes('tiktokcdn') || host.includes('tiktokv.com');
      } catch (_) { return false; }
    }
    if (PLATFORM === 'facebook')  return url.includes('.fbcdn.net/');
    return false;
  }
  function isKnownPhotoUrl(url) {
    if (PLATFORM === 'twitter')   return url.startsWith('https://pbs.twimg.com/');
    if (PLATFORM === 'instagram') return /^https:\/\/[a-z0-9.-]+\.cdninstagram\.com\//.test(url) || url.includes('.fbcdn.net/');
    if (PLATFORM === 'tiktok')    return false;
    if (PLATFORM === 'facebook')  return url.includes('.fbcdn.net/');
    return false;
  }

  // ── Profile info extraction from DOM ───────────────────────────────────
  function getProfileInfo() {
    if (PLATFORM === 'instagram') return getInstaProfile();
    if (PLATFORM === 'tiktok')    return getTikTokProfile();
    if (PLATFORM === 'facebook')  return getFBProfile();
    return getXProfile();
  }

  function getXProfile() {
    const pathMatch = location.pathname.match(/^\/([A-Za-z0-9_]{1,50})/);
    const reserved  = new Set(['home','explore','notifications','messages','i','settings','search','compose','hashtag']);
    const username  = pathMatch && !reserved.has(pathMatch[1].toLowerCase()) ? pathMatch[1] : null;

    // Avatar: try profile page container first, then any profile image
    let avatarEl = username
      ? document.querySelector(`[data-testid="UserAvatar-Container-${username}"] img`)
      : null;
    if (!avatarEl) avatarEl = document.querySelector('[data-testid^="UserAvatar-Container-"] img');
    if (!avatarEl) avatarEl = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');

    // Display name: inside [data-testid="UserName"]
    let displayName = username;
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (nameEl) {
      const spans = nameEl.querySelectorAll('span');
      for (const s of spans) {
        const txt = s.textContent.trim();
        if (txt && !txt.startsWith('@') && txt.length > 0) { displayName = txt; break; }
      }
    }

    // Followers / following counts from anchor tags
    let followers = null, following = null;
    document.querySelectorAll('a[href]').forEach(a => {
      if (!a.href) return;
      const inner = a.querySelector('span span') || a.querySelector('span');
      if (!inner) return;
      if (a.href.includes('/verified_followers') || a.href.includes('/followers_you_follow')) return;
      if (a.href.match(/\/followers\b/) && !followers) followers = inner.textContent.trim();
      if (a.href.match(/\/following\b/) && !following) following = inner.textContent.trim();
    });

    // Make avatar URL larger (replace _normal with _400x400)
    const avatarSrc = avatarEl?.src
      ? avatarEl.src.replace(/_normal(\.(jpg|png|webp|gif))/, '_400x400$1')
      : null;

    return { username, displayName, avatar: avatarSrc, followers, following };
  }

  function getInstaProfile() {
    const m = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?/);
    const username = m ? m[1] : null;

    let displayName = username;
    const heading = document.querySelector('header h2, header h1, [data-testid="user-name"]');
    if (heading) displayName = heading.textContent.trim() || username;

    let avatarSrc = null;
    const headerImg = document.querySelector('header img, [data-testid="user-avatar"] img');
    if (headerImg) avatarSrc = headerImg.src;

    let followers = null, following = null;
    document.querySelectorAll('a[href*="followers"], a[href*="following"]').forEach(a => {
      const count = (a.querySelector('span[title]') || a.querySelector('span'))?.textContent?.trim();
      if (a.href.includes('/followers') && !followers) followers = count;
      if (a.href.includes('/following') && !following) following = count;
    });

    return { username, displayName, avatar: avatarSrc, followers, following };
  }

  function getTikTokProfile() {
    const m = location.pathname.match(/^\/@([A-Za-z0-9._]+)/);
    const username = m ? m[1] : null;

    let displayName = username;
    const h1 = document.querySelector('[data-e2e="user-title"], h1');
    if (h1) displayName = h1.textContent.trim() || username;

    let avatarSrc = null;
    const img = document.querySelector('[data-e2e="user-avatar"] img, [class*="avatar"] img');
    if (img) avatarSrc = img.src;

    let followers = null;
    const el = document.querySelector('[data-e2e="followers-count"]');
    if (el) followers = el.textContent.trim();

    return { username, displayName, avatar: avatarSrc, followers, following: null };
  }

  function getFBProfile() {
    const m = location.pathname.match(/^\/([A-Za-z0-9.]+)/);
    const username = m ? m[1] : null;

    let displayName = username;
    const h1 = document.querySelector('h1');
    if (h1) displayName = h1.textContent.trim() || username;

    // Facebook OG image as fallback avatar
    let avatarSrc = null;
    const og = document.querySelector('meta[property="og:image"]');
    if (og) avatarSrc = og.content;

    return { username, displayName, avatar: avatarSrc, followers: null, following: null };
  }

  // ── Auto-scroll engine ─────────────────────────────────────────────────
  function tick() {
    if (!isRunning) return;
    scanVideos();

    const h = document.body.scrollHeight;
    window.scrollTo({ top: h, behavior: 'smooth' });

    if (h === lastHeight) {
      noChangeCount++;
      if (noChangeCount >= 7) {
        stopScrape('done');
        cc(() => chrome.runtime.sendMessage({ type: 'SCRAPE_DONE', count: capturedUrls.size }));
        return;
      }
    } else {
      noChangeCount = 0;
      lastHeight = h;
    }

    // When bgPort is connected, the background service worker drives ticking.
    // Fall back to internal timer only if the port is not available.
    if (!bgPort) {
      scrollTimer = setTimeout(tick, currentOpts.scrollDelay || 2000);
    }
  }

  async function startScrape(opts) {
    if (isRunning) return;
    isRunning     = true;
    currentOpts   = opts;
    noChangeCount = 0;
    lastHeight    = 0;

    // Load checkpoint to skip already-downloaded URLs
    if (opts.resume && opts.username) {
      const key = `checkpoint_${opts.username}`;
      await new Promise(resolve => {
        try {
          chrome.storage.local.get([key], r => {
            (r[key] || []).forEach(url => capturedUrls.add(url));
            resolve();
          });
        } catch (e) {
          if (String(e?.message).includes('Extension context')) _valid = false;
          resolve();
        }
      });
    }

    cc(() => chrome.storage.local.set({ status: 'running' }));

    // Scroll to top of page so scan captures media from the beginning
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (opts.scroll !== false) {
      // Connect to background service worker for reliable scroll ticking.
      // The open port keeps the SW alive; ticks arrive even in background tabs.
      try {
        bgPort = chrome.runtime.connect({ name: 'xmd-scroll' });
        bgPort.onMessage.addListener(msg => {
          if (msg.type === 'TICK' && isRunning) tick();
        });
        bgPort.onDisconnect.addListener(() => {
          bgPort = null;
          // SW disconnected — fall back to internal timer
          if (isRunning) scrollTimer = setTimeout(tick, currentOpts.scrollDelay || 2000);
        });
        bgPort.postMessage({ type: 'START', delay: opts.scrollDelay || 2000 });
      } catch (_) {
        // Port unavailable (e.g. older Chrome) — use internal timer
        bgPort = null;
        tick();
      }
    }
  }

  function stopScrape(reason) {
    isRunning = false;
    clearTimeout(scrollTimer);
    if (bgPort) {
      try { bgPort.postMessage({ type: 'STOP' }); bgPort.disconnect(); } catch (_) {}
      bgPort = null;
    }
    cc(() => chrome.storage.local.set({ status: reason || 'stopped' }));
  }

  // ── Inject download buttons on <video> elements ────────────────────────
  function injectButton(videoEl) {
    if (videoEl.__xmdInjected) return;
    videoEl.__xmdInjected = true;

    const wrap =
      videoEl.closest('[data-testid="videoComponent"]') ||
      videoEl.closest('article') ||
      videoEl.parentElement;
    if (!wrap) return;

    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

    const btn = document.createElement('button');
    btn.setAttribute('style', [
      'position:absolute', 'top:8px', 'right:8px', 'z-index:9999',
      'width:38px', 'height:38px', 'border-radius:50%', 'border:none',
      'background:rgba(14,20,34,.78)', 'color:#fff', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'transition:background .18s', 'pointer-events:all',
      'box-shadow:0 2px 10px rgba(0,0,0,.5)',
    ].join(';'));
    btn.title = 'Download video (X Media Downloader)';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">' +
      '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(74,144,226,.92)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(14,20,34,.78)'; });
    btn.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      handleBtnClick(videoEl, btn);
    });

    wrap.appendChild(btn);
  }

  function handleBtnClick(videoEl, btn) {
    // 1. Direct twimg src
    const src = videoEl.currentSrc || videoEl.src;
    if (src && src.startsWith('https://video.twimg.com/')) {
      sendDownload(src, 'video'); flashBtn(btn, '✓'); return;
    }
    // 2. Tweet ID lookup
    const article = videoEl.closest('article');
    if (article) {
      const link = article.querySelector('a[href*="/status/"]');
      const m    = link?.href?.match(/\/status\/(\d+)/);
      if (m && tweetVideoMap.has(m[1])) {
        sendDownload(tweetVideoMap.get(m[1]), 'video'); flashBtn(btn, '✓'); return;
      }
    }
    // 3. Most recently captured
    if (capturedUrls.size) {
      const url = Array.from(capturedUrls).filter(u => u.startsWith('https://video.twimg.com/')).pop();
      if (url) { sendDownload(url, 'video'); flashBtn(btn, '✓'); return; }
    }
    flashBtn(btn, '…');
    setTimeout(() => {
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">' +
        '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
    }, 1600);
  }

  function flashBtn(btn, symbol) {
    const orig = btn.innerHTML;
    btn.textContent = symbol;
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }

  // ── DOM scanner (debounced) ────────────────────────────────────────────
  function scanVideos() {
    document.querySelectorAll('video').forEach(injectButton);
  }

  const observer = new MutationObserver(mutations => {
    let hasNewNodes = false;
    for (const m of mutations) {
      if (m.addedNodes.length) { hasNewNodes = true; break; }
    }
    if (!hasNewNodes) return;
    clearTimeout(scanDebounce);
    scanDebounce = setTimeout(scanVideos, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanVideos();

  // ── Messages from popup ────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    // ── Download via page origin (avoids CORS for TikTok/Instagram/FB CDN) ──
    // background.js sends this because service worker fetch() is CORS-blocked by
    // TikTok/Instagram/FB CDN (extension origin ≠ allowed origins).
    // Content script runs in the page's origin so CORS passes.
    // chrome.downloads is NOT available in content scripts, so we fetch here,
    // create a blob URL, and return it to background which calls chrome.downloads.
    if (msg.type === 'FETCH_DOWNLOAD') {
      fetch(msg.url)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          // Keep blob alive long enough for the download manager to grab it
          setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
          reply({ ok: true, blobUrl });
        })
        .catch(err => reply({ ok: false, reason: err.message }));
      return true; // keep message channel open for async reply
    }

    if (msg.type === 'START') {
      if (!isProfilePage()) {
        reply({ ok: false, reason: 'not_profile_page' });
        return true;
      }
      startScrape(msg.opts || {}).then(() => reply({ ok: true }));
      return true;
    }
    if (msg.type === 'STOP') {
      stopScrape('stopped'); reply({ ok: true });
    }
    if (msg.type === 'STATUS') {
      reply({ isRunning, count: capturedUrls.size });
    }
    if (msg.type === 'GET_PROFILE') {
      reply({ profile: getProfileInfo() });
    }

    return true;
  });
})();
