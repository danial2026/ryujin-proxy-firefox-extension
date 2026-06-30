# Technical Documentation

## Architecture Overview

Ryujin Proxy is a Firefox Manifest V2 extension built with vanilla JavaScript. It uses a persistent background service worker that configures proxy routing via `browser.proxy.onRequest`, manages per-tab routing, tracks data usage, and handles URL filtering.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Firefox Browser                           │
│                                                                  │
│   ┌─────────────────┐    ┌────────────────┐    ┌────────────┐   │
│   │    Popup UI      │    │   Options UI   │    │ Changelog  │   │
│   │   (popup.js)     │    │  (options.js)  │    │  (standalone)│  │
│   │ 380px, popup     │    │ full settings  │    │   page     │   │
│   └────────┬─────────┘    └───────┬────────┘    └────────────┘   │
│            │                      │                              │
│            └──────────┬───────────┘                              │
│                       ▼                                          │
│              ┌──────────────────┐                                │
│              │  Background SW   │                                │
│              │ (background.js)  │                                │
│              │ persistent: true │                                │
│              └─────────┬────────┘                                │
│                        │                                         │
│     ┌──────────────────┼──────────────────┐                      │
│     ▼                  ▼                  ▼                      │
│ ┌──────────┐    ┌───────────┐    ┌───────────────┐              │
│ │proxy.on  │    │ webRequest│    │   storage     │              │
│ │Request   │    │ onBefore- │    │   .local      │              │
│ │(routing) │    │ Request/  │    │               │              │
│ │          │    │ onHeaders │    │               │              │
│ │socks +   │    │ Received  │    │ persist all   │              │
│ │auth      │    │ (tracking)│    │ state         │              │
│ └──────────┘    └───────────┘    └───────────────┘              │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              Content Script (content.js)                  │   │
│   │  Runs at document_start on <all_urls>                    │   │
│   │  Currently only relays STATE_CHANGED to local storage    │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Component Details

### Background Service Worker (`src/background/background.js`)

The core of the extension. Runs persistently and handles:

| Module | Responsibility |
|--------|----------------|
| **Proxy Routing** | Routes traffic via `browser.proxy.onRequest` listener returning socks config per-request |
| **Ping Override** | Temporarily overrides proxy routing for ping tests without disrupting active connection |
| **Tab Routing** | Tracks which tabs should route through proxy via `tabRouting` Map |
| **Data Tracking** | Monitors sent/received bytes via `webRequest` API (onBeforeRequest + onHeadersReceived) |
| **URL Filtering** | Blocks/allows requests via `checkUrlFilters` inside the `proxy.onRequest` handler |
| **Logging** | Maintains a capped (500 entry) in-memory log array persisted to storage |
| **Ping History** | Stores per-proxy ping results with latency, method, and timestamp |
| **Storage** | Persists all state via `browser.storage.local` |

#### Key Architecture: Proxy Routing via Listener

Unlike many proxy extensions that use `browser.proxy.settings.set()`, Ryujin uses the `browser.proxy.onRequest` event listener. This allows per-request routing decisions, ping override without disrupting the active proxy, and URL filter integration.

```
┌─────────────────────────────────────────────────────────────────┐
│                    proxy.onRequest Flow                          │
│                                                                  │
│  Firefox makes request                                           │
│         │                                                        │
│         ▼                                                        │
│  proxy.onRequest listener fires                                  │
│         │                                                        │
│         ├──► No active proxy? ─────────────► return {type:'direct'}│
│         │                                                        │
│         ├──► Ping override matches URL? ───► return socks with   │
│         │                                      override creds    │
│         │                                                        │
│         ├──► Blacklist blocks? ────────────► return {type:'direct'}│
│         │                                                        │
│         ├──► Whitelist enabled + not on it?► return {type:'direct'}│
│         │                                                        │
│         ├──► routeAllTabs=false + tab not    │                   │
│         │    in tabRouting? ───────────────► return {type:'direct'}│
│         │                                                        │
│         └──► Found proxy? ─────────────────► return socks config │
│                                                with auth if set  │
└─────────────────────────────────────────────────────────────────┘
```

