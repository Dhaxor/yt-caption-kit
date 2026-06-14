import type { Agent } from "node:http";

import type { TranscriptCache } from "./cache.js";
import { loadCookieFile } from "./cookies.js";
import { InvalidVideoId } from "./errors.js";
import { DefaultHttpClient, type HttpClient } from "./http-client.js";
import { listPlaylistVideos, type ListVideosOptions, type VideoRef } from "./playlists.js";
import type { ProxyConfig } from "./proxies.js";
import { resolveRetryPolicy, type RetryPolicy } from "./retry.js";
import {
  FetchedTranscript,
  FetchedTranscriptSnippet,
  TranscriptList,
  TranscriptListFetcher,
  type TranscriptContext,
} from "./transcripts.js";
import { extractVideoId, sanitizeVideoId } from "./utils.js";

export interface YtCaptionKitOptions {
  proxyConfig?: ProxyConfig;
  /** Replace the entire HTTP client. Takes precedence over transport options. */
  httpClient?: HttpClient;
  /** Per-request inactivity timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Maximum redirects to follow per request. Default: 5. */
  maxRedirects?: number;
  /** Override the default browser-like User-Agent. */
  userAgent?: string;
  /** Extra headers added to every request. */
  headers?: Record<string, string>;
  /** Custom Node http.Agent (keep-alive, SOCKS, mTLS, testing). */
  agent?: Agent;
  /** Honor HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars when no proxyConfig is set. */
  useEnvProxy?: boolean;
  /** Abort signal applied to all requests. */
  signal?: AbortSignal;
  /** Retry policy for transient failures (429/5xx/network). */
  retry?: RetryPolicy;
  /** Cache for captions metadata and fetched transcripts. */
  cache?: TranscriptCache;
  /** Path to a Netscape-format cookies.txt for authenticated requests. */
  cookiesPath?: string;
  /** PO token appended to transcript requests for token-gated videos. */
  poToken?: string;
}

export interface FetchTranscriptOptions {
  languages?: Iterable<string>;
  preserveFormatting?: boolean;
  /** Translate the selected transcript into this language code before fetching. */
  translateTo?: string;
}

export interface FetchAllOptions extends FetchTranscriptOptions {
  /** Maximum simultaneous fetches. Default: 2 (conservative, anti-block). */
  concurrency?: number;
}

export interface FetchAllResult {
  results: Record<string, FetchedTranscript>;
  errors: Record<string, Error>;
}

export class YtCaptionKit {
  private readonly fetcher: TranscriptListFetcher;
  private readonly httpClient: HttpClient;
  private readonly context: TranscriptContext;
  private readonly cache?: TranscriptCache;

  constructor(options: YtCaptionKitOptions = {}) {
    this.httpClient =
      options.httpClient ??
      new DefaultHttpClient({
        proxyConfig: options.proxyConfig,
        timeoutMs: options.timeoutMs,
        maxRedirects: options.maxRedirects,
        userAgent: options.userAgent,
        defaultHeaders: options.headers,
        agent: options.agent,
        useEnvProxy: options.useEnvProxy,
        signal: options.signal,
      });

    if (options.cookiesPath) {
      for (const cookie of loadCookieFile(options.cookiesPath)) {
        this.httpClient.setCookie(cookie.name, cookie.value, cookie.domain);
      }
    }

    this.context = {
      proxyConfig: options.proxyConfig,
      retryPolicy: resolveRetryPolicy(options.retry),
      poToken: options.poToken,
    };
    this.cache = options.cache;
    this.fetcher = new TranscriptListFetcher(this.httpClient, this.context);
  }

  async fetch(videoIdOrUrl: string, options: FetchTranscriptOptions = {}): Promise<FetchedTranscript> {
    const videoId = this.resolveVideoId(videoIdOrUrl);
    const languages = [...(options.languages ?? ["en"])];
    const preserveFormatting = options.preserveFormatting ?? false;
    const translateTo = options.translateTo;

    const cacheKey = `fetch:${videoId}:${languages.join(",")}:${preserveFormatting}:${translateTo ?? ""}`;
    const cached = await this.cache?.get<SerializedTranscript>(cacheKey);
    if (cached) {
      return deserializeTranscript(cached);
    }

    const list = await this.list(videoId);
    let transcript = list.findTranscript(languages);
    if (translateTo) {
      transcript = transcript.translate(translateTo);
    }
    const fetched = await transcript.fetch(preserveFormatting);
    await this.cache?.set(cacheKey, serializeTranscript(fetched));
    return fetched;
  }

  async list(videoIdOrUrl: string): Promise<TranscriptList> {
    const videoId = this.resolveVideoId(videoIdOrUrl);
    const cacheKey = `list:${videoId}`;
    const cached = await this.cache?.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      return TranscriptList.build(this.httpClient, videoId, cached, this.context);
    }
    const captionsJson = await this.fetcher.fetchCaptionsJson(videoId);
    await this.cache?.set(cacheKey, captionsJson);
    return TranscriptList.build(this.httpClient, videoId, captionsJson, this.context);
  }

  /**
   * Fetches transcripts for many videos with bounded concurrency, collecting
   * per-video failures instead of rejecting the whole batch.
   */
  async fetchAll(videoIdsOrUrls: Iterable<string>, options: FetchAllOptions = {}): Promise<FetchAllResult> {
    const ids = [...videoIdsOrUrls];
    const concurrency = Math.max(1, options.concurrency ?? 2);
    const results: Record<string, FetchedTranscript> = {};
    const errors: Record<string, Error> = {};
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= ids.length) {
          return;
        }
        const id = ids[index]!;
        try {
          results[id] = await this.fetch(id, options);
        } catch (error) {
          errors[id] = error instanceof Error ? error : new Error(String(error));
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return { results, errors };
  }

  /** Enumerates the video IDs of a playlist or channel (best-effort). */
  async listVideos(playlistOrChannel: string, options: ListVideosOptions = {}): Promise<VideoRef[]> {
    return listPlaylistVideos(this.httpClient, playlistOrChannel, options);
  }

  private resolveVideoId(videoIdOrUrl: string): string {
    const trimmed = videoIdOrUrl.trim();
    const videoId = extractVideoId(trimmed);
    if (videoId) {
      return videoId;
    }
    // A URL we couldn't extract an ID from is invalid; any other bare token is
    // passed through to YouTube (Python parity — YouTube decides validity).
    if (/^https?:\/\//i.test(trimmed) || /(?:youtube\.com|youtu\.be)/i.test(trimmed)) {
      throw new InvalidVideoId(videoIdOrUrl);
    }
    return sanitizeVideoId(trimmed);
  }
}

interface SerializedTranscript {
  snippets: Array<{ text: string; start: number; duration: number }>;
  videoId: string;
  language: string;
  languageCode: string;
  isGenerated: boolean;
}

function serializeTranscript(transcript: FetchedTranscript): SerializedTranscript {
  return {
    snippets: transcript.toRawData(),
    videoId: transcript.videoId,
    language: transcript.language,
    languageCode: transcript.languageCode,
    isGenerated: transcript.isGenerated,
  };
}

function deserializeTranscript(data: SerializedTranscript): FetchedTranscript {
  return new FetchedTranscript(
    data.snippets.map((snippet) => new FetchedTranscriptSnippet(snippet.text, snippet.start, snippet.duration)),
    data.videoId,
    data.language,
    data.languageCode,
    data.isGenerated,
  );
}
