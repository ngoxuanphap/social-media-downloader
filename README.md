# Social Media Downloader

A Chrome extension that automatically detects and downloads **videos & photos** from **X (Twitter)** and **Instagram** — no third-party website needed, everything runs locally in your browser.

---

## Features

- **X (Twitter)** — Bulk download videos and photos from any profile, timeline, search, bookmarks, or likes page
- **Instagram** — Download videos and photos from posts, reels, and stories
- **Scan** button to instantly collect all media on the current page
- Filter by **Video** or **Photo** before downloading
- **Select All** or pick individual items from the gallery
- **Download All**, **Download Selected**, or **ZIP Selected** — your choice
- Live counter badge on the extension icon shows how many items are found
- Auto-scroll to load more posts automatically
- One-click **⬇** button injected directly on every video on the page
- Everything runs locally — no data sent to any server

---

## Screenshot

![Popup UI](screenshots/popup.png)

> The popup showing 70 media items found on a profile page — videos (VID) and photos (IMG) listed in a grid, ready to Download All, Download Selected, or ZIP.

---

## Installation (Chrome / Edge / Brave)

> The extension is not on the Chrome Web Store. You load it manually in **Developer Mode** — takes about 1 minute.

### Step 1 — Download the extension

**Option A — Download ZIP (easiest):**
1. Click the green **Code** button at the top of this page
2. Select **Download ZIP**
3. Extract the ZIP to any folder on your computer

**Option B — Clone with Git:**
```bash
git clone https://github.com/ngoxuanphap/social-media-downloader.git
```

### Step 2 — Enable Developer Mode in Chrome

1. Open Chrome and go to: `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)

### Step 3 — Load the extension

1. Click **Load unpacked**
2. Select the `social-media-downloader/` folder (the one containing `manifest.json`)
3. The **XMD** icon will appear in your Chrome toolbar

> **Edge:** `edge://extensions` → Developer mode ON → Load unpacked  
> **Brave:** `brave://extensions` → Developer mode ON → Load unpacked

---

## How to Use

### Step-by-step (X or Instagram)

1. **Navigate** to the page you want to download from (see supported pages below)
2. **Click the XMD icon** in your toolbar to open the popup
3. **Click Scan** — the extension scans the current page and displays all detected media in a grid
4. The counter at the top right shows **N found** (e.g. `70 found`)
5. **Filter** what you want:
   - Click **Video** to show only videos
   - Click **Photo** to show only photos
   - Leave both active to see everything
6. **Select** what to download:
   - Check **Select All** to select everything
   - Or click individual thumbnails to select/deselect
7. **Choose your download action:**

   | Button | What it does |
   |--------|-------------|
   | **Download All (N)** | Downloads every detected item immediately |
   | **Download Selected (N)** | Downloads only the items you selected |
   | **ZIP Selected (N)** | Packages selected items into a single `.zip` file |

8. Files are saved to your Downloads folder under `XMedia/`

---

### Supported Pages

#### X (Twitter)
| Page | URL |
|------|-----|
| Home timeline | `x.com/home` |
| Profile media tab | `x.com/username/media` |
| Profile likes | `x.com/username/likes` |
| Search results | `x.com/search?q=keyword` |
| Bookmarks | `x.com/i/bookmarks` |

#### Instagram
| Page | URL |
|------|-----|
| A post | `instagram.com/p/POSTID` |
| A reel | `instagram.com/reel/REELID` |
| A profile | `instagram.com/username` |
| Stories | Captured automatically as you view them |

> **Note:** You must be **logged in** to X and Instagram for the extension to detect media.

---

### One-Click Download Button

A floating **⬇** button is injected directly onto every video element visible on the page.  
Click it to download that specific video immediately without opening the popup.

The **XMD** badge on the left edge of the screen shows a live count of all media detected so far on the current page.

---

## File Structure

```
social-media-downloader/
├── manifest.json          Chrome MV3 manifest
├── background.js          Service worker — manages the download queue
├── content.js             Injected script — UI, scroll engine, messaging
├── widget.js              Floating ⬇ button on videos
├── popup.html             Extension popup window
├── popup.js               Popup logic and controls
├── styles.css             Dark-mode styles
├── jszip.min.js           ZIP bundling library
└── interceptors/
    ├── twitter.js         Intercepts X/Twitter GraphQL API → extracts media URLs
    └── instagram.js       Intercepts Instagram API → extracts video/photo URLs
```

---

## How It Works (Technical)

```
X.com or Instagram page
  │
  ├─ interceptors/twitter.js (or instagram.js) — MAIN world
  │     Patches window.fetch + XMLHttpRequest
  │     Reads API responses, extracts highest-bitrate MP4 / full-res photos
  │     Dispatches URLs via CustomEvent → content.js
  │
  └─ content.js — ISOLATED world
        Receives media URLs, deduplicates, injects ⬇ buttons
        Drives the auto-scroll engine
              │
              └─ background.js (Service Worker)
                    Sequential download queue
                    chrome.downloads.download() → XMedia/ folder
```

The extension **never sends your data anywhere**. It only reads the API responses your browser already receives from X and Instagram.

---

## Permissions Explained

| Permission | Why it's needed |
|-----------|----------------|
| `downloads` | Save files to your Downloads folder |
| `storage` | Remember your settings (auto-scroll, auto-download) |
| `activeTab` | Interact with the current tab |
| `scripting` | Inject interceptor and UI scripts into the page |
| `declarativeNetRequest` | Modify request headers for media downloads |

---

## Troubleshooting

**Videos are not detected**
- Make sure you are logged in to X or Instagram
- Reload the page after installing or updating the extension
- Try disabling other extensions that block network requests (uBlock Origin, etc.)

**Download button doesn't appear on a video**
- The button only shows on `<video>` elements — photos use the popup gallery
- Try scrolling the post fully into view and waiting a moment

**Files are not saving**
- Check Chrome has permission to download files: `chrome://settings/downloads`
- Make sure a download location is configured

---

## Privacy

This extension:
- Does **not** collect any personal data
- Does **not** send anything to any external server
- Only accesses `x.com`, `twitter.com`, and `instagram.com` (as declared in `manifest.json`)
- All processing happens 100% locally in your browser

---

## License

MIT — free to use, modify, and distribute.

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss what you would like to change.


