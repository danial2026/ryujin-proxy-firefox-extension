# Technical Documentation

## Architecture Overview

Ryujin Proxy is a Firefox Manifest V2 extension built with vanilla JavaScript (no frameworks or build tools). It uses a persistent background script that configures proxy routing via `browser.proxy.onRequest`, manages per-tab routing, tracks data usage, and handles URL filtering.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Firefox Browser                              │
│                                                                      │
│   ┌──────────────────────┐      ┌──────────────────────────────┐    │
│   │       Popup UI        │      │        Options Page           │    │
│   │    (popup.html/js)    │      │    (options.html/js)          │    │
│   │    380px popup        │      │    full settings page          │    │
│   │                      │      │    ├─ Filter tabs (5 panels)   │    │
│   │   Proxy list          │      │    ├─ Settings grid            │    │
│   │   Active proxy stats  │      │    ├─ Changelog modal          │    │
│   │   Tab routing list    │      │    └─ Danger zone              │    │
│   │   Add/Edit modals     │      │                              │    │
│   └──────────┬───────────┘      └──────────────┬───────────────┘    │
│              │                                  │                    │
│              └──────────────┬───────────────────┘                    │
│                             ▼                                        │
│              ┌──────────────────────────────┐                        │
│              │      Background Script       │                        │
│              │    (background.js)            │                        │
│              │    persistent: true            │                        │
│              │                               │                        │
│              │  State (in-memory):            │                        │
│              │    proxies[], activeProxyId    │                        │
│              │    tabRouting Map, dataUsage   │                        │
│              │    urlFilters, settings        │                        │
│              │    pingHistory{}, logs[]       │                        │
│              │    _pingOverride               │                        │
│              └──────────────┬─────────────────┘                        │
│                             │                                          │
│     ┌───────────────────────┼──────────────────────────┐               │
│     ▼                       ▼                          ▼               │
│ ┌──────────────┐   ┌───────────────────┐   ┌──────────────────────┐   │
│ │ proxy.on     │   │ webRequest        │   │ browser.storage      │   │
│ │ Request      │   │ onBeforeRequest   │   │ .local               │   │
│ │ (routing)    │   │ onHeadersReceived │   │                      │   │
│ │              │   │ (data tracking)   │   │ Persist all state   │   │
│ │ SOCKS5 +     │   │                   │   │ on every mutation    │   │
│ │ auth return  │   │                   │   │                      │   │
│ └──────────────┘   └───────────────────┘   └──────────────────────┘   │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │         Content Script (content.js)                          │   │
│   │  Runs at document_start on <all_urls>, all_frames: true      │   │
│   │  Persists urlFilters to storage on STATE_CHANGED             │   │
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Background Script (`src/background/background.js`)

The core of the extension. Runs persistently and handles:

| Module | Responsibility |
|--------|----------------|
| **Proxy Routing** | Routes traffic via `browser.proxy.onRequest` listener returning SOCKS5 config per-request |
| **Ping Override** | Temporarily overrides proxy routing for HTTP ping tests without disrupting active connection |
| **Tab Routing** | Tracks which tabs should route through proxy via `tabRouting` Map |
| **Data Tracking** | Monitors sent/received bytes via `webRequest` API (onBeforeRequest + onHeadersReceived) |
| **URL Filtering** | Blocks/allows requests via `checkUrlFilters` inside the `proxy.onRequest` handler |
| **Logging** | Maintains a capped (500 entry) in-memory log array persisted to storage |
| **Ping History** | Stores per-proxy ping results with latency, method, and timestamp |
| **Storage** | Persists all state via `browser.storage.local` |

#### Initialization Flow

```
init()
  │
  ├─► loadAllData()
  │      ├─► browser.storage.local.get([ALL_KEYS])
  │      ├─► Assign proxies, activeProxyId, tabRouting, dataUsage
  │      ├─► Assign urlFilters, settings (merge with defaults), pingHistory, logs
  │      └─► addLog('info', 'Background service initialized')
  │
  ├─► setupProxyRequestListener()
  │      └─► browser.proxy.onRequest.addListener(...)
  │
  ├─► setupWebRequestListener()
  │      └─► browser.webRequest.onBeforeRequest + onHeadersReceived
  │
  └─► setupMessageListener()
         └─► browser.runtime.onMessage.addListener(...)
```

