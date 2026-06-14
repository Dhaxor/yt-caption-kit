import {
  AgeRestricted,
  FailedToCreateConsentCookie,
  InvalidVideoId,
  IpBlocked,
  NoTranscriptFound,
  NotTranslatable,
  PoTokenRequired,
  RequestBlocked,
  TranscriptsDisabled,
  TranslationLanguageNotAvailable,
  VideoUnavailable,
  VideoUnplayable,
  YouTubeDataUnparsable,
  YouTubeRequestFailed,
} from "./errors.js";
import type { HttpClient, HttpResponse } from "./http-client.js";
import type { ProxyConfig } from "./proxies.js";
import { runWithRetries, type ResolvedRetryPolicy } from "./retry.js";
import { INNERTUBE_API_URL, INNERTUBE_CONTEXT, WATCH_URL } from "./settings.js";
import { decodeHtmlEntities, sanitizeVideoId, stripHtml } from "./utils.js";

export interface TranslationLanguage {
  language: string;
  languageCode: string;
}

/**
 * Shared request configuration threaded from the fetcher down to each
 * Transcript so the transcript download is governed by the same retry,
 * proxy, and PO-token settings as the metadata requests.
 */
export interface TranscriptContext {
  proxyConfig?: ProxyConfig;
  retryPolicy?: ResolvedRetryPolicy;
  poToken?: string;
}

export class FetchedTranscriptSnippet {
  constructor(
    public readonly text: string,
    public readonly start: number,
    public readonly duration: number,
  ) {}
}

export class FetchedTranscript implements Iterable<FetchedTranscriptSnippet> {
  constructor(
    public readonly snippets: FetchedTranscriptSnippet[],
    public readonly videoId: string,
    public readonly language: string,
    public readonly languageCode: string,
    public readonly isGenerated: boolean,
  ) {}

  [Symbol.iterator](): Iterator<FetchedTranscriptSnippet> {
    return this.snippets[Symbol.iterator]();
  }

  get length(): number {
    return this.snippets.length;
  }

  at(index: number): FetchedTranscriptSnippet | undefined {
    return this.snippets.at(index);
  }

  toRawData(): Array<{ text: string; start: number; duration: number }> {
    return this.snippets.map((snippet) => ({
      duration: snippet.duration,
      start: snippet.start,
      text: snippet.text,
    }));
  }
}

