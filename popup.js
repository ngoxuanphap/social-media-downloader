'use strict';

// ── Close button (CSP-safe replacement for inline onclick="window.close()") ─
document.getElementById('titlebar-close')?.addEventListener('click', () => window.close());

// ── Tab navigation ─────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('tab-' + tab.dataset.tab);
    if (panel) panel.classList.add('active');
    if (tab.dataset.tab === 'gallery') refreshGallery();
  });
});

// ── Element refs ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
  avatarImg:         $('avatar-img'),
  avatarPlaceholder: $('avatar-placeholder'),
  profileDisplay:    $('profile-display'),
  profileFollowers:  $('profile-followers'),
  profileFollowing:  $('profile-following'),
  statusLabel:       $('status-label'),
  statusCount:       $('status-count'),
  statusCard:        $('status-card'),
  btnScan:           $('btn-scan'),
  btnStop:           $('btn-stop'),
  dlBar:             $('dl-bar'),
  chkAll:            $('chk-all'),
  selCount:          $('sel-count'),
  btnDlSel:          $('btn-dl-sel'),
  btnDlAll:          $('btn-dl-all'),
  btnDlZip:          $('btn-dl-zip'),
  mediaList:         $('media-list'),
  msg:               $('msg'),
  optResume:         $('opt-resume'),
  optOrganize:       $('opt-organize'),
  optVideos:         $('opt-videos'),
  optImages:         $('opt-images'),
  optScanVideos:     $('opt-scan-videos'),
  optScanImages:     $('opt-scan-images'),
  swVideo:           $('sw-video'),
  swPhoto:           $('sw-photo'),
  btnClearCp:        $('btn-clear-checkpoint'),
  btnClean:          $('btn-clean'),
  galleryGrid:       $('gallery-grid'),
};

console.log('[XMD Popup] Loaded. Element check:', {
  btnScan:    !!els.btnScan,
  btnDlSel:   !!els.btnDlSel,
  btnDlAll:   !!els.btnDlAll,
  optOrganize:!!els.optOrganize,
});

// ── Rendered URL tracking ──────────────────────────────────────────────────
 const renderedUrls = new Set();
let lastScanUsername = null;   // cached from last scan — survives tab navigation

// ── Load saved settings ────────────────────────────────────────────────────
chrome.storage.local.get(
  ['optResume', 'optOrganize', 'optVideos', 'optImages', 'optScanVideos', 'optScanImages', 'swVideo', 'swPhoto', 'scrollSpeed'],
  r => {
    if (r.optResume      != null && els.optResume)      els.optResume.checked      = r.optResume;
    if (r.optOrganize    != null && els.optOrganize)    els.optOrganize.checked    = r.optOrganize;
    if (r.optVideos      != null && els.optVideos)      els.optVideos.checked      = r.optVideos;
    if (r.optImages      != null && els.optImages)      els.optImages.checked      = r.optImages;
    if (r.optScanVideos  != null && els.optScanVideos)  els.optScanVideos.checked  = r.optScanVideos;
    if (r.optScanImages  != null && els.optScanImages)  els.optScanImages.checked  = r.optScanImages;
    if (r.swVideo        != null && els.swVideo)        els.swVideo.checked        = r.swVideo;
    if (r.swPhoto        != null && els.swPhoto)        els.swPhoto.checked        = r.swPhoto;
    const radio = document.querySelector(
      `input[name="scroll-speed"][value="${r.scrollSpeed || 'medium'}"]`
    );
    if (radio) radio.checked = true;
  }
);
['opt-resume','opt-organize','opt-videos','opt-images','opt-scan-videos','opt-scan-images'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    chrome.storage.local.set({ [key]: $(id).checked });
  });
});
// Persist type switches and re-filter grid on change
['sw-video','sw-photo'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    chrome.storage.local.set({ [key]: $(id).checked });
    applyTypeFilter();
  });
});
document.querySelectorAll('input[name="scroll-speed"]').forEach(r => {
  r.addEventListener('change', () => chrome.storage.local.set({ scrollSpeed: r.value }));
});