#### Proxy Routing via Listener

Unlike many proxy extensions that use `browser.proxy.settings.set()`, Ryujin uses the `browser.proxy.onRequest` event listener. This allows per-request routing decisions, ping override without disrupting the active proxy, and URL filter integration.

```
proxy.onRequest Flow
══════════════════════════════════════════════════════════════════════

  Request from Firefox
         │
         ▼
  ┌──────────────────┐
  │ Ping override    │────► Yes ──► Return SOCKS config with override creds
  │ (_pingOverride)  │           (routes ONLY the ping URL through test proxy)
  └──────────────────┘
         │ No
         ▼
  ┌──────────────────┐
  │ activeProxyId    │────► null ──► Return { type: 'direct' }
  │ set?             │
  └──────────────────┘
         │ Yes
         ▼
  ┌──────────────────┐
  │ Blacklist check  │────► Blocked ──► Return { type: 'direct' }
  │ (if enabled)     │
  └──────────────────┘
         │ Not blocked
         ▼
  ┌──────────────────┐
  │ Whitelist check  │────► Not on whitelist ──► Return { type: 'direct' }
  │ (if enabled)     │
  └──────────────────┘
         │ On whitelist (or disabled)
         ▼
  ┌──────────────────────┐
  │ Tab routing check    │────► routeAllTabs=false AND tab not in
  │                       │       tabRouting Map ──► { type: 'direct' }
  └──────────────────────┘
         │ Routed
         ▼
  ┌──────────────────┐
  │ Return SOCKS5    │
  │ config with      │
  │ optional auth    │
  └──────────────────┘
```

#### Key Code: Proxy Routing

```javascript
browser.proxy.onRequest.addListener(
  (details) => {
    // Ping override — highest priority
    if (_pingOverride && _pingOverride.testUrl === details.url) {
      return { type: 'socks', host, port, ...(username && { username }), ...(password && { password }) };
    }
    // No active proxy
    if (!activeProxyId) return { type: 'direct' };
    // URL filter checks
    if (settings.blacklistEnabled || settings.whitelistEnabled) {
      const decision = checkUrlFilters(details.url);
      if (settings.blacklistEnabled && decision.cancel) return { type: 'direct' };
      if (settings.whitelistEnabled) {
        const onWhitelist = regexWhitelist.some(...) || whitelist.some(w => details.url.includes(w));
        if (!onWhitelist) return { type: 'direct' };
      }
    }
    // Tab routing
    if (!settings.routeAllTabs && !tabRouting.get(details.tabId)) {
      return { type: 'direct' };
    }
    // Found proxy → return SOCKS config
    const proxy = proxies.find(p => p.id === activeProxyId);
    if (!proxy) return { type: 'direct' };
    return { type: 'socks', host: proxy.host, port: proxy.port, ... };
  },
  { urls: ['<all_urls>', 'ws://*/*', 'wss://*/*'] }
);
```

#### Key Code: Data Tracking

```javascript
function setupWebRequestListener() {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (settings.dataTrackingEnabled && shouldTrackRequest(details)) {
        trackDataUsage(details.tabId, requestBodyLength, 'sent');
      }
      return { cancel: false };
    },
    { urls: ['<all_urls>'] },
    ['blocking', 'requestBody']
  );

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (settings.dataTrackingEnabled && shouldTrackRequest(details)) {
        const header = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length');
        if (header) trackDataUsage(details.tabId, parseInt(header.value), 'received');
      }
      return {};
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}
```

### Popup (`src/popup/`)

Lightweight 380px-wide UI for quick proxy switching and status monitoring.

**State managed locally:**
```javascript
let state = {
  proxies: [],
  activeProxyId: null,
  tabRouting: {},
  urlFilters: { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] },
  settings: { routeAllTabs: true, showNotifications: true, dataTrackingEnabled: true }
};
```