#### Key Functions

```javascript
// Proxy routing is done via event listener, not settings.set()
browser.proxy.onRequest.addListener((details) => {
  if (!activeProxyId) return { type: 'direct' };

  // Ping override: route only the test URL through specific proxy
  if (_pingOverride && _pingOverride.testUrl === details.url) {
    return { type: 'socks', host, port, ...(username && { username }), ...(password && { password }) };
  }

  // URL filtering check
  if (settings.blacklistEnabled || settings.whitelistEnabled) {
    const decision = checkUrlFilters(details.url);
    if (settings.blacklistEnabled && decision.cancel) return { type: 'direct' };
    if (settings.whitelistEnabled && !onWhitelist) return { type: 'direct' };
  }

  // Tab routing check
  if (!settings.routeAllTabs && !tabRouting.get(details.tabId)) {
    return { type: 'direct' };
  }

  // Return proxy config
  const proxy = proxies.find(p => p.id === activeProxyId);
  return { type: 'socks', host: proxy.host, port: proxy.port,
    ...(proxy.username && { username: proxy.username }),
    ...(proxy.password && { password: proxy.password }) };
}, { urls: ['<all_urls>', 'ws://*/*', 'wss://*/*'] });

// Track bandwidth per proxy
function trackDataUsage(tabId, bytes, direction) {
  if (!activeProxyId) return;
  const current = dataUsage.get(activeProxyId) || { sent: 0, received: 0 };
  current[direction] += bytes;
  dataUsage.set(activeProxyId, current);
  saveDataUsage();
}
```

### Popup (`src/popup/`)

Lightweight UI for quick proxy switching (380px wide).

**State Management:**
```javascript
let state = {
  proxies: [],
  activeProxyId: null,
  tabRouting: {},
  urlFilters: { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] },
  settings: {
    routeAllTabs: true, showNotifications: true, dataTrackingEnabled: true,
    pingMethod: 'GET', pingUrl: 'https://www.google.com/generate_204',
    expectedHttpStatus: 204
  }
};
```

**Message Passing:**
```javascript
// Request full state from background
browser.runtime.sendMessage({ type: 'GET_STATE' });

// Set active proxy
browser.runtime.sendMessage({ type: 'SET_ACTIVE_PROXY', id: proxyId });

// Ping a proxy
browser.runtime.sendMessage({ type: 'PING_PROXY', proxyId, method, url, httpMethod });

// Listen for background updates
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_CHANGED') renderAll();
});
```

**UI Components:**
- Proxy list with inline ping, edit, delete actions
- Active proxy status with sent/received data stats
- Tab routing list with per-tab toggles (disabled when routeAllTabs is on)
- Add/Edit proxy modal form
- Delete proxy confirmation modal
- Settings button opens options page in new tab

### Options Page (`src/options/`)

Full settings interface opened from popup gear icon → opens in its own tab.

