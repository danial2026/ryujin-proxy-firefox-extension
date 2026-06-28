# Technical Documentation

## Architecture Overview

Ryujin Proxy is a Firefox Manifest V2 extension built with vanilla JavaScript. It uses a persistent background service worker to manage proxy configuration, tab routing, data tracking, and URL filtering.

```
┌─────────────────────────────────────────────────────────────┐
│                     Firefox Browser                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Popup UI   │  │  Options UI  │  │  Content Script  │  │
│  │  (popup.js)  │  │ (options.js) │  │ (content.js)     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └────────┬────────┴────────────────────┘            │
│                  ▼                                          │
│         ┌─────────────────┐                                 │
│         │  Background SW  │                                 │
│         │ (background.js) │                                 │
│         └────────┬────────┘                                 │
│                  │                                          │
│    ┌─────────────┼─────────────┐                            │
│    ▼             ▼             ▼                            │
│ ┌───────┐   ┌──────────┐  ┌──────────┐                     │
│ │ Proxy │   │  Tabs    │  │ webRequest│                    │
│ │  API  │   │   API    │  │    API   │                     │
│ └───────┘   └──────────┘  └──────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### Background Service Worker (`src/background/background.js`)

The core of the extension. Runs persistently and handles:

| Module | Responsibility |
|--------|----------------|
| **Proxy Management** | Configures SOCKS5 via `browser.proxy.settings.set()` |
| **Tab Routing** | Applies proxy to specific tabs via `browser.tabs.update()` |
| **Data Tracking** | Monitors sent/received bytes via `webRequest` API |
| **URL Filtering** | Blocks/allows requests via `webRequestBlocking` API |
| **Storage** | Persists all state via `browser.storage.local` |

#### Key Functions

```javascript
// Apply proxy configuration to Firefox
async function applyProxy(proxyId) {
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: 'socks5',
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,  // optional
        password: proxy.password   // optional
      },
      bypassList: ['<local>']
    }
  };
  await browser.proxy.settings.set({ value: config, scope: 'regular' });
}

// Route specific tab through active proxy
async function applyProxyToTab(tabId) {
  await browser.tabs.update(tabId, { 
    proxy: { host, port, scheme: 'socks5' } 
  });
}

// Track bandwidth per proxy
function trackDataUsage(tabId, bytes, direction) {
  // Updates dataUsage Map and persists to storage
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
  urlFilters: {...},
  settings: {...}
};
```

**Message Passing:**
```javascript
// Request full state from background
browser.runtime.sendMessage({ type: 'GET_STATE' });

// Set active proxy
browser.runtime.sendMessage({ type: 'SET_ACTIVE_PROXY', id: proxyId });

// Listen for background updates
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_CHANGED') renderAll();
});
```

### Options Page (`src/options/`)

Full settings interface at `about:addons` → Ryujin Proxy → Preferences.

**Features:**
- Four-tab filter system (whitelist, blacklist, regex whitelist, regex blacklist)
- Live regex testing with match/no-match feedback
- Settings toggles with immediate persistence
- Danger zone with confirmations
- Changelog and license viewers

### Content Script (`src/content/content.js`)

Runs on all pages at `document_start`. Provides client-side URL filtering as a first line of defense before requests hit the background `webRequest` listener.

```javascript
function testUrlAgainstFilters(url) {
  // Check regex blacklist → regex whitelist → domain blacklist → domain whitelist
  // Returns { allowed: boolean, reason: string }
}
```

### Storage Utilities (`src/utils/storage.js`)

Centralized storage abstraction with TypeScript-style JSDoc types.

```javascript
export const STORAGE_KEYS = {
  PROXIES: 'ryujin_proxies',
  ACTIVE_PROXY: 'ryujin_active_proxy',
  TAB_ROUTING: 'ryujin_tab_routing',
  DATA_USAGE: 'ryujin_data_usage',
  URL_FILTERS: 'ryujin_url_filters',
  SETTINGS: 'ryujin_settings'
};

// All functions return Promises for async/await usage
export async function getProxies() { ... }
export async function setProxies(proxies) { ... }
export async function getUrlFilters() { ... }
export async function setUrlFilters(filters) { ... }
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
       ├─► browser.proxy.settings.set()  ──► Firefox applies globally
       │
       ├─► browser.storage.local.set()   ──► Persist activeProxyId
       │
       └─► broadcastStateChange()        ──► Notify all UIs
       │
       ▼
Popup receives STATE_CHANGED → renderAll() → UI updates instantly
```

### Tab Routing
```
Tab loads / activates
       │
       ▼
background.js: tabs.onUpdated / onActivated
       │
       ▼
shouldRouteTab(tabId) → checks routeAllTabs + tabRouting Map
       │
       ▼
If true: browser.tabs.update(tabId, { proxy: {...} })
```

### Data Tracking
```
Request sent / Response received
       │
       ▼
webRequest.onBeforeRequest / onHeadersReceived
       │
       ▼
