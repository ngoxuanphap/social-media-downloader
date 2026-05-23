/**
 * widget.js — Injected floating panel (ISOLATED WORLD)
 *
 * Features:
 *  • Shadow DOM — CSS isolation from x.com
 *  • Extension context guard — graceful stop if extension reloads
 *  • Size toggle: Full (380px + thumbnail grid) ↔ Compact (260px, controls only)
 *  • Pin button: keeps panel always open
 *  • Thumbnail grid with per-item select/deselect
 *  • Stop Downloads + ZIP progress bar
 */
(function () {
  'use strict';
  if (document.getElementById('__xmd_host__')) return;

  // ── Platform detection ─────────────────────────────────────────────────
  const PLATFORM = (() => {
    const h = location.hostname.replace(/^www\./, '');
    if (h === 'instagram.com') return 'instagram';
    if (h === 'tiktok.com')    return 'tiktok';
    if (h === 'facebook.com')  return 'facebook';
    return 'twitter';
  })();

  function platformName() {
    if (PLATFORM === 'instagram') return 'Instagram';
    if (PLATFORM === 'tiktok')    return 'TikTok';
    if (PLATFORM === 'facebook')  return 'Facebook';
    return 'X';
  }

  function profileHint() {
    if (PLATFORM === 'tiktok') return 'Navigate to @username to scan';
    return `Navigate to ${platformName()}/username to scan`;
  }

  // ── Extension context guard ───────────────────────────────────────────────
  // After the extension is reloaded the chrome.* APIs throw
  // "Extension context invalidated". We catch that and stop all activity.
  let _valid = true;
  function cc(fn) {            // "chrome call" — safe wrapper
    if (!_valid) return;
    try { return fn(); }
    catch (e) {
      if (String(e?.message).includes('Extension context')) {
        _valid = false;        // stop all future calls
      }
    }
  }

  // ── Shadow DOM host ───────────────────────────────────────────────────────
  const HOST = document.createElement('div');
  HOST.id = '__xmd_host__';
  HOST.style.cssText =
    'all:initial;position:fixed;right:0;top:0;width:0;height:100vh;' +
    'z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(HOST);
  const shadow = HOST.attachShadow({ mode: 'open' });

  // ── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    #root{
      position:fixed;right:0;top:50%;transform:translateY(-50%);
      display:flex;align-items:stretch;pointer-events:all;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:13px;color:#dde3ef;
    }

    /* ── Pull-tab ── */
    #tab{
      width:30px;background:#1d9bf0;border-radius:10px 0 0 10px;
      cursor:pointer;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;
      padding:20px 0;box-shadow:-2px 0 14px rgba(0,0,0,.5);
      user-select:none;flex-shrink:0;transition:background .15s;
    }
    #tab:hover{background:#1a8cd8;}
    #tab.pinned{background:#0e4a8a;cursor:default;}
    #tab-lbl{color:#fff;font-size:10px;font-weight:800;letter-spacing:1.5px;writing-mode:vertical-rl;}
    #badge{background:#f91880;color:#fff;border-radius:10px;padding:2px 5px;
      font-size:9px;font-weight:800;min-width:18px;text-align:center;display:none;}
    #badge.on{display:block;}

    /* ── Panel ── */
    #panel{
      background:#0e1422;border-radius:12px 0 0 12px;
      box-shadow:-6px 0 32px rgba(0,0,0,.7);
      display:flex;flex-direction:column;max-height:92vh;overflow:hidden;
      transition:width .22s ease,opacity .15s ease;
      width:380px;
    }
    #panel.hide{width:0 !important;opacity:0;pointer-events:none;}
    #panel.compact{width:260px;}

    /* Scrollable body */
    #panel-scroll{flex:1;overflow-y:auto;display:flex;flex-direction:column;}
    #panel-scroll::-webkit-scrollbar{width:4px;}
    #panel-scroll::-webkit-scrollbar-track{background:#0e1422;}
    #panel-scroll::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;}

    /* ── Header ── */
    .hdr{
      background:#131e34;padding:10px 12px;display:flex;align-items:center;gap:9px;
      border-bottom:1px solid #1e2d4a;flex-shrink:0;
    }
    .av{width:34px;height:34px;border-radius:50%;background:#1e2d4a;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;color:#3d4e6a;overflow:hidden;}
    .av img{width:34px;height:34px;object-fit:cover;border-radius:50%;display:none;}
    .hdr-info{flex:1;min-width:0;}
    .hdr-name{color:#dde3ef;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .hdr-sub{color:#5a6a85;font-size:10px;margin-top:2px;}
    .hdr-btns{display:flex;align-items:center;gap:3px;flex-shrink:0;}
    .hbtn{
      background:none;border:none;cursor:pointer;
      color:#5a6a85;font-size:14px;line-height:1;
      padding:4px 5px;border-radius:6px;
      transition:background .12s,color .12s;
      display:flex;align-items:center;justify-content:center;
    }
    .hbtn:hover{background:rgba(255,255,255,.07);color:#dde3ef;}
    .hbtn.active{color:#1d9bf0;}

    /* ── Status row ── */
    .sts{padding:8px 13px;display:flex;align-items:center;justify-content:space-between;
      border-bottom:1px solid #1e2d4a;flex-shrink:0;}
    .slbl{font-size:12px;color:#5a6a85;}
    .slbl.run{color:#4a90e2;} .slbl.done{color:#4caf50;}
    .scnt{font-size:12px;font-weight:700;color:#dde3ef;background:#16213a;
      border:1px solid #1e2d4a;border-radius:20px;padding:2px 10px;}

    /* Scan strip */
    .spbar{height:3px;background:#16213a;flex-shrink:0;}
    .spbar-fill{height:100%;background:#1d9bf0;width:0%;transition:width .4s;}

    /* ── Generic row ── */
    .row{padding:8px 13px;display:flex;gap:7px;border-bottom:1px solid #1e2d4a;flex-shrink:0;}

    /* ── Buttons ── */
    button{
      border:none;border-radius:7px;cursor:pointer;
      font-size:11.5px;font-weight:600;padding:8px 10px;
      display:flex;align-items:center;justify-content:center;gap:5px;
      transition:opacity .15s,background .15s;flex:1;
    }
    button:hover{opacity:.85;} button:disabled{opacity:.35;cursor:not-allowed;}
    .b-scan     {background:#1d9bf0;color:#fff;font-size:12px;}
    .b-stop-scan{background:#e34234;color:#fff;}
    .b-clean    {background:transparent;color:#6b7a99;border:1px solid #2a3655;
                 font-size:14px;flex:0 0 auto;padding:0;width:32px;height:32px;
                 border-radius:8px;}
    .b-clean:hover{color:#ef5350!important;border-color:#ef5350!important;opacity:1!important;}
    .b-dl-all{background:#1d3a6a;color:#7ab8ff;border:1px solid #2a4a80;font-size:11px;}
    .b-dl-sel{background:#16213a;color:#dde3ef;border:1px solid #2a3a55;font-size:11px;}
    .b-dl-sel:disabled{opacity:.3;}
    .b-stop-dl  {background:#3a1515;color:#ff7070;border:1px solid #5a2525;
                 font-size:11px;flex:0 0 auto;padding:8px 12px;}
    .b-zip      {background:#0b2010;color:#4caf50;border:1px solid #1a4020;font-size:11px;}

    /* ── Type filter toggle buttons ── */
    .type-filter-row{padding:6px 13px;display:flex;gap:6px;border-bottom:1px solid #1e2d4a;flex-shrink:0;background:#0c1220;}
    .tf-btn{display:flex;align-items:center;gap:4px;cursor:pointer;flex:1;
      font-size:11px;font-weight:600;padding:5px 8px;border-radius:7px;
      background:#16213a;border:1px solid #1e2d4a;color:#5a6a85;user-select:none;
      transition:background .12s,color .12s,border-color .12s;justify-content:center;}
    .tf-btn input{display:none;}
    .tf-btn:has(input:checked){background:#1d3a6a;border-color:#1d9bf0;color:#7ab8ff;}

    /* ── Grid header ── */
    .grid-hdr{padding:7px 13px;display:flex;align-items:center;gap:8px;
      border-bottom:1px solid #1e2d4a;flex-shrink:0;background:#0c1220;}
    .grid-hdr label{display:flex;align-items:center;gap:5px;cursor:pointer;
      color:#8899aa;font-size:11px;}
    .grid-hdr input[type=checkbox]{cursor:pointer;accent-color:#1d9bf0;width:13px;height:13px;}
    .sel-info{margin-left:auto;font-size:10px;color:#5a6a85;}

    /* ── Thumbnail grid ── */
    .mlist{
      display:grid;grid-template-columns:repeat(4,1fr);align-content:start;align-items:start;gap:3px;
      padding:6px;background:#090f1c;flex-shrink:0;
      max-height:360px;overflow-y:auto;
    }
    .mlist::-webkit-scrollbar{width:4px;}
    .mlist::-webkit-scrollbar-track{background:#090f1c;}
    .mlist::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;}
    .mlist-empty{grid-column:1/-1;text-align:center;padding:26px 0;
      color:#3d4e6a;font-size:12px;}

    .mi{position:relative;width:100%;height:0;padding-bottom:100%;border-radius:5px;overflow:hidden;
      background:#16213a;cursor:pointer;transition:outline .1s;
      outline:2px solid transparent;}
    .mi.sel {outline:2px solid #1d9bf0;}
    .mi.desel{opacity:.28;}
    .mi-img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block;}
    .mi-vid{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;
      justify-content:center;background:#0d1a2e;color:#3d5a7a;font-size:22px;}
    .mi-vid--overlay{background:rgba(0,0,0,.38);color:rgba(255,255,255,.9);}
    .mi-chk{position:absolute;top:3px;left:3px;width:14px;height:14px;
      accent-color:#1d9bf0;cursor:pointer;pointer-events:none;}
    .mi-badge{position:absolute;bottom:3px;right:3px;background:rgba(0,0,0,.7);
      color:#7ab;font-size:8px;font-weight:700;border-radius:3px;padding:1px 4px;}

    /* ── ZIP progress ── */
    .zip-row{display:flex;flex-direction:column;padding:6px 13px 8px;gap:5px;flex-shrink:0;border-bottom:1px solid #1e2d4a;}
    .zip-lbl{font-size:10px;color:#5a6a85;}.zip-bar{height:5px;background:#1e2d4a;border-radius:3px;overflow:hidden;}
    .zip-fill{height:100%;width:0%;background:#4caf50;transition:width .3s;}

    /* ── Message ── */
    .msg{padding:7px 13px;font-size:11px;color:#5a6a85;min-height:26px;
      flex-shrink:0;line-height:1.4;word-break:break-word;}
    .msg.err{color:#e34234;} .msg.ok{color:#4caf50;}
  `;

  // ── HTML ──────────────────────────────────────────────────────────────────
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div id="root">

      <div id="tab" title="X Media Downloader">
        <div id="tab-lbl">XMD</div>
        <div id="badge">0</div>
      </div>

      <div id="panel" class="hide">

        <!-- Header (fixed top) -->
        <div class="hdr">
          <div class="av" id="av-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
            <img id="av-img" src="" alt="" />
          </div>
          <div class="hdr-info">
            <div class="hdr-name" id="w-name">X Media Downloader</div>
            <div class="hdr-sub"  id="w-sub">Open a profile to scan</div>
          </div>
          <div class="hdr-btns">
            <!-- Pin button -->
            <button class="hbtn" id="w-pin" title="Pin panel open">📌</button>
            <!-- Size toggle -->
            <button class="hbtn" id="w-size" title="Toggle compact / full size">⊟</button>
            <!-- Close -->
            <button class="hbtn" id="w-close" title="Close">✕</button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div id="panel-scroll">

          <!-- Status -->
          <div class="sts">
            <span class="slbl" id="w-slbl">Idle</span>
            <span class="scnt" id="w-scnt">0 found</span>
          </div>
          <div class="spbar"><div class="spbar-fill" id="w-spfill"></div></div>

          <!-- Scan / Stop scan -->
          <div class="row">
            <button class="b-scan"      id="w-scan">▶ Scan</button>
            <button class="b-stop-scan" id="w-stop" style="display:none">■ Stop Scan</button>
            <button class="b-clean"     id="w-clean" title="Clear detected media">&#128465;</button>
          </div>

          <!-- Type filter — always visible -->
          <div class="type-filter-row" id="w-type-filter">
            <label class="tf-btn" title="Toggle video">
              <input type="checkbox" id="w-sw-vid" checked>
              <span>▶ Video</span>
            </label>
            <label class="tf-btn" title="Toggle photo">
              <input type="checkbox" id="w-sw-img" checked>
              <span>🖼 Photo</span>
            </label>
          </div>

          <!-- Grid header — hidden in compact mode -->
          <div class="grid-hdr" id="w-ghdr" style="display:none">
            <label>
              <input type="checkbox" id="chk-all" checked>
              Select All
            </label>
            <span class="sel-info" id="w-selinfo"></span>
          </div>

          <!-- Thumbnail grid — hidden in compact mode -->
          <div class="mlist" id="w-mlist">
            <div class="mlist-empty">Run Scan to detect media</div>
          </div>

          <!-- Download All + Stop Downloads -->
          <div class="row">
            <button class="b-dl-all" id="w-dl-all">⬇ Download All (0)</button>
            <button class="b-stop-dl" id="w-stopdl" style="display:none">⛔ Stop</button>
          </div>

          <!-- Download Selected (only when subset chosen) -->
          <div class="row">
            <button class="b-dl-sel" id="w-dl-sel" disabled>☑ Download Selected (0)</button>
          </div>

          <!-- ZIP (all items) -->
          <div class="row">
            <button class="b-zip" id="w-zip">📦 ZIP Selected</button>
          </div>

          <!-- ZIP progress -->
          <div class="zip-row" id="w-zrow" style="display:none">
            <span class="zip-lbl" id="w-zpct">Preparing…</span>
            <div class="zip-bar" id="w-zbar"><div class="zip-fill" id="w-zfill"></div></div>
          </div>

          <!-- Status message -->
          <div class="msg" id="w-msg"></div>

        </div><!-- /panel-scroll -->
      </div><!-- /panel -->
    </div><!-- /root -->
  `;

  // ── Element refs ──────────────────────────────────────────────────────────
  const S      = id => shadow.getElementById(id);
  const tab    = S('tab'),     panel   = S('panel');
  const badge  = S('badge'),   avImg   = S('av-img');
  const wName  = S('w-name'),  wSub    = S('w-sub');
  const wSlbl  = S('w-slbl'), wScnt   = S('w-scnt');
  const spFill = S('w-spfill');
  const bScan  = S('w-scan'), bStop   = S('w-stop'), bClean = S('w-clean');
  const bDlAll  = S('w-dl-all'), bDlSel  = S('w-dl-sel'), bStopDl = S('w-stopdl');
  const bZip   = S('w-zip');
  const bPin   = S('w-pin'),   bSize  = S('w-size');
  const ghdr   = S('w-ghdr'), chkAll  = S('chk-all'), selInfo = S('w-selinfo');
  const mlist  = S('w-mlist');
  const wSwVid = S('w-sw-vid'), wSwImg = S('w-sw-img');
  const zRow = S('w-zrow'), zFill = S('w-zfill'), zPct = S('w-zpct'), zBar = S('w-zbar');
  const wMsg   = S('w-msg');

  // ── State ─────────────────────────────────────────────────────────────────
  let open         = false;
  let pinned       = false;   // panel always stays open
  let compact      = false;   // compact = no thumbnail grid
  let currentUser  = null;   // last-known username — persists after navigation
  let galleryItems = [];
  let zipRunning   = false;
  const deselected = new Set();

  // ── Pin ───────────────────────────────────────────────────────────────────
  function applyPin() {
    bPin.classList.toggle('active', pinned);
    bPin.title = pinned ? 'Unpin panel' : 'Pin panel open';
    tab.classList.toggle('pinned', pinned);
      tab.title = pinned ? 'Panel is pinned' : 'Social Media Downloader';
    // When pinning, ensure panel is visible; hide close button
    S('w-close').style.opacity = pinned ? '0.25' : '1';
    S('w-close').style.pointerEvents = pinned ? 'none' : '';
    if (pinned && !open) showPanel();
    cc(() => chrome.storage.local.set({ xmdPinned: pinned }));
  }

  bPin.addEventListener('click', () => {
    pinned = !pinned;
    applyPin();
  });

  // ── Size toggle ───────────────────────────────────────────────────────────
  function applySize() {
    panel.classList.toggle('compact', compact);
    bSize.textContent = compact ? '⊞' : '⊟';
    bSize.title = compact ? 'Expand to full size' : 'Switch to compact';
    // Hide/show grid in compact mode
    const hasItems = galleryItems.length > 0;
    ghdr.style.display  = compact ? 'none' : (hasItems ? '' : 'none');
    mlist.style.display = compact ? 'none' : '';
    cc(() => chrome.storage.local.set({ xmdCompact: compact }));
  }

  bSize.addEventListener('click', () => {
    compact = !compact;
    applySize();
  });

  // ── Open / Close ──────────────────────────────────────────────────────────
  function showPanel() {
    open = true;
    panel.classList.remove('hide');
    cc(() => chrome.storage.local.set({ widgetOpen: true }));
    refreshProfile();
    refreshStatus();
  }
  function hidePanel() {
    if (pinned) return;   // pinned = never collapse
    open = false;
    panel.classList.add('hide');
    cc(() => chrome.storage.local.set({ widgetOpen: false }));
  }

  tab.addEventListener('click', () => {
    if (pinned) return;
    open ? hidePanel() : showPanel();
  });
  S('w-close').addEventListener('click', hidePanel);

  // Restore state from storage
  cc(() => chrome.storage.local.get(['widgetOpen','xmdPinned','xmdCompact'], r => {
    if (!_valid) return;
    pinned  = !!r.xmdPinned;
    compact = !!r.xmdCompact;
    applyPin();
    applySize();
    if (r.widgetOpen || pinned) showPanel();
  }));

  // ── Reserved path guard ───────────────────────────────────────────────────
  function pageUsername() {
    const path = location.pathname;
    // TikTok: /@username
    if (PLATFORM === 'tiktok') {
      const m = path.match(/^\/@([A-Za-z0-9._]+)/);
      return m ? m[1] : null;
    }
    // Instagram / Facebook / X: /username
    const RESERVED_ALL = new Set([
      // X
      'home','explore','notifications','messages','search','settings',
      'compose','i','hashtag','communities','jobs',
      // Instagram
      'reels','direct','accounts','p','tv','reel','stories','ar',
      // Facebook
      'marketplace','groups','watch','gaming','pages','events',
      'bookmarks','people','photos','videos','login','help',
    ]);
    const m = path.match(/^\/([A-Za-z0-9_.]{1,60})/);
    return (m && !RESERVED_ALL.has(m[1].toLowerCase())) ? m[1] : null;
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  function refreshProfile() {
    const user = pageUsername();
    if (user) currentUser = user;   // cache before any navigation
    if (!user) {
      wName.textContent = 'Social Media Downloader';
      wSub.textContent  = profileHint();
      bScan.disabled    = true;
      return;
    }
    bScan.disabled = false;
    cc(() => chrome.runtime.sendMessage(
      { type: 'RELAY', payload: { type: 'GET_PROFILE' } },
      resp => {
        if (!_valid || chrome.runtime.lastError || !resp?.profile) return;
        const p = resp.profile;
        wName.textContent = p.displayName || p.username || user;
        wSub.textContent  = '@' + (p.username || user);
        if (p.avatar) {
          avImg.src = p.avatar;
          avImg.style.display = 'block';
          avImg.addEventListener('error', () => { avImg.style.display = 'none'; }, { once: true });
        }
      }
    ));
  }

  // ── Status ────────────────────────────────────────────────────────────────
  const SMAP = { idle: 'Idle', running: '⟳ Scanning…', done: 'Done ✓', stopped: 'Stopped' };
  function refreshStatus() {
    cc(() => chrome.storage.local.get(['detectedCount','status','galleryUrls'], r => {
      if (!_valid) return;
      applyStatus(r.status || 'idle', r.detectedCount || 0);
      if (r.galleryUrls?.length) renderGrid(r.galleryUrls);
    }));
  }
  function applyStatus(state, count) {
    wSlbl.textContent = SMAP[state] || state;
    wSlbl.className   = 'slbl' + (state === 'running' ? ' run' : state === 'done' ? ' done' : '');
    wScnt.textContent = `${count} found`;
    badge.textContent = count > 999 ? '999+' : String(count);
    badge.classList.toggle('on', count > 0);
    const running = state === 'running';
    bScan.style.display = running ? 'none' : '';
    bStop.style.display = running ? '' : 'none';
    spFill.style.width  = running ? '60%' : state === 'done' ? '100%' : '0%';
  }

  // ── Thumbnail grid ────────────────────────────────────────────────────────
  function renderGrid(items) {
    galleryItems = items;
    for (const i of [...deselected]) { if (i >= items.length) deselected.delete(i); }

    const hasItems = items.length > 0;
    ghdr.style.display  = (!compact && hasItems) ? '' : 'none';
    mlist.style.display = compact ? 'none' : '';

    if (!hasItems) {
      mlist.innerHTML = '<div class="mlist-empty">Run Scan to detect media</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(({ url, type, thumb }, idx) => {
      const tile = document.createElement('div');
      tile.className = 'mi ' + (deselected.has(idx) ? 'desel' : 'sel');
      tile.dataset.idx = idx;

      if (type === 'photo') {
        const thumbUrl = url.replace(/format=jpg&name=\w+/, 'format=jpg&name=thumb');
        const img = document.createElement('img');
        img.className = 'mi-img';
        img.loading = 'lazy';
        img.src = thumbUrl;
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        tile.appendChild(img);
      } else {
        if (thumb) {
          const img = document.createElement('img');
          img.className = 'mi-img';
          img.loading = 'lazy';
          img.src = thumb;
          img.alt = '';
          img.addEventListener('error', () => { img.style.display = 'none'; });
          tile.appendChild(img);
        }
        const icon = document.createElement('div');
        icon.className = thumb ? 'mi-vid mi-vid--overlay' : 'mi-vid';
        icon.textContent = '▶';
        tile.appendChild(icon);
      }

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'mi-chk';
      chk.checked = !deselected.has(idx);
      tile.appendChild(chk);

      const bdg = document.createElement('div');
      bdg.className = 'mi-badge';
      bdg.textContent = type === 'video' ? 'VID' : 'IMG';
      tile.appendChild(bdg);

      frag.appendChild(tile);
    });

    mlist.innerHTML = '';
    mlist.appendChild(frag);
    applyWidgetTypeFilter();
    updateSelInfo();
  }

  function applyWidgetTypeFilter() {
    const showV = wSwVid?.checked !== false;
    const showP = wSwImg?.checked !== false;
    mlist.querySelectorAll('.mi').forEach(tile => {
      const bdg = tile.querySelector('.mi-badge');
      const t = bdg?.textContent === 'VID' ? 'video' : 'photo';
      tile.style.display = (t === 'video' ? showV : showP) ? '' : 'none';
    });
    updateSelInfo();  // re-evaluate Select All for visible tiles
  }

  wSwVid?.addEventListener('change', applyWidgetTypeFilter);
  wSwImg?.addEventListener('change', applyWidgetTypeFilter);

  function updateSelInfo() {
    const total    = galleryItems.length;
    const allSel   = total - deselected.size;   // all selected (for DL Selected count)
    // visible tiles only (for checkbox state + label)
    const visTiles = [...mlist.querySelectorAll('.mi')].filter(t => t.style.display !== 'none');
    const visIdx   = visTiles.map(t => Number(t.dataset.idx));
    const visSel   = visIdx.filter(i => !deselected.has(i)).length;
    const visTotal = visIdx.length;
    selInfo.textContent  = `${visSel} / ${visTotal} selected`;
    bDlAll.textContent   = `⬇ Download All (${total})`;
    bDlAll.disabled      = total === 0;
    bDlSel.textContent   = `☑ Download Selected (${allSel})`;
    bDlSel.disabled      = allSel === 0 || allSel === total;
    bZip.textContent     = `📦 ZIP Selected (${allSel})`;
    bZip.disabled        = zipRunning || allSel === 0;
    chkAll.checked       = visTotal > 0 && visSel === visTotal;
    chkAll.indeterminate = visSel > 0 && visSel < visTotal;
  }

  mlist.addEventListener('click', e => {
    const tile = e.target.closest('.mi');
    if (!tile) return;
    const idx = Number(tile.dataset.idx);
    if (deselected.has(idx)) {
      deselected.delete(idx);
      tile.className = 'mi sel';
      tile.querySelector('.mi-chk').checked = true;
    } else {
      deselected.add(idx);
      tile.className = 'mi desel';
      tile.querySelector('.mi-chk').checked = false;
    }
    updateSelInfo();
  });

  chkAll.addEventListener('change', () => {
    // Only toggle VISIBLE (non-filtered) tiles
    const visTiles = [...mlist.querySelectorAll('.mi')].filter(t => t.style.display !== 'none');
    if (chkAll.checked) {
      visTiles.forEach(t => {
        deselected.delete(Number(t.dataset.idx));
        t.className = 'mi sel';
        t.querySelector('.mi-chk').checked = true;
      });
    } else {
      visTiles.forEach(t => {
        deselected.add(Number(t.dataset.idx));
        t.className = 'mi desel';
        t.querySelector('.mi-chk').checked = false;
      });
    }
    updateSelInfo();
  });

  // ── Storage change listener ───────────────────────────────────────────────
  cc(() => chrome.storage.onChanged.addListener((changes, area) => {
    if (!_valid || area !== 'local') return;
    try {
      if ('detectedCount' in changes || 'status' in changes) {
        cc(() => chrome.storage.local.get(['detectedCount','status'], r => {
          if (!_valid) return;
          applyStatus(r.status || 'idle', r.detectedCount || 0);
        }));
      }
      if ('galleryUrls' in changes) {
        renderGrid(changes.galleryUrls.newValue || []);
      }
      if ('zipProgress' in changes) applyZipProgress(changes.zipProgress.newValue);
    } catch (e) {
      if (String(e?.message).includes('Extension context')) _valid = false;
    }
  }));


  // ── Selected items ────────────────────────────────────────────────────────
  function getSelected() {
    return galleryItems.filter((_, i) => !deselected.has(i));
  }
  // ── Clean Data ────────────────────────────────────────────────────────────
  bClean.addEventListener('click', () => {
    // Stop any running scan
    cc(() => chrome.runtime.sendMessage({ type: 'RELAY', payload: { type: 'STOP' } }, () => {}));
    cc(() => chrome.storage.local.set(
      { galleryUrls: [], detectedCount: 0, downloadedCount: 0, status: 'idle' },
      () => { renderGrid([]); setMsg('Data cleared ✓'); }
    ));
  });
  // ── Scan ──────────────────────────────────────────────────────────────────
  bScan.addEventListener('click', () => {
    const user = pageUsername();    if (user) currentUser = user;    if (!user) { setMsg(`⚠ Navigate to ${platformName()}/username first`, true); return; }
    cc(() => chrome.storage.local.set({ detectedCount: 0, status: 'running', galleryUrls: [] }));
    deselected.clear();
    renderGrid([]);
    setMsg('');
    cc(() => chrome.runtime.sendMessage(
      { type: 'RELAY', payload: { type: 'START', opts: { scroll: true, autoDownload: false, scrollDelay: 2000, username: user,
          scanVideos: wSwVid?.checked !== false, scanImages: wSwImg?.checked !== false } } },
      resp => {
        if (!_valid) return;
        if (chrome.runtime.lastError) {
          setMsg('⚠ Page not ready — refresh x.com and try again', true);
          cc(() => chrome.storage.local.set({ status: 'idle' }));
        } else if (resp?.ok === false) {
          const r = resp.reason;
          setMsg('⚠ ' + (r === 'not_profile_page' ? 'Profile pages only' : (r || 'Error')), true);
          cc(() => chrome.storage.local.set({ status: 'idle' }));
        }
      }
    ));
  });

  // ── Stop Scan ─────────────────────────────────────────────────────────────
  bStop.addEventListener('click', () => {
    cc(() => chrome.runtime.sendMessage({ type: 'RELAY', payload: { type: 'STOP' } }, () => {}));
    cc(() => chrome.storage.local.set({ status: 'stopped' }));
    setMsg('Scan stopped.');
  });

  // ── Download All ──────────────────────────────────────────────────────────
  bDlAll.addEventListener('click', () => {
    if (!galleryItems.length) { setMsg('No media — run Scan first.', true); return; }
    const user = pageUsername() || currentUser;
    setMsg(`Queuing ${galleryItems.length} download(s)…`);
    bDlAll.disabled = true;
    bStopDl.style.display = '';
    cc(() => chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_BATCH',
        items: galleryItems.map(({ url, type, tweetDate }) => ({
          url, type, username: user,
          filename: buildFilename(url, type, user, tweetDate),
        })),
      },
      resp => {
        if (!_valid) return;
        bDlAll.disabled = false;
        if (chrome.runtime.lastError) {
          setMsg('⚠ Download error', true); bStopDl.style.display = 'none';
        } else {
          setMsg(`✓ ${resp?.added || galleryItems.length} downloads queued`);
        }
      }
    ));
  });

  // ── Download Selected ─────────────────────────────────────────────────────
  bDlSel.addEventListener('click', () => {
    const items = getSelected();
    if (!items.length) { setMsg('No items selected.', true); return; }
    const user = pageUsername() || currentUser;
    setMsg(`Queuing ${items.length} selected download(s)…`);
    bDlSel.disabled = true;
    bStopDl.style.display = '';
    cc(() => chrome.runtime.sendMessage(
      {
        type: 'DOWNLOAD_BATCH',
        items: items.map(({ url, type, tweetDate }) => ({
          url, type, username: user,
          filename: buildFilename(url, type, user, tweetDate),
        })),
      },
      resp => {
        if (!_valid) return;
        bDlSel.disabled = false;
        if (chrome.runtime.lastError) {
          setMsg('⚠ Download error', true); bStopDl.style.display = 'none';
        } else {
          setMsg(`✓ ${resp?.added || items.length} selected downloaded`);
        }
      }
    ));
  });

  // ── Stop Downloads ────────────────────────────────────────────────────────
  bStopDl.addEventListener('click', () => {
    cc(() => chrome.runtime.sendMessage({ type: 'STOP_DOWNLOADS' }, resp => {
      if (!_valid) return;
      bStopDl.style.display = 'none';
      setMsg(`⛔ Stopped ${resp?.stopped || 0} download(s) + cleared queue`);
    }));
  });

  // ── ZIP Selected ───────────────────────────────────────────────────────────
  function applyZipProgress(v) {
    const { pct, done, error, reason, count, parts } = (v && typeof v === 'object') ? v : { pct: v };
    if (error) {
      zipRunning = false;
      zRow.style.display = 'none';
      zFill.style.width = '0%';
      setMsg('⚠ ZIP error: ' + (reason || 'unknown'), true);
      updateSelInfo();
    } else if (done) {
      zipRunning = false;
      zRow.style.display = 'none';
      zFill.style.width = '0%';
      const partsNote = parts > 1 ? ` in ${parts} ZIP parts` : '';
      setMsg('✅ ZIP saved! (' + count + ' files' + partsNote + ')', false);
      updateSelInfo();
    } else {
      zipRunning = true;
      zRow.style.display = '';
      zFill.style.width = (pct || 0) + '%';
      const fileLabel = file ? ` — ${file.length > 28 ? file.slice(0, 25) + '…' : file}` : '';
      zPct.textContent = `Zipping… ${pct || 0}%${fileLabel}`;
      if (file) zBar.title = `(${idx}/${total}) ${file}`;
      updateSelInfo();
    }
  }

  bZip.addEventListener('click', () => {
    cc(() => {
      const showV = wSwVid?.checked !== false;
      const showP = wSwImg?.checked !== false;
      const zipItems = getSelected().filter(it => it.type === 'video' ? showV : showP);
      if (!zipItems.length) { setMsg('No selected media matches current filter.', true); return; }
      zipRunning = true;
      updateSelInfo();
      zRow.style.display = '';
      zFill.style.width = '0%';
      zPct.textContent = 'Preparing…';
      setMsg('');
      chrome.runtime.sendMessage({
        type: 'CREATE_ZIP',
        items: zipItems,
        username: currentUser
      }, resp => {
        if (chrome.runtime.lastError || !resp?.ok) {
          setMsg('⚠ ZIP could not start', true);
          zipRunning = false;
          updateSelInfo();
          zRow.style.display = 'none';
        }
        // progress + completion arrive via storage.onChanged → applyZipProgress
      });
    });
  });

  // ── SPA navigation ────────────────────────────────────────────────────────
  let lastPath = location.pathname;
  const navObs = new MutationObserver(() => {
    if (!_valid) { navObs.disconnect(); return; }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (open) refreshProfile();
    }
  });
  navObs.observe(document.documentElement, { childList: true, subtree: true });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setMsg(text, isErr) {
    wMsg.textContent = text;
    wMsg.className   = 'msg' + (isErr ? ' err' : text.startsWith('✓') ? ' ok' : '');
    if (text && !isErr) setTimeout(() => { if (wMsg.textContent === text) wMsg.textContent = ''; }, 6000);
  }

  function buildFilename(url, type, user, tweetDate) {
    const d   = new Date();
    const now = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`;
    const dt  = (typeof tweetDate === 'string' && tweetDate.length === 8) ? tweetDate : now;
    const base = url.split('?')[0].split('/').pop() || 'media';
    return user ? `${dt}_${user}_${base}` : `${dt}_${base}`;
  }

  function p2(n) { return String(n).padStart(2, '0'); }

  // Init
  refreshStatus();
})();
