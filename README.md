# YT Caption Kit

[![npm version](https://img.shields.io/npm/v/yt-caption-kit.svg)](https://www.npmjs.com/package/yt-caption-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)

Fetch YouTube transcripts/subtitles in **Node.js** and **TypeScript** without a headless browser.

## Features

- Fetch transcripts for a video ID
- List available transcripts and translation languages
- Prefer manual transcripts but fall back to generated ones
- Translate transcripts when YouTube exposes translation targets
- Preserve inline formatting tags such as `<i>` and `<b>`
- Format transcripts as JSON, text, WebVTT, SRT, or pretty-printed output
- Use rotating Webshare proxies or generic HTTP/HTTPS/SOCKS proxies
- Includes a CLI ready to publish to npm

## Installation

```bash
npm install yt-caption-kit
```

**Requirements:** Node.js `>= 18`

## API

```ts
import { YtCaptionKit } from "yt-caption-kit";

const api = new YtCaptionKit();
const transcript = await api.fetch("GJLlxj_dtq8");

console.log(transcript.language);
console.log(transcript.toRawData());
```

```ts
const transcript = await api.fetch("GJLlxj_dtq8", {
  languages: ["de", "en"],
  preserveFormatting: true,
});
```

```ts
const transcriptList = await api.list("GJLlxj_dtq8");
const transcript = transcriptList.findTranscript(["de", "en"]);
const translated = await transcript.translate("ar").fetch();
```

`api.fetch()` returns a `FetchedTranscript` with `videoId`, `language`, `languageCode`, `isGenerated`, `snippets`, `length`, `at(index)`, and `toRawData()`.

## CLI

After installing the package you can use the CLI:

```bash
yt-caption-kit GJLlxj_dtq8
```

### Common examples

```bash
# fetch JSON output
yt-caption-kit GJLlxj_dtq8 --format json

# fetch with language fallback
yt-caption-kit GJLlxj_dtq8 --languages de en

# list available transcripts
yt-caption-kit GJLlxj_dtq8 --list-transcripts

# translate to Arabic
yt-caption-kit GJLlxj_dtq8 --translate ar
```

### CLI options

- `--languages <codes...>`
- `--list-transcripts`
- `--exclude-generated`
- `--exclude-manually-created`
- `--format <pretty|json|text|webvtt|srt>`
- `--translate <code>`
- `--http-proxy <url>`
- `--https-proxy <url>`
- `--webshare-proxy-username <username>`
- `--webshare-proxy-password <password>`
- `--version`
- `--help`

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

## Errors

The package exports error classes such as `RequestBlocked`, `IpBlocked`, `VideoUnavailable`, `VideoUnplayable`, `TranscriptsDisabled`, `NoTranscriptFound`, `AgeRestricted`, `NotTranslatable`, and `TranslationLanguageNotAvailable`.

## Development

```bash
npm install
npm test
```

The test suite uses Node's built-in test runner and fixture-driven mocks, so it does not hit YouTube during validation.

## Notes

- Use a **video ID**, not a full YouTube URL.
- This package relies on undocumented YouTube endpoints, so breakage is possible if YouTube changes their response format.
- Proxy support is strongly recommended if you expect high request volume or IP-based blocking.