**UI Sections:**
1. **Header** — App title + settings gear button (opens options page in new tab)
2. **Proxy List** — Each item shows name, host:port, ping history status, and action buttons (ping, edit, delete). Clicking selects/activates the proxy.
3. **Active Proxy** — Green status indicator with glow, data usage stats (sent/received), disconnect button
4. **Tab Routing** — "Route all tabs" toggle + per-tab list with favicon, title, hostname, and individual route checkboxes
5. **Modals** — Add/Edit proxy form (name, host, port, username, password), Delete confirmation

**State Sync:** `browser.runtime.onMessage` listens for `STATE_CHANGED` from background and re-renders all sections.

### Options Page (`src/options/`)

Full settings interface opened from popup gear icon → opens in new tab.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Options Page Layout                                │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Header: [Logo] Ryujin Proxy    [Changelog] [License] [GitHub]        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Filter Tabs:  [Whitelist] [Blacklist] [Regex Whitelist]             │  │
│  │                [Regex Blacklist] [Logs]                               │  │
│  │                                                                      │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │  Active Panel (e.g., Whitelist):                              │    │  │
│  │  │  Description text                            [?]  [+ Add]    │    │  │
│  │  │  ┌────────────────────────────────────────────────────────┐   │    │  │
│  │  │  │ example.com                             [edit][delete]  │   │    │  │
│  │  │  │ sub.example.com                         [edit][delete]  │   │    │  │
│  │  │  └────────────────────────────────────────────────────────┘   │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  │                                                                      │  │
│  │  Logs Panel:                                                         │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │  [All] [Info] [Success] [Warning] [Error]    [Clear Logs]    │    │  │
│  │  │  ┌────────────────────────────────────────────────────────┐   │    │  │
│  │  │  │ 14:30:00.123  SUCCESS  Connected to proxy [My Proxy]   │   │    │  │
│  │  │  │ 14:29:00.456  INFO    Settings updated                  │   │    │  │
│  │  │  └────────────────────────────────────────────────────────┘   │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Settings:                                                            │  │
│  │  ┌─ Data Tracking ──────── [toggle] ───────────────────────────────┐ │  │
│  │  ├─ Notifications ──────── [toggle] ───────────────────────────────┤ │  │
│  │  ├─ Ping Method ────────── [GET/HEAD/POST/PUT/DELETE/OPTIONS] ─────┤ │  │
│  │  ├─ Ping URL ───────────── [text input] ───────────────────────────┤ │  │
│  │  ├─ Expected Status Code ─ [number input 204] ─────────────────────┤ │  │
│  │  ├─ Whitelist Filter ───── [toggle] ───────────────────────────────┤ │  │
│  │  └─ Blacklist Filter ───── [toggle] ───────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Danger Zone:                        [Reset Data Usage] [Reset All]  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Five-tab filter system (whitelist, blacklist, regex whitelist, regex blacklist, logs)
- Add/Edit filter entries via modal with live regex tester (shows match/no-match in real time)
- Settings toggles with immediate persistence via `UPDATE_SETTINGS`
- Ping method selection (GET, HEAD, POST, PUT, DELETE, OPTIONS)
- Ping URL and expected HTTP status configuration
- Whitelist/blacklist enable toggles
- Activity log viewer with level-based filtering (all, info, success, warning, error)
- Clear logs functionality
- Danger zone: Reset data usage (all proxies) and factory reset (clears ALL storage)
- Changelog viewer (fetches `CHANGELOG.md`, parses markdown versions, renders in modal)
- License link to GitHub

### Content Script (`src/content/content.js`)

Runs on all pages at `document_start` with `all_frames: true`. Minimal — only persists URL filters to local storage on `STATE_CHANGED` messages.

```javascript
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_CHANGED') {
    if (message.state && message.state.urlFilters) {
      browser.storage.local.set({ ryujin_url_filters: message.state.urlFilters });
    }
  }
});
```

### Storage Utilities (`src/utils/storage.js`)

Centralized storage abstraction with validation helpers. Not directly imported by background.js (which duplicates the pattern inline). Exports convenience functions for each storage key, validation utilities, and a `clearAll` function.

