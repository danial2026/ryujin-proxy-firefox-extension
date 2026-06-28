# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-06-28

### Added
- Default proxy values: 127.0.0.1:10808 in add/edit form
- Disconnect button to return to direct connection
- Default ping URL (httpbin.org/get) in settings

## [0.0.2] - 2026-06-28

### Added
- Proxy connection test button (ping) with TCP/HTTP methods
- Ping method and URL configuration in settings

### Fixed
- Proxy selection now immediately switches to selected proxy (no restart needed)
- White border for selected proxy item
- White border on all text input fields
- Grey selection color for text highlighting
- Removed white line on left edge of popup
- Added edit button to proxy list (uses same form as add)
- Fixed URL filter updates not persisting
- Fixed about:addons preferences icon not showing
- Higher contrast text colors for better readability

### Changed
- All text inputs now have white borders
- Selected proxy shows white border instead of left accent bar
- Text selection is now grey instead of white

## [0.0.1] - 2026-06-28

### Added
- Initial release of Ryujin Proxy
- SOCKS5 proxy management (add, edit, remove with authentication)
- Per-tab proxy routing with "route all tabs" default option
- Real-time data usage tracking per proxy (sent/received bytes)
- URL filtering system:
  - Domain whitelist (bypass proxy for listed domains)
  - Domain blacklist (block listed domains entirely)
  - Regex whitelist (JavaScript regex patterns to bypass)
  - Regex blacklist (JavaScript regex patterns to block)
- Modern minimal black & white UI with Inter font
- Persistent settings and data storage via browser.storage.local
- Firefox Manifest V2 compatible
- Service worker background script for proxy management
- Content script for client-side URL filtering
- Popup interface for quick proxy switching
- Full options page for advanced configuration
- Danger zone: reset data usage / reset all settings
- Changelog and license viewers in options

### Technical
- Background service worker handles:
  - Proxy configuration via browser.proxy API
  - Tab routing via browser.tabs API
  - Data tracking via browser.webRequest API
  - URL filtering via browser.webRequestBlocking API
- Storage utilities for type-safe persistence
- Zero dependencies, vanilla JavaScript
- CSS custom properties for theming
- Accessible markup with ARIA labels

### Design
- Pure black background (`#000000`)
- Near-black surfaces (`#0A0A0A`)
- Pure white primary (`#FFFFFF`)
- Semantic colors: Success `#00FF88`, Warning `#FFCC00`, Error `#FF3366`
- Inter font for UI, monospace for technical data
- No shadows, no gradients, 1px borders only
- Opacity-based hierarchy (5%-100% white)
- 12px/16px border radius
- 150ms micro-interactions

## [Unreleased]

### Planned
- Manifest V3 migration
- Proxy import/export (JSON)
- Per-proxy routing rules
- Connection health checks
- Keyboard shortcuts
- Context menu integration