// ── Tab / URL helpers ──────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
function isXTab(tab) {
  return tab?.url && (tab.url.includes('x.com') || tab.url.includes('twitter.com'));
}
const RESERVED_PATHS = new Set([
  'home','explore','notifications','messages','search',
  'settings','compose','i','hashtag','communities','jobs',
]);
function usernameFromTab(tab) {
  try {
    const m = new URL(tab.url).pathname.match(/^\/([A-Za-z0-9_]{1,50})/);
    if (m && !RESERVED_PATHS.has(m[1].toLowerCase())) return m[1];
  } catch (_) {}
  return null;
}
function isProfileTab(tab) {
  return isXTab(tab) && !!usernameFromTab(tab);
}
function sanitizeName(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

// ── Profile detection ──────────────────────────────────────────────────────
async function loadProfile() {
  const tab = await getActiveTab();
  if (!isXTab(tab)) { els.profileDisplay.textContent = 'Open x.com first'; return; }
  if (!isProfileTab(tab)) {
    els.profileDisplay.textContent = 'Go to a profile page';
    if (els.btnScan) els.btnScan.disabled = true;
    setMsg('ℹ️ Navigate to x.com/username to enable Scan.');
    return;
  }
  if (els.btnScan) els.btnScan.disabled = false;
  chrome.tabs.sendMessage(tab.id, { type: 'GET_PROFILE' }, resp => {
    if (chrome.runtime.lastError || !resp?.profile) return;
    const p = resp.profile;
    els.profileDisplay.textContent   = p.displayName || p.username || '—';
    els.profileFollowers.textContent = p.followers || '—';
    els.profileFollowing.textContent = p.following || '—';
    if (p.avatar) {
      els.avatarImg.src              = p.avatar;
      els.avatarImg.style.display    = 'block';
      els.avatarPlaceholder.style.display = 'none';
      els.avatarImg.onerror = () => {
        els.avatarImg.style.display         = 'none';
        els.avatarPlaceholder.style.display = 'flex';
      };
    }
  });
}

// ── Status display ─────────────────────────────────────────────────────────
const STATUS_TEXT = { idle: 'Idle', running: 'Scanning…', done: 'Done ✓', stopped: 'Stopped' };
function applyStatus(state) {
  els.statusLabel.textContent = STATUS_TEXT[state] || state;
  const running = state === 'running';
  els.btnScan.style.display = running ? 'none' : 'flex';
  els.btnStop.style.display = running ? 'flex' : 'none';
  els.statusCard?.classList.toggle('status-running', running);
}
function refreshStats() {
  chrome.storage.local.get(['detectedCount', 'status', 'galleryUrls'], r => {
    els.statusCount.textContent = r.detectedCount || 0;
    applyStatus(r.status || 'idle');
    renderMediaItems(r.galleryUrls || []);
  });
}
chrome.storage.onChanged.addListener(changes => {
  if (changes.detectedCount) els.statusCount.textContent = changes.detectedCount.newValue || 0;
  if (changes.status)        applyStatus(changes.status.newValue);
  if (changes.galleryUrls)   renderMediaItems(changes.galleryUrls.newValue || []);
});

// ── Filename builder ───────────────────────────────────────────────────────
function buildFilename(url, type, user, tweetDate) {
  const d   = new Date();
  const now = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`;
  const dt  = (typeof tweetDate === 'string' && tweetDate.length === 8) ? tweetDate : now;
  const base = url.split('?')[0].split('/').pop() || 'media';
  return user ? `${dt}_${user}_${base}` : `${dt}_${base}`;
}

function p2(n) { return String(n).padStart(2, '0'); }

// ── Core download (routes through background service worker) ──────────────
async function dispatchDownloads(items) {
  console.log('[XMD] dispatchDownloads called with', items.length, 'items');

  if (!items.length) { setMsg('Nothing to download.'); return; }

  const tab      = await getActiveTab();
  const pageUser = usernameFromTab(tab) || lastScanUsername;

  const batchItems = items
    .filter(({ url }) => !!url)
    .map(({ url, type, tweetDate }) => ({
      url, type,
      username: pageUser,
      filename: buildFilename(url, type, pageUser, tweetDate),
    }));

  if (!batchItems.length) { setMsg('Nothing to download.'); return; }

  setMsg(`Queuing ${batchItems.length} download(s)…`);
  console.log('[XMD] Sending DOWNLOAD_BATCH:', batchItems.map(i => i.filename));

  chrome.runtime.sendMessage({ type: 'DOWNLOAD_BATCH', items: batchItems }, resp => {
    if (chrome.runtime.lastError) {
      setMsg('⚠ Download error — check service worker console');
      console.error('[XMD] DOWNLOAD_BATCH error:', chrome.runtime.lastError.message);
    } else {
      setMsg(`✓ ${resp?.added || batchItems.length} download(s) queued — check Downloads/XMedia/`);
    }
  });
}

// ── Download Selected ──────────────────────────────────────────────────────
els.btnDlSel?.addEventListener('click', () => {
  console.log('[XMD] Download Selected clicked');
  const selected = [];
  document.querySelectorAll('.media-tile').forEach(tile => {
    if (tile.querySelector('.tile-chk')?.checked) {
      selected.push({ url: tile.dataset.url, type: tile.dataset.type, tweetDate: tile.dataset.tweetDate });
    }
  });
  console.log('[XMD] Selected items:', selected.length);
  dispatchDownloads(selected);
});

// ── Download All ───────────────────────────────────────────────────────────
els.btnDlAll?.addEventListener('click', () => {
  console.log('[XMD] Download All clicked');
  chrome.storage.local.get(['galleryUrls'], r => {
    const items = r.galleryUrls || [];
    console.log('[XMD] galleryUrls count:', items.length);
    dispatchDownloads(items);
  });
});

// ── Download ZIP ────────────────────────────────────────────────────────────
els.btnDlZip?.addEventListener('click', () => {
  const selected = [];
  document.querySelectorAll('.media-tile').forEach(tile => {
    if (tile.querySelector('.tile-chk')?.checked) {
      selected.push({ url: tile.dataset.url, type: tile.dataset.type, tweetDate: tile.dataset.tweetDate });
    }
  });
  if (!selected.length) { setMsg('No items selected.'); return; }
  getActiveTab().then(tab => {
    const username = usernameFromTab(tab) || lastScanUsername;
    setMsg(`⏳ Creating ZIP with ${selected.length} files…`);
    chrome.runtime.sendMessage({ type: 'CREATE_ZIP', items: selected, username }, resp => {
      if (chrome.runtime.lastError || !resp?.ok) {
        setMsg('⚠ ZIP could not start');
      }
      // progress + completion handled by storage.onChanged listener below
    });
  });
});

// ── ZIP progress via storage (works across service worker lifetime) ───────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('zipProgress' in changes)) return;
  const v = changes.zipProgress.newValue;
  if (!v || typeof v !== 'object') return;
  if (v.error) {
    setMsg('⚠ ZIP error: ' + (v.reason || 'unknown'));
  } else if (v.done) {
    const partsNote = v.parts > 1 ? ` in ${v.parts} parts` : '';
    setMsg(`✓ ZIP saved — ${v.count} files${partsNote}`);
  } else if (v.pct != null) {
    const fileLabel = v.file ? ` — ${v.file.length > 30 ? v.file.slice(0, 27) + '…' : v.file}` : '';
    setMsg(`⏳ Zipping… ${v.pct}% (${v.idx}/${v.total})${fileLabel}`);
  }
});

// ── Media type filter (toggle switches) ──────────────────────────────────────────
function applyTypeFilter() {
  const showV = els.swVideo?.checked !== false;
  const showP = els.swPhoto?.checked !== false;
  document.querySelectorAll('.media-tile').forEach(tile => {
    const t = tile.dataset.type;
    tile.style.display = (t === 'video' ? showV : showP) ? '' : 'none';
  });
  updateSelectionState();  // re-evaluate Select All for visible tiles
}

// ── Select All ─────────────────────────────────────────────────────────────
els.chkAll?.addEventListener('change', function () {
  const visible = [...document.querySelectorAll('.media-tile')]
    .filter(t => t.style.display !== 'none');
  visible.forEach(tile => {
    const chk = tile.querySelector('.tile-chk');
    if (chk) { chk.checked = this.checked; tile.classList.toggle('deselected', !this.checked); }
  });
  updateSelectionState();
});

function updateSelectionState() {
  const visible    = [...document.querySelectorAll('.media-tile')].filter(t => t.style.display !== 'none');
  const visChks    = visible.map(t => t.querySelector('.tile-chk')).filter(Boolean);
  const visChecked = visChks.filter(c => c.checked);
  const allChecked = document.querySelectorAll('.tile-chk:checked');  // for DL Selected
  const allChks    = document.querySelectorAll('.tile-chk');
  if (els.chkAll) {
    els.chkAll.checked       = visChks.length > 0 && visChecked.length === visChks.length;
    els.chkAll.indeterminate = visChecked.length > 0 && visChecked.length < visChks.length;
  }
  if (els.selCount)  els.selCount.textContent = `${visChecked.length} / ${visChks.length} selected`;
  if (els.btnDlSel)  els.btnDlSel.disabled    = allChecked.length === 0;
  if (els.btnDlAll)  els.btnDlAll.disabled    = allChks.length === 0;
  if (els.btnDlZip) {
    els.btnDlZip.textContent = `📦 ZIP Selected (${allChecked.length})`;
    els.btnDlZip.disabled    = allChecked.length === 0;
  }
}

// ── Media list rendering (incremental, no re-render) ──────────────────────
function renderMediaItems(items) {
  if (!items.length) return;
  const emptyEl = document.getElementById('media-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  let added = false;
  for (const { url, type, tweetDate } of items) {
    if (renderedUrls.has(url)) continue;
    renderedUrls.add(url);
    const tile = createMediaTile(url, type, tweetDate);
    // Apply current type filter to newly added tile
    const showV = els.swVideo?.checked !== false;
    const showP = els.swPhoto?.checked !== false;
    if (type === 'video' && !showV) tile.style.display = 'none';
    if (type === 'photo' && !showP) tile.style.display = 'none';
    els.mediaList.appendChild(tile);
    added = true;
  }
  if (added) updateSelectionState();
}

function createMediaTile(url, type, tweetDate) {
  const tile = document.createElement('div');
  tile.className = 'media-tile';
  tile.dataset.url  = url;
  tile.dataset.type = type;
  if (tweetDate) tile.dataset.tweetDate = tweetDate;

  if (type === 'photo') {
    const thumbUrl = url.replace(/format=jpg&name=\w+/, 'format=jpg&name=thumb');
    const img = document.createElement('img');
    img.className = 'tile-img'; img.loading = 'lazy'; img.src = thumbUrl; img.alt = '';
    img.onerror = () => { img.style.display = 'none'; };
    tile.appendChild(img);
  } else {
    const icon = document.createElement('div');
    icon.className = 'tile-vid-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="#4a90e2"><path d="M8 5v14l11-7z"/></svg>';
    tile.appendChild(icon);
  }

  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.className = 'tile-chk'; chk.checked = true;
  tile.appendChild(chk);

  const bdg = document.createElement('div');
  bdg.className = 'tile-badge';
  bdg.textContent = type === 'video' ? 'VID' : 'IMG';
  tile.appendChild(bdg);

  tile.addEventListener('click', e => {
    if (e.target === chk) return;
    chk.checked = !chk.checked;
    tile.classList.toggle('deselected', !chk.checked);
    updateSelectionState();
  });
  chk.addEventListener('change', () => {
    tile.classList.toggle('deselected', !chk.checked);
    updateSelectionState();
  });
  return tile;
}

// ── Scan button ────────────────────────────────────────────────────────────
els.btnScan?.addEventListener('click', async () => {
  console.log('[XMD] Scan clicked');
  const tab = await getActiveTab();
  if (!isXTab(tab))      { setMsg('⚠ Please open x.com first.'); return; }
  if (!isProfileTab(tab)) { setMsg('⚠ Scan only works on profile pages (x.com/username).'); return; }

  // Reset list
  renderedUrls.clear();
  els.mediaList.innerHTML = '<div id="media-empty" class="media-empty">Scanning…</div>';
  els.mediaList.scrollTop = 0;
  updateSelectionState();

  const speedMap = { slow: 3000, medium: 2000, fast: 1000 };
  const speedEl  = document.querySelector('input[name="scroll-speed"]:checked');
  const delay    = speedMap[speedEl?.value] || 2000;

  await chrome.storage.local.set({ detectedCount: 0, downloadedCount: 0, status: 'running', galleryUrls: [] });

  const username = usernameFromTab(tab);
  if (username) lastScanUsername = username;   // cache for download handlers
  console.log('[XMD] Starting scan for:', username);

  chrome.tabs.sendMessage(tab.id, {
    type: 'START',
    opts: {
      scroll: true, autoDownload: false,
      resume:      els.optResume?.checked     || false,
      organize:    els.optOrganize?.checked   || false,
      videos:      els.optVideos?.checked     !== false,
      images:      els.optImages?.checked     !== false,
      scanVideos:  els.swVideo?.checked !== false,
      scanImages:  els.swPhoto?.checked !== false,
      scrollDelay: delay,
      username,
    },
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[XMD] Scan message error:', chrome.runtime.lastError.message);
      setMsg('⚠ Could not reach page — refresh x.com and retry.');
      chrome.storage.local.set({ status: 'idle' });
    } else {
      setMsg('');
    }
  });
});

// ── Stop button ────────────────────────────────────────────────────────────
els.btnStop?.addEventListener('click', async () => {
  console.log('[XMD] Stop clicked');
  const tab = await getActiveTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP' }, () => {});
  chrome.storage.local.set({ status: 'stopped' });
  setMsg('Scan stopped.');
});

// ── Clean Data ───────────────────────────────────────────────────────────
els.btnClean?.addEventListener('click', async () => {
  const tab = await getActiveTab();
  // Stop any active scan first
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP' }, () => {});
  chrome.storage.local.set(
    { galleryUrls: [], detectedCount: 0, downloadedCount: 0, status: 'idle' },
    () => {
      renderedUrls.clear();
      if (els.mediaList) {
        els.mediaList.innerHTML = '<div id="media-empty" class="media-empty">Press Scan to start detecting media.</div>';
      }
      updateSelectionState();
      setMsg('Data cleared ✓');
    }
  );
});

// ── Clear checkpoints ──────────────────────────────────────────────────────
els.btnClearCp?.addEventListener('click', () => {
  chrome.storage.local.get(null, all => {
    const keys = Object.keys(all).filter(k => k.startsWith('checkpoint_'));
    if (!keys.length) { setMsg('No checkpoints found.'); return; }
    chrome.storage.local.remove(keys, () => setMsg(`Cleared ${keys.length} checkpoint(s) ✓`));
  });
});

// ── Gallery tab ────────────────────────────────────────────────────────────
function refreshGallery() {
  if (!els.galleryGrid) return;
  chrome.storage.local.get(['galleryUrls'], r => {
    const items = r.galleryUrls || [];
    if (!items.length) {
      els.galleryGrid.innerHTML = '<div class="gallery-empty">Run a Scan first.</div>'; return;
    }
    els.galleryGrid.innerHTML = '';
    [...items].reverse().slice(0, 60).forEach(({ url, type }) => {
      const wrap = document.createElement('div');
      wrap.className = 'gallery-item';
      if (type === 'photo') {
        const img = document.createElement('img');
        img.src = url; img.loading = 'lazy'; wrap.appendChild(img);
      } else {
        wrap.innerHTML = '<div class="media-video-icon" style="width:100%;height:100%">' +
          '<svg viewBox="0 0 24 24" width="28" height="28" fill="#4a90e2"><path d="M8 5v14l11-7z"/></svg></div>';
        const badge = document.createElement('div');
        badge.className = 'gallery-video-badge'; badge.textContent = 'VID';
        wrap.appendChild(badge);
      }
      const dlBtn = document.createElement('div');
      dlBtn.className = 'gallery-item-dl';
      dlBtn.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="white"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
      wrap.appendChild(dlBtn);
      wrap.addEventListener('click', () => {
        dispatchDownloads([{ url, type }]);
      });
      els.galleryGrid.appendChild(wrap);
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setMsg(txt) { if (els.msg) els.msg.textContent = txt; }

// ── Init ───────────────────────────────────────────────────────────────────
loadProfile();
refreshStats();