```
┌─────────────────────────────────────────────────────┐
│              Options Page Layout                      │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Header: Logo | App Name | [Changelog][License]  │ │
│  │         [GitHub]                                 │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Filter Tabs: [Whitelist][Blacklist]            │ │
│  │                [Regex Whitelist][Regex Blacklist]│ │
│  │                [Logs]                           │ │
│  │                                                 │ │
│  │  Active Panel:                                  │ │
│  │  ┌─ List ───────────────────────────────┐       │ │
│  │  │  [description text]         [+ Add]  │       │ │
│  │  │  ┌──────────────────────────┐        │       │ │
│  │  │  │ example.com       [✏][🗑]│        │       │ │
│  │  │  │ sub.example.com    [✏][🗑]│        │       │ │
│  │  │  └──────────────────────────┘        │       │ │
│  │  └──────────────────────────────────────┘       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Settings:                                       │ │
│  │  ┌─ Data Tracking ──── [toggle] ──────────────┐ │ │
│  │  ├─ Notifications ──── [toggle] ──────────────┤ │ │
│  │  ├─ Ping Method ────── [HTTP Method select] ────┤ │ │
│  │  ├─ Ping URL ───────── [text input] ──────────┤ │ │
│  │  ├─ Expected HTTP Status ── [number input] ───┤ │ │
│  │  ├─ Whitelist Filter ── [toggle] ─────────────┤ │ │
│  │  └─ Blacklist Filter ── [toggle] ─────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Danger Zone:  [Reset Data] [Reset All]         │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Four-tab filter system (whitelist, blacklist, regex whitelist, regex blacklist)
- Live regex testing with match/no-match feedback
- Settings toggles with immediate persistence via `UPDATE_SETTINGS`
- Ping method/URL/expected status configuration
- Whitelist/blacklist enable toggles
- Activity log viewer with level-based filtering (all, info, success, warning, error)
- Clear logs functionality
- Danger zone with reset data usage and factory reset
- Changelog and license viewers

### Content Script (`src/content/content.js`)

Runs on all pages at `document_start`. Currently minimal — only listens for `STATE_CHANGED` messages and persists URL filters to local storage.

```javascript
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_CHANGED') {
    if (message.state && message.state.urlFilters) {
      browser.storage.local.set({ ryujin_url_filters: message.state.urlFilters });
    }
  }
});
```

### Changelog Page (`src/options/changelog.html`, `src/options/changelog.js`)

Standalone page that renders CHANGELOG.md into styled HTML. Parses markdown version headers (`## [x.x.x] - date`) and change type headings (`### Added|Changed|Fixed|Removed`).

### Storage Utilities (`src/utils/storage.js`)

Centralized storage abstraction with validation helpers. Not directly imported by background.js (which duplicates the pattern inline).

```javascript
export const STORAGE_KEYS = {
  PROXIES: 'ryujin_proxies',
  ACTIVE_PROXY: 'ryujin_active_proxy',
  TAB_ROUTING: 'ryujin_tab_routing',
  DATA_USAGE: 'ryujin_data_usage',
  URL_FILTERS: 'ryujin_url_filters',
  SETTINGS: 'ryujin_settings',
  PING_HISTORY: 'ryujin_ping_history',
  LOGS: 'ryujin_logs'
};

export function validateProxyConfig(proxy) { /* name, host, port validation */ }
export function testUrlAgainstFilters(url, filters) { /* regex+domain filter chain */ }
export function validateRegex(pattern) { /* try/catch RegExp constructor */ }
```

## Data Flow

### Proxy Activation
```
User clicks proxy in popup
       │
       ▼
popup.js: sendMessage('SET_ACTIVE_PROXY', { id })
       │
       ▼
background.js: setActiveProxy(id)
       │
       ├─► Updates activeProxyId in memory
       │
       ├─► browser.storage.local.set({ ryujin_active_proxy: id })
       │
       └─► broadcastStateChange() ──► Notify all UIs
       │
       ▼
Popup receives STATE_CHANGED → renderAll() → UI updates instantly

Subsequent requests hit proxy.onRequest which checks activeProxyId
```

### Connection Ping Flow
```
User clicks ping button on proxy
        │
        ▼
popup.js: sendMessage('PING_PROXY', { proxyId, method, url, httpMethod })
        │
        ▼
background.js: pingProxy(proxyId, method, url, httpMethod)
        │
        ├─► Sets _pingOverride = { host, port, username, password, testUrl }
        │       (This makes proxy.onRequest route ONLY the ping URL
        │        through the specified proxy, without changing the
        │        active proxy setting — avoiding connection disruption)
        │
        ├─► await fetch(pingUrl, { method: httpMethod }) routes through override
        │       └─► HTTP method (GET/HEAD/POST/PUT/DELETE/OPTIONS): validates response status
        │
        ├─► Clears _pingOverride
        │
        ├─► Saves ping result to ryujin_ping_history
        │
        └─► broadcastStateChange() → UI shows latency + timestamp
```