```javascript
export {
  STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_URL_FILTERS,
  getStorage, setStorage,
  getProxies, setProxies,
  getActiveProxyId, setActiveProxyId,
  getTabRouting, setTabRouting,
  getDataUsage, setDataUsage,
  getUrlFilters, setUrlFilters,
  getSettings, setSettings,
  clearAll, generateId, formatBytes,
  validateProxyConfig, validateRegex, testUrlAgainstFilters
};
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
       ├─► browser.storage.local.set({ ryujin_active_proxy: id })
       ├─► addLog(...)
       └─► broadcastStateChange() ──► Notify all UI frames
       │
       ▼
Popup receives STATE_CHANGED → renderAll() → UI updates instantly
```

### Proxy Disconnection

```
User clicks "Disconnect" in Active Proxy section
       │
       ▼
popup.js: sendMessage('SET_ACTIVE_PROXY', { id: null })
       │
       ▼
background.js: setActiveProxy(null)
       │
       ├─► Sets activeProxyId = null
       ├─► Persists null to storage
       ├─► addLog('warning', `Disconnected from proxy [...]`)
       └─► broadcastStateChange()
       │
       ▼
proxy.onRequest returns { type: 'direct' } for all subsequent requests
```

### Connection Ping Flow

```
User clicks ping button on proxy item
        │
        ▼
popup.js: sendMessage('PING_PROXY', { proxyId, method, url, httpMethod })
        │
        ▼
background.js: pingProxy(proxyId, method, url, httpMethod)
        │
        ├─► Sets _pingOverride = { host, port, username, password, testUrl }
        │       (routes ONLY the ping URL through the specified proxy
        │        without changing activeProxyId — no connection disruption)
        │
        ├─► await fetch(pingUrl, { method: httpMethod, signal, cache: 'no-cache' })
        │       └─► HTTP method: GET/HEAD/POST/PUT/DELETE/OPTIONS
        │       └─► Response status validated (100-599 range)
        │
        ├─► Clears _pingOverride back to null
        │
        ├─► Saves result to ryujin_ping_history in storage
        │
        └─► broadcastStateChange() → UI shows latency + timestamp
```

### Tab Routing

```
Tab loads or navigates
       │
       ▼
proxy.onRequest fires for each request
       │
       ▼
Check order:
  1. Is this a ping override URL? → route through override proxy
  2. Is activeProxyId set? → continue, else direct
  3. Is URL blacklisted (if enabled)? → direct
  4. Is whitelist enabled and URL not on it? → direct
  5. routeAllTabs=false AND tab not in tabRouting Map? → direct
  6. Found proxy? → return SOCKS5 config
```

### Data Tracking

```
Request sent (onBeforeRequest)
       │
       ▼
shouldTrackRequest(details) → tabId > 0 AND (routeAllTabs OR tab in tabRouting)
       │
       ▼
trackDataUsage(tabId, requestBody.length, 'sent')
       │
       ▼
dataUsage Map[activeProxyId].sent += bytes

Response received (onHeadersReceived)
       │
       ▼
shouldTrackRequest(details) → same check
       │
       ▼
Reads Content-Length header value
       │
       ▼
trackDataUsage(tabId, contentLength, 'received')
       │
       ▼
dataUsage Map[activeProxyId].received += bytes

Persistence: Immediate save via browser.storage.local.set
State broadcast: broadcastStateChange() updates all UI frames
```

### URL Filtering (in checkUrlFilters)

```
Request URL enters checkUrlFilters()
       │
       ▼
  ┌─────────────────────────────────────┐
  │ blacklistEnabled?                    │
  │  ├─ regexBlacklist match? → cancel  │
  │  └─ blacklist domain match? → cancel│
  └─────────────────────────────────────┘
       │ Not blocked
       ▼
  ┌─────────────────────────────────────┐
  │ whitelistEnabled?                    │
  │  ├─ regexWhitelist match? → allow   │
  │  ├─ whitelist has entries AND URL   │
  │  │  not on any? → cancel            │
  │  └─ on whitelist? → allow           │
  └─────────────────────────────────────┘
       │
       ▼
  Return { cancel: false } → continue normal routing
```

