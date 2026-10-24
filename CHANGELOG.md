# Changelog

## 1.1.0 — 2026-10-24

Audit-driven release: 41 bug fixes across the library, CLI and web app, plus
major new features. Tests grew from 21 to 56.

### Library
- HTTP client: request timeouts, bounded redirect following (fixes dead EU
  consent flow), default browser User-Agent, shared ProxyAgent, AbortSignal
  support, URL-encoded Webshare credentials
- Full HTML5 entity decoding (named + numeric references, safe surrogate and
  control-character handling)
- `stripHtml` removes every tag variant; preserved formatting tags re-emitted
  bare so attributes cannot smuggle event handlers
- Typed errors expose `.message`; proxy-aware `IpBlocked` guidance;
  `Retry-After` captured; defensive InnerTube parsing raises
  `YouTubeDataUnparsable` instead of raw `TypeError`
- New features: URL input + `extractVideoId`, base-language fallback
  (`en` → `en-US`), `cookies.txt` auth, `poToken` support, opt-in retry
  policy with backoff, pluggable cache, `fetchAll` with concurrency,
  `listVideos` for playlists and channels

### CLI
- Errors on stderr with non-zero exit codes; stdout stays parseable
- Strict flag parsing (`--languages` requires a value, unknown flags
  rejected, `--format` validates)
- New: `--preserve-formatting`, `--output` with `{videoId}` templating,
  stdin batch mode (`-`)

### Web app
- Fixed srt/webvtt/text downloads; fixed stored XSS in search highlighting
- Sanitized typed error responses (no internals or proxy-vendor leakage)
- Rate limiting keyed on trusted `req.ip`, CORS, security headers, JSON 404s
  for unknown API paths
- Real translation, embedded synced player, search match navigation,
  shareable deep links with `tlang`
- Removed fabricated JSON-LD aggregate rating; real OG image

### Packaging / CI
- Dual ESM/CJS build with per-condition type declarations (publint +
  arethetypeswrong clean); tarball ships `bin` + `dist` only
- CI: package install smoke test and publint/attw validation job

## 1.0.0 — 2026-03-10

Initial release: transcript fetching, translation, SRT/WebVTT/text/JSON
formatting, proxy support, CLI.