shouldTrackRequest(details) → tabId > 0 && (routeAllTabs || tabRouting)
       │
       ▼
trackDataUsage(tabId, bytes, 'sent'|'received')
       │
       ▼
dataUsage Map updated → storage → UI shows real-time stats
```

### URL Filtering (Two Layers)

**Layer 1: Content Script** (runs in page context, synchronous)
```
Content script intercepts → testUrlAgainstFilters(url)
       │
       ├─► Blocked → cancel request immediately
       └─► Allowed → passes to Layer 2
```

**Layer 2: Background webRequest** (network level, asynchronous)
```
webRequest.onBeforeRequest → checkUrlFilters(url)
       │
       ├─► Blocked → return { cancel: true }
       └─► Allowed → request proceeds
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
    "dataTrackingEnabled": true
  }
}
```

## Permissions Breakdown

| Permission | Required For | Optional |
|------------|--------------|----------|
| `proxy` | SOCKS5 configuration | No |
| `tabs` | Tab routing, favicon, titles | No |
| `storage` | Persist all settings | No |
| `webRequest` | Data tracking, Layer 2 filtering | No |
| `webRequestBlocking` | Cancel requests in Layer 2 | No |
| `<all_urls>` | Apply to all websites | No |
| `webNavigation` | Detect navigation for routing | Yes |

## Build System

```bash
# Development (load manifest.json in about:debugging)
./build.sh

# Production (creates dist/ryujin-proxy-v0.0.2.xpi)
./build.sh --prod

# Lint manifest
npm run lint
```

**Build Process:**
1. Creates temp directory with only extension files (`manifest.json`, `src/`, `assets/`)
2. Runs `web-ext build` on clean source
3. Renames output to `ryujin-proxy-v{version}.xpi`
4. Places in `dist/`

## Design System

### Colors
```css
:root {
  --bg: #000000;        /* Pure black background */
  --surface: #0A0A0A;   /* Near-black cards */
  --border: #1A1A1A;    /* Subtle borders */
  --primary: #FFFFFF;   /* Pure white primary */
  --success: #00FF88;   /* Neon green */
  --warning: #FFCC00;   /* Caution yellow */
  --error: #FF3366;     /* Pink-red */
}
```

### Typography
- **UI:** Inter (900 weight for headers, 600 for body)
- **Data:** Monaco / Menlo / Ubuntu Mono

### Spacing Scale
- Micro: 4px
- Base: 8px
- Double: 16px
- Quad: 32px

### Interaction
- All transitions: 150ms ease
- Hover: border opacity 10% → 20%
- Selected: white border (1px)
- Focus: 2px white outline

## API Reference

### Messages (Popup/Options → Background)

| Type | Payload | Response |
|------|---------|----------|
| `GET_STATE` | `{}` | Full state object |
| `ADD_PROXY` | `{ proxy: {name, host, port, username?, password?} }` | `{ success, proxy }` |
| `REMOVE_PROXY` | `{ id }` | `{ success }` |
| `SET_ACTIVE_PROXY` | `{ id }` | `{ success }` |
| `TOGGLE_TAB_ROUTING` | `{ tabId }` | `{ success, routing }` |
| `SET_ROUTE_ALL_TABS` | `{ enabled }` | `{ success }` |
| `UPDATE_URL_FILTERS` | `{ urlFilters }` | `{ success }` |
| `UPDATE_SETTINGS` | `{ settings }` | `{ success }` |
| `RESET_DATA_USAGE` | `{ proxyId? }` | `{ success }` |
| `GET_TABS` | `{}` | `{ tabs[] }` |

### Messages (Background → UI)

| Type | Payload |
|------|---------|
| `STATE_CHANGED` | Full state object |

## Testing Checklist

- [ ] Add proxy with auth → connects successfully
- [ ] Click proxy → activates immediately (green dot)
- [ ] Switch proxy → old tabs update routing
- [ ] Route all tabs toggle → all tabs apply/remove
- [ ] Per-tab toggle → individual tab routes correctly
- [ ] Data usage increments in real time
- [ ] Whitelist domain → bypasses proxy
- [ ] Blacklist domain → blocks completely
- [ ] Regex filters → match correctly
- [ ] Settings persist after browser restart
- [ ] Reset data usage → counters zero
- [ ] Reset all → clean slate

## Troubleshooting

### Proxy not connecting
1. Verify host:port reachable
2. Check Firefox proxy settings not conflicting
3. Check `browser.proxy.onError` in background console

### Data not tracking
1. Ensure `dataTrackingEnabled` is true
2. Check `webRequest` permissions granted
3. Verify tab is actually routed

### URL filters not working
1. Check regex syntax in tester
2. Verify filter type (whitelist vs blacklist)
3. Content script may need reload (refresh page)

### Icon not showing in about:addons
- Manifest `icons` object must reference existing files
- PNG files in `assets/icons/` must be valid
- 16, 32, 48, 128 sizes required

---

*Generated for Ryujin Proxy v0.0.2*