function parseRetryAfterMs(headers: HttpResponse["headers"]): number | undefined {
  const raw = headers["retry-after"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

function ensureSuccess(response: HttpResponse, videoId: string): HttpResponse {
  if (response.statusCode === 429) {
    const error = new IpBlocked(videoId);
    error.retryAfterMs = parseRetryAfterMs(response.headers);
    throw error;
  }
  // After the HTTP client follows redirects, a residual 3xx means the redirect
  // chain was not resolved (custom client, or hop limit hit) — treat it as a
  // failure instead of parsing an empty redirect stub as a "successful" body.
  if (response.statusCode >= 300) {
    throw new YouTubeRequestFailed(videoId, `HTTP ${response.statusCode}`, response.statusCode);
  }
  return response;
}

export class Transcript {
  private readonly translationLanguagesByCode: Map<string, string>;

  constructor(
    private readonly httpClient: HttpClient,
    public readonly videoId: string,
    public readonly url: string,
    public readonly language: string,
    public readonly languageCode: string,
    public readonly isGenerated: boolean,
    public translationLanguages: TranslationLanguage[],
    private readonly context: TranscriptContext = {},
  ) {
    this.translationLanguagesByCode = new Map(
      translationLanguages.map((translationLanguage) => [
        translationLanguage.languageCode,
        translationLanguage.language,
      ]),
    );
  }

  async fetch(preserveFormatting = false): Promise<FetchedTranscript> {
    let url = this.url;
    if (this.context.poToken) {
      url += `${url.includes("?") ? "&" : "?"}pot=${encodeURIComponent(this.context.poToken)}&c=WEB`;
    } else if (url.includes("&exp=xpe")) {
      throw new PoTokenRequired(this.videoId);
    }
    // Route the transcript download through the same retry/proxy logic as the
    // metadata requests so a 429 here can rotate IPs instead of failing hard.
    const response = await runWithRetries(
      async () => ensureSuccess(await this.httpClient.get(url), this.videoId),
      this.context,
    );
    const snippets = parseTranscriptXml(await response.text(), preserveFormatting);
    return new FetchedTranscript(
      snippets,
      this.videoId,
      this.language,
      this.languageCode,
      this.isGenerated,
    );
  }

  get isTranslatable(): boolean {
    return this.translationLanguages.length > 0;
  }

  translate(languageCode: string): Transcript {
    if (!this.isTranslatable) {
      throw new NotTranslatable(this.videoId);
    }
    if (!this.translationLanguagesByCode.has(languageCode)) {
      throw new TranslationLanguageNotAvailable(this.videoId);
    }
    return new Transcript(
      this.httpClient,
      this.videoId,
      `${this.url}&tlang=${languageCode}`,
      this.translationLanguagesByCode.get(languageCode)!,
      languageCode,
      true,
      [],
      this.context,
    );
  }

  toString(): string {
    return `${this.languageCode} ("${this.language}")${this.isTranslatable ? "[TRANSLATABLE]" : ""}`;
  }
}

function readRunsText(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) {
    return undefined;
  }
  const record = node as Record<string, any>;
  // ANDROID client uses { runs: [{ text }] }; WEB client uses { simpleText }.
  return (record.runs?.[0]?.text ?? record.simpleText) as string | undefined;
}

export class TranscriptList implements Iterable<Transcript> {
  constructor(
    public readonly videoId: string,
    private readonly manuallyCreatedTranscripts: Map<string, Transcript>,
    private readonly generatedTranscripts: Map<string, Transcript>,
    public readonly translationLanguages: TranslationLanguage[],
  ) {}

  static build(
    httpClient: HttpClient,
    videoId: string,
    captionsJson: Record<string, unknown>,
    context: TranscriptContext = {},
  ): TranscriptList {
    try {
      return TranscriptList.buildUnsafe(httpClient, videoId, captionsJson, context);
    } catch (error) {
      // Any residual shape drift in the captions JSON becomes a typed,
      // catchable error instead of a raw TypeError leaking to consumers.
      if (error instanceof YouTubeDataUnparsable) {
        throw error;
      }
      throw new YouTubeDataUnparsable(videoId);
    }
  }

  private static buildUnsafe(
    httpClient: HttpClient,
    videoId: string,
    captionsJson: Record<string, unknown>,
    context: TranscriptContext,
  ): TranscriptList {
    const translationLanguages = ((captionsJson.translationLanguages as Array<Record<string, any>> | undefined) ?? [])
      .map((translationLanguage) => ({
        language: readRunsText(translationLanguage.languageName) ?? translationLanguage.languageCode,
        languageCode: translationLanguage.languageCode as string,
      }))
      .filter((entry): entry is TranslationLanguage => typeof entry.languageCode === "string");

    const manuallyCreatedTranscripts = new Map<string, Transcript>();
    const generatedTranscripts = new Map<string, Transcript>();

    for (const caption of captionsJson.captionTracks as Array<Record<string, any>>) {
      const baseUrl = caption?.baseUrl as string | undefined;
      const languageCode = caption?.languageCode as string | undefined;
      // Skip malformed tracks rather than crashing the whole fetch.
      if (typeof baseUrl !== "string" || typeof languageCode !== "string") {
        continue;
      }
      const transcript = new Transcript(
        httpClient,
        videoId,
        baseUrl.replace("&fmt=srv3", ""),
        readRunsText(caption.name) ?? languageCode,
        languageCode,
        caption.kind === "asr",
        caption.isTranslatable ? translationLanguages : [],
        context,
      );
      (caption.kind === "asr" ? generatedTranscripts : manuallyCreatedTranscripts).set(languageCode, transcript);
    }

    return new TranscriptList(videoId, manuallyCreatedTranscripts, generatedTranscripts, translationLanguages);
  }

  [Symbol.iterator](): Iterator<Transcript> {
    return [...this.manuallyCreatedTranscripts.values(), ...this.generatedTranscripts.values()][Symbol.iterator]();
  }

  findTranscript(languageCodes: Iterable<string>): Transcript {
    return this.findIn(languageCodes, [this.manuallyCreatedTranscripts, this.generatedTranscripts]);
  }

  findGeneratedTranscript(languageCodes: Iterable<string>): Transcript {
    return this.findIn(languageCodes, [this.generatedTranscripts]);
  }

  findManuallyCreatedTranscript(languageCodes: Iterable<string>): Transcript {
    return this.findIn(languageCodes, [this.manuallyCreatedTranscripts]);
  }

  private findIn(languageCodes: Iterable<string>, transcriptMaps: Map<string, Transcript>[]): Transcript {
    // Materialize once: the iterable may be a one-shot generator and is reused
    // by both the exact-match and base-language passes (and the error message).
    const codes = [...languageCodes];
    for (const languageCode of codes) {
      for (const transcriptMap of transcriptMaps) {
        const transcript = transcriptMap.get(languageCode);
        if (transcript) {
          return transcript;
        }
      }
    }
    // Fallback: a request for "en" should match an "en-US"/"en-GB" track (and
    // vice versa) instead of failing — a very common real-world mismatch.
    for (const languageCode of codes) {
      const primary = languageCode.split("-")[0]!.toLowerCase();
      for (const transcriptMap of transcriptMaps) {
        for (const [code, transcript] of transcriptMap) {
          if (code.split("-")[0]!.toLowerCase() === primary) {
            return transcript;
          }
        }
      }
    }
    throw new NoTranscriptFound(this.videoId, codes, this);
  }

  toString(): string {
    return `For this video (${this.videoId}) transcripts are available in the following languages:\n\n(MANUALLY CREATED)\n${describeLanguages(
      [...this.manuallyCreatedTranscripts.values()].map((transcript) => transcript.toString()),
    )}\n\n(GENERATED)\n${describeLanguages(
      [...this.generatedTranscripts.values()].map((transcript) => transcript.toString()),
    )}\n\n(TRANSLATION LANGUAGES)\n${describeLanguages(
      this.translationLanguages.map(
        (translationLanguage) => `${translationLanguage.languageCode} ("${translationLanguage.language}")`,
      ),
    )}`;
  }
}

function describeLanguages(languages: string[]): string {
  return languages.length === 0 ? "None" : languages.map((language) => ` - ${language}`).join("\n");
}

enum PlayabilityStatus {
  OK = "OK",
  ERROR = "ERROR",
  LOGIN_REQUIRED = "LOGIN_REQUIRED",
}

enum PlayabilityFailedReason {
  AGE_RESTRICTED = "This video may be inappropriate for some users.",
  BOT_DETECTED = "Sign in to confirm you’re not a bot",
  VIDEO_UNAVAILABLE = "This video is unavailable",
}

export class TranscriptListFetcher {
  private readonly context: TranscriptContext;

  constructor(
    private readonly httpClient: HttpClient,
    contextOrProxyConfig: TranscriptContext | ProxyConfig = {},
  ) {
    // Backwards compatible: older callers passed a ProxyConfig directly.
    this.context =
      typeof (contextOrProxyConfig as ProxyConfig).toRequestsDict === "function"
        ? { proxyConfig: contextOrProxyConfig as ProxyConfig }
        : (contextOrProxyConfig as TranscriptContext);
  }

  async fetch(videoId: string): Promise<TranscriptList> {
    return TranscriptList.build(this.httpClient, videoId, await this.fetchCaptionsJson(videoId), this.context);
  }

  /** Fetches the raw captions metadata, retrying blocked/transient failures. */
  async fetchCaptionsJson(videoId: string): Promise<Record<string, unknown>> {
    return runWithRetries(async () => {
      const html = await this.fetchVideoHtml(videoId);
      const apiKey = this.extractInnertubeApiKey(html, videoId);
      const innertubeData = await this.fetchInnertubeData(videoId, apiKey);
      return this.extractCaptionsJson(innertubeData, videoId);
    }, this.context);
  }

  private extractInnertubeApiKey(html: string, videoId: string): string {
    const match = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
    if (match?.[1]) {
      return match[1];
    }
    if (html.includes('class="g-recaptcha"')) {
      throw new IpBlocked(videoId);
    }
    throw new YouTubeDataUnparsable(videoId);
  }

  private extractCaptionsJson(innertubeData: Record<string, any>, videoId: string): Record<string, unknown> {
    this.assertPlayability(innertubeData.playabilityStatus as Record<string, any> | undefined, videoId);
    const captionsJson = innertubeData.captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
    if (!captionsJson || !Array.isArray(captionsJson.captionTracks)) {
      throw new TranscriptsDisabled(videoId);
    }
    return captionsJson;
  }

  private assertPlayability(playabilityStatusData: Record<string, any> | undefined, videoId: string): void {
    const playabilityStatus = playabilityStatusData?.status as string | undefined;
    if (!playabilityStatus || playabilityStatus === PlayabilityStatus.OK) {
      return;
    }

    const reason = (playabilityStatusData?.reason as string | undefined) ?? null;
    if (playabilityStatus === PlayabilityStatus.LOGIN_REQUIRED) {
      if (reason === PlayabilityFailedReason.BOT_DETECTED) {
        throw new RequestBlocked(videoId);
      }
      if (reason === PlayabilityFailedReason.AGE_RESTRICTED) {
        throw new AgeRestricted(videoId);
      }
    }

    if (playabilityStatus === PlayabilityStatus.ERROR && reason === PlayabilityFailedReason.VIDEO_UNAVAILABLE) {
      if (videoId.startsWith("http://") || videoId.startsWith("https://")) {
        throw new InvalidVideoId(videoId);
      }
      throw new VideoUnavailable(videoId);
    }

    const subReasons =
      playabilityStatusData?.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.map(
        (run: Record<string, unknown>) => String(run.text ?? ""),
      ) ?? [];
    throw new VideoUnplayable(videoId, reason, subReasons);
  }

  private createConsentCookie(html: string, videoId: string): void {
    const match = html.match(/name="v" value="(.*?)"/);
    if (!match?.[1]) {
      throw new FailedToCreateConsentCookie(videoId);
    }
    this.httpClient.setCookie("CONSENT", `YES+${match[1]}`, ".youtube.com");
  }

  private async fetchVideoHtml(videoId: string): Promise<string> {
    let html = await this.fetchHtml(videoId);
    if (html.includes('action="https://consent.youtube.com/s"')) {
      this.createConsentCookie(html, videoId);
      html = await this.fetchHtml(videoId);
      if (html.includes('action="https://consent.youtube.com/s"')) {
        throw new FailedToCreateConsentCookie(videoId);
      }
    }
    return html;
  }

  private async fetchHtml(videoId: string): Promise<string> {
    const response = ensureSuccess(
      await this.httpClient.get(WATCH_URL.replace("{videoId}", sanitizeVideoId(videoId))),
      videoId,
    );
    return decodeHtmlEntities(await response.text(), 1);
  }

  private async fetchInnertubeData(videoId: string, apiKey: string): Promise<Record<string, any>> {
    const response = ensureSuccess(
      await this.httpClient.postJson(INNERTUBE_API_URL.replace("{apiKey}", apiKey), {
        context: INNERTUBE_CONTEXT,
        videoId: sanitizeVideoId(videoId),
      }),
      videoId,
    );
    try {
      return await response.json<Record<string, any>>();
    } catch {
      throw new YouTubeRequestFailed(videoId, "Invalid JSON response");
    }
  }
}

function parseTranscriptXml(rawData: string, preserveFormatting: boolean): FetchedTranscriptSnippet[] {
  const snippets: FetchedTranscriptSnippet[] = [];
  const regex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawData)) !== null) {
    const content = match[2] ?? "";
    if (content === "") {
      continue;
    }
    const attributes = Object.fromEntries([...match[1].matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    snippets.push(
      new FetchedTranscriptSnippet(
        stripHtml(decodeHtmlEntities(content), preserveFormatting),
        Number.parseFloat(attributes.start ?? "0"),
        Number.parseFloat(attributes.dur ?? "0.0"),
      ),
    );
  }
  return snippets;
}
