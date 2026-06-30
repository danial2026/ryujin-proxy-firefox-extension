# Changelog

All notable changes to this project will be documented in this file.

## [0.0.10] - 2026-06-30

### Added
- HTTP method dropdown for ping tests (GET, HEAD, POST, PUT, DELETE, OPTIONS) — replaces the old TCP/HTTP choice

### Fixed
- Ping test no longer opens a visible tab — runs silently in the background
- Ping test now properly sends proxy credentials (username/password) when testing
- Completely rewrote the ping logic — simpler, more reliable, no race conditions

### Changed
- Default ping URL updated to HTTPS (https://www.google.com/generate_204)
- Default ping method changed to GET

## [0.0.9] - 2026-06-30

### Added
- Expected HTTP Status setting in options (default: 204) — customize which response code means success
- Extension icon (favicon) now shows on all extension pages

### Fixed
- Ping test now properly routes through the selected proxy with correct credentials
- Ping test validates the expected HTTP status code (default 204)
- Fixed ping test timeouts when proxy was unreachable
- Fixed ping test not using proxy credentials for authenticated proxies

### Changed
- Default ping URL restored to http://www.google.com/generate_204 (returns 204 No Content)
- Ping test now validates exact status code instead of just checking if response is OK

## [0.0.8] - 2026-06-29

### Fixed
- Proxy now actually routes your traffic through the proxy server — previously it looked connected but traffic went direct
- Choosing which tabs use the proxy now works correctly (per-tab routing)
- Proxy username and password (authentication) now actually gets sent to the proxy server
- Connection test (ping) no longer interferes with your active proxy connection
- Fixed several crashes and hangs when opening the popup or options page
- Extension icon in Firefox add-ons settings now shows up properly

### Changed
- Rewrote how the extension connects to your proxy behind the scenes for better reliability
- WebSocket connections (used by some websites and apps) now also go through the proxy

## [0.0.7] - 2026-06-29

### Fixed
- Whitelist and blacklist filters now start turned off by default (were accidentally on)
- Proxy wasn't routing traffic when filters were turned off — now fixed
- Changelog viewer now opens properly in its own page

### Added
- Toggle switches to turn whitelist/blacklist on and off in the options page
- Connection test (ping) now uses a more reliable test URL by default
- GitHub links in the options page header

### Changed
- Whitelist and blacklist now default to off (they were on before, which blocked all sites until you added filters)

## [0.0.6] - 2026-06-29

### Fixed
- Options page content is now properly centered on screen
- Settings menus now match the black-and-white theme

### Added
- Options page now opens in its own tab instead of a popup
- Activity log viewer with color-coded entries (info, success, warning, error)
- Ping test results are saved and shown next to each proxy
- Full-screen delete confirmation when removing a proxy

## [0.0.5] - 2026-06-29

### Fixed
- Changelog viewer now shows content correctly
- Version number now loads automatically (no more hardcoded numbers)
- Settings menus now properly follow the black-and-white design

## [0.0.4] - 2026-06-28

### Fixed
- Editing a proxy now fills in its current values properly
- Switching proxies now updates the UI immediately without reopening the popup
- Connection test (ping) now works without showing "Proxy not found" errors
- Ping now respects your chosen method (TCP/HTTP) and URL from settings
- Delete confirmation is now a proper full-screen dialog

### Added
- Ping history — each proxy shows when it was last tested and the result

## [0.0.3] - 2026-06-28

### Added
- New proxy form now pre-fills with 127.0.0.1:10808 (common default)
- Disconnect button to switch back to direct internet connection
- Default ping URL for connection testing

## [0.0.2] - 2026-06-28

### Added
- Connection test (ping) button to check if a proxy is working
- Choose between TCP or HTTP ping methods
- Configure which URL to use for ping tests

### Fixed
- Clicking a proxy now immediately switches to it (no restart needed)
- Lots of visual polish — white borders, better contrast, consistent styling
- Edit button now visible on each proxy in the list
- URL filter changes now save properly
- Text is now easier to read with higher contrast

## [0.0.1] - 2026-06-28

### Added
- First release of Ryujin Proxy
- Add, edit, and remove SOCKS5 proxies (with optional username/password)
- Choose which browser tabs use the proxy, or route all tabs through it
- Real-time data usage tracking — see how much data each proxy has sent and received
- URL filtering — make certain websites bypass the proxy or get blocked entirely
- Black-and-white minimalist interface
- All your proxies, settings, and data are saved automatically
- Quick proxy switching from the popup menu
- Full settings page with advanced options
- Reset data usage or factory reset from the "Danger Zone"
- Changelog and license viewer built into the options page
