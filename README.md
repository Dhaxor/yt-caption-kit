# YT Caption Kit

[![npm version](https://img.shields.io/npm/v/yt-caption-kit.svg)](https://www.npmjs.com/package/yt-caption-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)

Fetch, translate, and format YouTube captions and transcripts in **Node.js** and **TypeScript** with a typed API, CLI, SRT/WebVTT output, and proxy support.

## Features

- Fetch transcripts for a video ID **or a full YouTube URL** (watch, `youtu.be`, Shorts, embed, live)
- List available transcripts and translation languages
- Prefer manual transcripts but fall back to generated ones, with **base-language fallback** (`en` matches `en-US`)
- Translate transcripts when YouTube exposes translation targets
- Preserve inline formatting tags such as `<i>` and `<b>`
- Format transcripts as JSON, text, WebVTT, SRT, or pretty-printed output
- Configurable **request timeout**, **retry/backoff** (honoring `Retry-After`), and a realistic default **User-Agent**
- Optional **caching**, **bulk fetching**, **playlist/channel enumeration**, **cookie authentication**, and **PO-token** support
- Use rotating Webshare proxies, generic HTTP/HTTPS/SOCKS proxies, a custom agent, or `HTTP(S)_PROXY` env vars
- Includes a CLI ready to publish to npm

## Installation

```bash
npm install yt-caption-kit
```

**Requirements:** Node.js `>= 18`

### Module format

The package ships **both ESM and CommonJS** builds, so it works with `import` and `require`:

```ts
import { YtCaptionKit } from "yt-caption-kit"; // ESM / TypeScript
```

```js
const { YtCaptionKit } = require("yt-caption-kit"); // CommonJS
```

## API

```ts
import { YtCaptionKit } from "yt-caption-kit";

const api = new YtCaptionKit();
const transcript = await api.fetch("GJLlxj_dtq8");

console.log(transcript.language);
console.log(transcript.toRawData());
```

Both `fetch()` and `list()` accept a bare video ID **or a full URL**:

```ts
await api.fetch("https://www.youtube.com/watch?v=GJLlxj_dtq8");
await api.fetch("https://youtu.be/GJLlxj_dtq8", { languages: ["de", "en"], preserveFormatting: true });
```

Translate while fetching, or work with the transcript list directly:

```ts
// One-shot translation
await api.fetch("GJLlxj_dtq8", { languages: ["en"], translateTo: "ar" });

// Or via the list
const transcriptList = await api.list("GJLlxj_dtq8");
const transcript = transcriptList.findTranscript(["de", "en"]);
const translated = await transcript.translate("ar").fetch();
```

`api.fetch()` returns a `FetchedTranscript` with `videoId`, `language`, `languageCode`, `isGenerated`, `snippets`, `length`, `at(index)`, and `toRawData()`.

### Options

```ts
const api = new YtCaptionKit({
  timeoutMs: 20_000,                 // per-request inactivity timeout (default 30s)
  retry: { retries: 3 },             // retry 429/5xx/network errors with backoff
  userAgent: "my-app/1.0",           // override the default browser-like UA
  headers: { "Accept-Language": "en" },
  cache: new InMemoryTranscriptCache(),
  cookiesPath: "/path/to/cookies.txt", // authenticate (e.g. age-restricted videos)
  poToken: process.env.YT_PO_TOKEN,    // for PO-token-gated videos
  useEnvProxy: true,                   // honor HTTP_PROXY / HTTPS_PROXY / NO_PROXY
});
```

### Bulk fetching

Fetch many videos with bounded concurrency; per-video failures are collected, not thrown:

```ts
const { results, errors } = await api.fetchAll(["GJLlxj_dtq8", "https://youtu.be/abc..."], {
  concurrency: 3,
  languages: ["en"],
});
```

### Playlists & channels

Enumerate the video IDs of a playlist or channel (best-effort; relies on undocumented endpoints):

```ts
const videos = await api.listVideos("https://www.youtube.com/playlist?list=PL...", { limit: 100 });
const { results } = await api.fetchAll(videos.map((v) => v.videoId));
```

## CLI

After installing the package you can use the CLI:

```bash
yt-caption-kit GJLlxj_dtq8
yt-caption-kit "https://youtu.be/GJLlxj_dtq8"   # URLs work too
```

### Common examples

```bash
# fetch JSON output
yt-caption-kit GJLlxj_dtq8 --format json

# fetch with language fallback
yt-caption-kit GJLlxj_dtq8 --languages de en

# keep inline <i>/<b> formatting
yt-caption-kit GJLlxj_dtq8 --preserve-formatting

# write per-video files (one .srt per ID)
yt-caption-kit id1 id2 --format srt --output "{videoId}.srt"

# read newline-separated IDs/URLs from stdin
cat ids.txt | yt-caption-kit - --format text

# list available transcripts
yt-caption-kit GJLlxj_dtq8 --list-transcripts

# translate to Arabic
yt-caption-kit GJLlxj_dtq8 --translate ar
```

Errors are written to **stderr** and the process exits with a **non-zero code** when any video fails, so the tool is safe to use in scripts and pipelines (stdout stays clean for formatted output).

### CLI options

- `--languages <codes...>`
- `--list-transcripts`
- `--exclude-generated`
- `--exclude-manually-created`
- `--preserve-formatting`
- `--format <pretty|json|text|webvtt|srt>`
- `--translate <code>`
- `--output, -o <file>` (use `{videoId}` to template per-video files)
- `--http-proxy <url>`
- `--https-proxy <url>`
- `--webshare-proxy-username <username>`
- `--webshare-proxy-password <password>`
- `--version`
- `--help`

Pass `-` as a video ID to read newline-separated IDs/URLs from stdin.

## Formatters

```ts
import { FormatterLoader, JSONFormatter, SRTFormatter, WebVTTFormatter } from "yt-caption-kit";

const transcript = await api.fetch("GJLlxj_dtq8");
console.log(new JSONFormatter().formatTranscript(transcript));
console.log(new SRTFormatter().formatTranscript(transcript));
console.log(new WebVTTFormatter().formatTranscript(transcript));
console.log(new FormatterLoader().load("pretty").formatTranscript(transcript));
```

## Proxies

```ts
import { GenericProxyConfig, WebshareProxyConfig, YtCaptionKit } from "yt-caption-kit";

const apiWithGenericProxy = new YtCaptionKit({
  proxyConfig: new GenericProxyConfig("http://user:password@proxy.example:8080"),
});

const apiWithWebshare = new YtCaptionKit({
  proxyConfig: new WebshareProxyConfig({
    proxyUsername: process.env.WEBSHARE_PROXY_USERNAME!,
    proxyPassword: process.env.WEBSHARE_PROXY_PASSWORD!,
    filterIpLocations: ["de", "us"],
  }),
});
```

Credentials are URL-encoded automatically, so passwords containing `/`, `#`, or `%` work. You can also pass a custom Node `http.Agent` via the `agent` option (keep-alive tuning, SOCKS, mTLS), or set `useEnvProxy: true` to honor `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`.

## Authentication (cookies)

For age-restricted videos, export your YouTube cookies to a Netscape-format `cookies.txt` (browser extension or `yt-dlp --cookies`) and pass its path:

```ts
const api = new YtCaptionKit({ cookiesPath: "./cookies.txt" });
```

Invalid paths raise `CookiePathInvalid`; malformed files raise `CookieInvalid`. Note that YouTube may ban accounts used for automated requests.

## Errors

The package exports error classes such as `RequestBlocked`, `IpBlocked`, `VideoUnavailable`, `VideoUnplayable`, `TranscriptsDisabled`, `NoTranscriptFound`, `AgeRestricted`, `NotTranslatable`, `TranslationLanguageNotAvailable`, `PoTokenRequired`, `YouTubeRequestFailed`, and `YouTubeDataUnparsable`. All extend `CouldNotRetrieveTranscript` and carry a populated `.message`. Network and timeout failures are surfaced as typed errors where possible; YouTube response-shape drift raises `YouTubeDataUnparsable` rather than an untyped `TypeError`.

## Web Frontend

Start the web UI locally:

```bash
npm run build
npm run serve
```

Then open **http://localhost:3000** or visit **GetYTTranscripts.com**.

Features:

- Paste a YouTube URL or video ID
- Browse available caption languages
- View transcripts with clickable timestamps and an embedded, synced player
- Search within transcripts with highlighted matches and next/previous navigation
- Translate captions into other available languages (real machine translation, not just track switching)
- Download in JSON, SRT, WebVTT, or plain text
- Copy full transcript text to clipboard
- Shareable deep links (`?v=<id>&lang=<code>`)
- Toggle between dark and light themes (`Ctrl+K` to focus search)

The frontend is a single-page app served by an Express server that wraps `yt-caption-kit` as a REST API. The API sets CDN cache headers, applies per-IP rate limiting, and returns sanitized typed errors. The Express app is built by `createApp({ yt })` in [`app.js`](app.js) so it can be unit-tested with a stubbed client.

## Development

```bash
npm install
npm test
```

The test suite uses Node's built-in test runner and fixture-driven mocks, so it does not hit YouTube during validation. `npm run build` produces both the ESM (`dist/src`) and CommonJS (`dist/cjs`) outputs.

## Notes

- Use a **video ID** or a full YouTube **URL** — both are accepted.
- This package relies on undocumented YouTube endpoints, so breakage is possible if YouTube changes their response format.
- Proxy support is strongly recommended if you expect high request volume or IP-based blocking.