### Logging System

```
Any component calls addLog(level, message)
       │
       ▼
background.js: addLog()
       │
       ├─► Creates entry { level, message, timestamp }
       ├─► Appends to in-memory logs[] (capped at 500, FIFO)
       ├─► Persists to ryujin_logs in storage
       ├─► Broadcasts LOG_ENTRY to all UI frames
       │
       ▼
Options page receives LOG_ENTRY → addLog() → prepend to state.logs → renderLogs()
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
  ],
  "ryujin_url_filters": { "...": "..." }
}
```

## Permissions Breakdown

| Permission | Required For |
|------------|--------------|
| `proxy` | SOCKS5 routing via `browser.proxy.onRequest` |
| `tabs` | Tab querying, favicon, titles for routing UI |
| `storage` | Persist all settings, proxies, data usage, logs |
| `webRequest` | Data tracking (onBeforeRequest, onHeadersReceived) |
| `webRequestBlocking` | Synchronous request inspection with `requestBody` |
| `<all_urls>` | Apply proxy to all websites, intercept all requests |
| `webNavigation` | Listed in manifest permissions (used for navigation events) |

**Note:** `webNavigation` is declared in the main `permissions` array. The manifest also lists it in `optional_permissions` but this is redundant — it is always granted.

## Build System

```bash
# Development (load manifest.json in about:debugging)
./build.sh

# Production (creates dist/ryujin-proxy-v{version}.xpi and .zip)
./build.sh --prod

# Lint manifest with web-ext
npm run lint
```

**Build Process (`build.sh`):**
1. Reads `name` and `version` from `manifest.json`
2. **Development mode:** prints instructions for loading as Temporary Add-on in `about:debugging`
3. **Production mode:**
   - Creates temp directory with only extension files (`manifest.json`, `src/`, `assets/`, `CHANGELOG.md`)
   - Runs `npx web-ext build --source-dir=<temp> --artifacts-dir=web-ext-artifacts`
   - Renames output `.zip` to `ryujin-proxy-v{version}.xpi`
   - Copies as `.zip` with the same name
   - Places both in `dist/`
   - Cleans up temp directory

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
- [ ] Regex filters → match correctly (test with built-in tester)
- [ ] Whitelist/blacklist enable toggles work independently
- [ ] Filters persist after browser restart

### Ping Tests
- [ ] Ping button → shows spinner during test
- [ ] Successful ping → shows latency in popup with green text
- [ ] Failed ping → shows error message with red text
- [ ] HTTP methods (GET/HEAD/POST/PUT/DELETE/OPTIONS) work
- [ ] Expected status code validation works
- [ ] Ping does not disrupt active proxy connection
- [ ] Ping history persists and displays timestamp on hover

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
- [ ] Changelog modal renders all versions with grouped changes
- [ ] Version links visible
- [ ] Back to Settings works (close modal)

## Troubleshooting

### Proxy not connecting
1. Verify host:port reachable (use ping button)
2. Check Firefox proxy settings not conflicting (`about:preferences#general`)
3. Check `browser.proxy.onError` in background console

### Data not tracking
1. Ensure `dataTrackingEnabled` is true in settings
2. Check `webRequest` permissions granted
3. Verify tab is actually routed (routeAllTabs or per-tab toggle)

### URL filters not working
1. Check regex syntax in the built-in tester
2. Verify filter type (whitelist vs blacklist vs regex variants)
3. Ensure the corresponding enable toggle is on

### Ping test failing
1. Verify proxy is reachable from your network
2. Check expected HTTP status matches what the endpoint returns
3. Ensure proxy supports the ping URL
4. Try a different HTTP method (e.g., HEAD instead of GET)

### Icon not showing in about:addons
- Manifest `icons` object must reference existing files
- PNG files in `assets/icons/` must be valid
- 16, 32, 48, 128 sizes required

### Extension not loading
- Firefox 91.1.0+ required (strict_min_version)
- Manifest V2 must be enabled in `about:config` (`extensions.manifestV2.enabled`)
- Check browser console for syntax errors

---

*Generated for Ryujin Proxy v0.0.10*