### Tab Routing
```
Tab loads / activates
       │
       ▼
proxy.onRequest fires for each request
       │
       ▼
Check order:
  1. Is activeProxyId set?
  2. Is this a ping override URL?
  3. Is URL blacklisted?
  4. Is whitelist enabled and URL not on it?
  5. Is routeAllTabs=false AND tab not in tabRouting map?
  6. Found proxy? → return socks config
```

### Data Tracking
```
Request sent
       │
       ▼
webRequest.onBeforeRequest (blocking)
       │
       ▼
shouldTrackRequest(details) → tabId > 0 && (routeAllTabs || tabRouting)
       │
       ▼
trackDataUsage(tabId, requestBody.length, 'sent')


Response received
       │
       ▼
webRequest.onHeadersReceived
       │
       ▼
shouldTrackRequest(details) → same check
       │
       ▼
Reads Content-Length header
       │
       ▼
trackDataUsage(tabId, contentLength, 'received')


dataUsage Map in memory:
  activeProxyId → { sent: number, received: number }

Debounced persistence to ryujin_data_usage in storage
UI receives updated state via broadcastStateChange()
```

### URL Filtering (in proxy.onRequest)
```
Request enters proxy.onRequest listener
       │
       ▼
checkUrlFilters(url) in background.js
       │
       ├─► blacklistEnabled?
       │     ├─► regexBlacklist match? → return { cancel: true } (route direct)
       │     └─► blacklist domain match? → return { cancel: true } (route direct)
       │
       ├─► whitelistEnabled?
       │     ├─► regexWhitelist match? → allow (continue routing)
       │     ├─► whitelist has entries AND URL not on any? → return { cancel: true }
       │     └─► on whitelist? → allow
       │
       └─► return { cancel: false } → continue normal routing
```

### Logging System
```
Any component calls addLog(level, message)
       │
       ▼
background.js: addLog()
       │
       ├─► Creates log entry { level, message, timestamp }
       ├─► Appends to in-memory logs[] (capped at 500)
       ├─► Persists to ryujin_logs in storage
       └─► Broadcasts LOG_ENTRY to all UI frames
       │
       ▼
Options page receives LOG_ENTRY → addLog() → renderLogs()
Filtered by level: all | info | success | warning | error
```

## Storage Schema

```json
{
  "ryujin_proxies": [
    {
      "id": "proxy_123_abc",
      "name": "My Proxy",
      "host": "127.0.0.1",
      "port": 1080,
      "username": "user",
      "password": "pass",
      "createdAt": 1719580800000
    }
  ],
  "ryujin_active_proxy": "proxy_123_abc",
  "ryujin_tab_routing": {
    "123": true,
    "456": false
  },
  "ryujin_data_usage": {
    "proxy_123_abc": { "sent": 1024000, "received": 5120000 }
  },
  "ryujin_url_filters": {
    "whitelist": ["example.com"],
    "blacklist": ["ads.example.com"],
    "regexWhitelist": ["^https?://.*\\.cdn\\..*$"],
    "regexBlacklist": ["^https?://.*\\.tracking\\..*$"]
  },
  "ryujin_settings": {
    "routeAllTabs": true,
    "showNotifications": true,
    "dataTrackingEnabled": true,
    "pingMethod": "GET",
    "pingUrl": "https://www.google.com/generate_204",
    "expectedHttpStatus": 204,
    "whitelistEnabled": false,
    "blacklistEnabled": false
  },
  "ryujin_ping_history": {
    "proxy_123_abc": {
      "success": true,
      "latency": 123,
      "method": "GET",
      "timestamp": 1719580800000,
      "error": null
    }
  },
  "ryujin_logs": [
    {
      "level": "info",
      "message": "Background service initialized",
      "timestamp": 1719580800000
    }
  ]
}
```

## Permissions Breakdown

