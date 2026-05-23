# X Media Downloader

A Chrome extension that automatically detects and downloads **videos & photos** from **X (Twitter)** and **Instagram** — no third-party website needed, everything runs locally in your browser.

---

## Features

- **X (Twitter)** — Download videos and photos from timeline, profile, search, bookmarks, and likes
- **Instagram** — Download videos and photos from posts, reels, and stories
- Auto-scroll to bulk-collect media without clicking anything
- One-click download button injected directly on every video
- Saves files organized into a local `XMedia/` folder
- Works completely offline — no data sent to any server
- Dark-mode popup UI with gallery view and download history

---

## Screenshots

> *(Add screenshots of the popup and download button here)*

---

## Installation (Chrome / Edge / Brave)

> The extension is not on the Chrome Web Store. You load it manually in **Developer Mode** — takes about 1 minute.

### Step 1 — Download the extension

**Option A — Download ZIP:**
1. Click the green **Code** button on the GitHub repo page
2. Select **Download ZIP**
3. Extract the ZIP to any folder on your computer

**Option B — Clone with Git:**
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

### Step 2 — Enable Developer Mode in Chrome

1. Open Chrome and navigate to: `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)

### Step 3 — Load the extension

1. Click **Load unpacked**
2. Select the `social-media-downloader/` folder (the one that contains `manifest.json`)
3. The **X Media Downloader** icon will appear in your Chrome toolbar

> **Edge:** Go to `edge://extensions` → turn on **Developer mode** → **Load unpacked**
> **Brave:** Go to `brave://extensions` → turn on **Developer mode** → **Load unpacked**

---

## How to Use

### Downloading from X (Twitter)

1. Go to any X page:
   - Home feed: `x.com/home`
   - Profile media tab: `x.com/username/media`
   - Search results: `x.com/search?q=keyword`
   - Bookmarks: `x.com/i/bookmarks`
   - Likes: `x.com/username/likes`

2. Click the **X Media Downloader** icon in your toolbar to open the popup

3. Configure options:

   | Option | Description |
   |--------|-------------|
   | **Auto-scroll** | Automatically scrolls the page to load more posts |
   | **Auto-download** | Downloads every detected video/photo automatically |

4. Click **Start** — the extension will collect and download all detected media

5. Files are saved to your Downloads folder under `XMedia/`

---

### Downloading from Instagram

1. Go to any Instagram page:
   - A post: `instagram.com/p/XXXXX`
   - A reel: `instagram.com/reel/XXXXX`
   - A profile: `instagram.com/username`
   - Stories are captured automatically as you view them

2. Open the popup and click **Start**

3. The extension captures the media URL in real time and queues the download

> **Note:** You must be logged in to Instagram for the extension to work.

---

### One-Click Download Button

A floating **⬇** button appears on every video visible on the page.
Click it to download that specific video immediately, without running a full scrape.

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