| Permission | Required For |
|------------|--------------|
| `proxy` | SOCKS5 routing via `browser.proxy.onRequest` |
| `tabs` | Tab querying, favicon, titles for routing UI |
| `storage` | Persist all settings, proxies, data usage, logs |
| `webRequest` | Data tracking (onBeforeRequest, onHeadersReceived) |
| `webRequestBlocking` | Synchronous request inspection for tracking |
| `<all_urls>` | Apply proxy to all websites, intercept all requests |
| `webNavigation` | Detect navigation events for tab tracking (listed in manifest permissions, not optional) |

## Build System

```bash
# Development (load manifest.json in about:debugging)
./build.sh

# Production (creates dist/ryujin-proxy-v{version}.xpi and .zip)
./build.sh --prod

# Lint manifest
npm run lint
```

**Build Process:**
1. Detects version from `manifest.json`
2. Development: prints instructions for temporary add-on loading
3. Production:
   - Creates temp directory with only extension files (`manifest.json`, `src/`, `assets/`, `CHANGELOG.md`)
   - Runs `web-ext build` on clean source
   - Renames output to `ryujin-proxy-v{version}.xpi` and copies as `.zip`
   - Places both in `dist/`

## Design System

### Colors
```css
:root {
  --bg: #000000;        /* Pure black background */
  --surface: #0A0A0A;   /* Near-black cards */
  --surface-hover: #111111;
  --border: #1A1A1A;    /* Subtle borders */
  --border-hover: #333333;
  --primary: #FFFFFF;   /* Pure white primary */
  --primary-text: #000000;
  --text: #FFFFFF;
  --text-secondary: #AAAAAA;
  --text-muted: #888888;
  --success: #00FF88;   /* Neon green */
  --warning: #FFCC00;   /* Caution yellow */
  --error: #FF3366;     /* Pink-red */
}
```

### Typography
- **UI:** Inter (900 weight for headers, 600 for body)
- **Data / Code:** Monaco / Menlo / Ubuntu Mono / SF Mono / Fira Code

### Spacing Scale
- Micro: 4px
- Base: 8px
- Double: 16px
- Quad: 32px

### Interaction
- All transitions: 150ms ease
- Hover: border color transitions, background changes
- Selected: white border (1px), background tint
- Focus: 2px white outline

## API Reference

### Messages (Popup/Options → Background)

| Type | Payload | Response |
|------|---------|----------|
| `GET_STATE` | `{}` | Full state object |
| `ADD_PROXY` | `{ proxy: {name, host, port, username?, password?} }` | `{ success, proxy }` |
| `UPDATE_PROXY` | `{ proxyId, proxy: {...} }` | `{ success, proxy }` |
| `REMOVE_PROXY` | `{ id }` | `{ success }` |
| `SET_ACTIVE_PROXY` | `{ id }` (null to disconnect) | `{ success }` |
| `TOGGLE_TAB_ROUTING` | `{ tabId }` | `{ success, routing }` |
| `SET_ROUTE_ALL_TABS` | `{ enabled }` | `{ success }` |
| `ADD_URL_FILTER` | `{ filter: {type, value, isRegex} }` | `{ success }` |
| `REMOVE_URL_FILTER` | `{ filterType, index }` | `{ success }` |
| `UPDATE_URL_FILTERS` | `{ urlFilters }` | `{ success }` |
| `UPDATE_SETTINGS` | `{ settings }` | `{ success }` |
| `RESET_DATA_USAGE` | `{ proxyId? }` | `{ success }` |
| `CLEAR_LOGS` | `{}` | `{ success }` |
| `GET_TABS` | `{}` | `{ tabs[] }` |
| `PING_PROXY` | `{ proxyId, method?, url?, httpMethod? }` | `{ success, latency, method }` |

### Messages (Background → UI)

| Type | Payload |
|------|---------|
| `STATE_CHANGED` | Full state object |
| `LOG_ENTRY` | `{ level, message }` |

## Events (Background → UI)

| Type | Payload | Description |
|------|---------|-------------|
| `STATE_CHANGED` | `{ state: {...} }` | Full state broadcast after any mutation |
| `LOG_ENTRY` | `{ level, message }` | Real-time log entry for options page |

## Known Code Issues

### Duplicate `_pingOverride` Declaration (background.js:37-38)
```javascript
let _pingOverride = null;
let _pingOverride = null;  // Duplicate — second declaration shadows first
```
The `_pingOverride` variable is declared twice. While JavaScript allows this in non-strict mode (the second `let` would throw in strict mode), the actual code uses an IIFE-less top-level scope. This is a no-op but should be cleaned up.

## Testing Checklist

### Proxy Management
- [ ] Add proxy with auth → connects successfully
- [ ] Click proxy → activates immediately (green dot with glow)
- [ ] Switch proxy → requests route through new proxy
- [ ] Disconnect → requests go direct
- [ ] Edit proxy → fields pre-filled, saves correctly
- [ ] Delete proxy → confirmation modal, removes from list

### Tab Routing
- [ ] Route all tabs toggle → all tabs apply/remove
- [ ] Per-tab toggle → individual tab routes correctly (checkbox disabled when routeAllTabs is on)
- [ ] Tab list shows favicon, title, hostname

### Data Tracking
- [ ] Data usage increments in real time (sent/received)
- [ ] Data persists after popup close/reopen
- [ ] Reset data usage → counters zero

### URL Filtering
- [ ] Whitelist domain → bypasses proxy
- [ ] Blacklist domain → blocks completely
- [ ] Regex filters → match correctly (test with tester)
- [ ] Whitelist/blacklist enable toggles work independently
- [ ] Filters persist after browser restart

### Ping Tests
- [ ] Ping button → shows spinner during test
- [ ] Successful ping → shows latency in popup with green text
- [ ] Failed ping → shows error message with red text
- [ ] TCP method works
- [ ] HTTP method validates expected status code
- [ ] Ping does not disrupt active proxy connection
- [ ] Ping history persists and displays timestamp

### Settings Persistence
- [ ] All settings survive browser restart
- [ ] Reset all → clean slate (proxies, filters, data, logs)

### Logs
- [ ] Activity logs show entries with color-coded levels
- [ ] Log filter buttons (all/info/success/warning/error) work correctly
- [ ] Clear logs removes all entries

### UI/UX
- [ ] Popup opens at 380px width
- [ ] Empty states shown when no proxies/no tabs
- [ ] Modals open with animation, close on Escape
- [ ] Hover effects on proxy items, buttons
- [ ] Scrollbar styling in proxy list and tab list

### Changelog
- [ ] Changelog page renders all versions with grouped changes
- [ ] Version links to GitHub releases
- [ ] Back to Settings link works

## Troubleshooting

### Proxy not connecting
1. Verify host:port reachable (use ping button)
2. Check Firefox proxy settings not conflicting (about:preferences#general)
3. Check `browser.proxy.onError` in background console

### Data not tracking
1. Ensure `dataTrackingEnabled` is true in settings
2. Check `webRequest` permissions granted
3. Verify tab is actually routed (routeAllTabs or per-tab toggle)

### URL filters not working
1. Check regex syntax in the tester
2. Verify filter type (whitelist vs blacklist)
3. Ensure the corresponding enable toggle is on

### Ping test failing
1. Verify proxy is reachable from your network
2. Check expected HTTP status matches what the endpoint returns
3. Try TCP method instead of HTTP
4. Ensure proxy supports the ping URL

### Icon not showing in about:addons
- Manifest `icons` object must reference existing files
- PNG files in `assets/icons/` must be valid
- 16, 32, 48, 128 sizes required

### Extension not loading
- Firefox 91.1.0+ required (strict_min_version)
- Manifest V2 must be enabled in about:config (`extensions.manifestV2.enabled`)
- Check browser console for syntax errors

---

*Generated for Ryujin Proxy v0.0.10*
