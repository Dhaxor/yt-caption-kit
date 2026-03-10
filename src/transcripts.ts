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
import { INNERTUBE_API_URL, INNERTUBE_CONTEXT, WATCH_URL } from "./settings.js";
import { decodeHtmlEntities, sanitizeVideoId, stripHtml } from "./utils.js";

export interface TranslationLanguage {
  language: string;
  languageCode: string;
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

function ensureSuccess(response: HttpResponse, videoId: string): HttpResponse {
  if (response.statusCode === 429) {
    throw new IpBlocked(videoId);
  }
  if (response.statusCode >= 400) {
    throw new YouTubeRequestFailed(videoId, `HTTP ${response.statusCode}`);
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
  ) {
    this.translationLanguagesByCode = new Map(
      translationLanguages.map((translationLanguage) => [
        translationLanguage.languageCode,
        translationLanguage.language,
      ]),
    );
  }

  async fetch(preserveFormatting = false): Promise<FetchedTranscript> {
    if (this.url.includes("&exp=xpe")) {
      throw new PoTokenRequired(this.videoId);
    }
    const response = ensureSuccess(await this.httpClient.get(this.url), this.videoId);
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
    );
  }

  toString(): string {
    return `${this.languageCode} ("${this.language}")${this.isTranslatable ? "[TRANSLATABLE]" : ""}`;
  }
}

export class TranscriptList implements Iterable<Transcript> {
  constructor(
    public readonly videoId: string,
    private readonly manuallyCreatedTranscripts: Map<string, Transcript>,
    private readonly generatedTranscripts: Map<string, Transcript>,
    private readonly translationLanguages: TranslationLanguage[],
  ) {}

  static build(httpClient: HttpClient, videoId: string, captionsJson: Record<string, unknown>): TranscriptList {
    const translationLanguages = ((captionsJson.translationLanguages as Array<Record<string, any>> | undefined) ?? []).map(
      (translationLanguage) => ({
        language: translationLanguage.languageName.runs[0].text as string,
        languageCode: translationLanguage.languageCode as string,
      }),
    );
    const manuallyCreatedTranscripts = new Map<string, Transcript>();
    const generatedTranscripts = new Map<string, Transcript>();

    for (const caption of captionsJson.captionTracks as Array<Record<string, any>>) {
      const transcript = new Transcript(
        httpClient,
        videoId,
        (caption.baseUrl as string).replace("&fmt=srv3", ""),
        caption.name.runs[0].text as string,
        caption.languageCode as string,
        caption.kind === "asr",
        caption.isTranslatable ? translationLanguages : [],
      );
      (caption.kind === "asr" ? generatedTranscripts : manuallyCreatedTranscripts).set(
        caption.languageCode as string,
        transcript,
      );
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
    for (const languageCode of languageCodes) {
      for (const transcriptMap of transcriptMaps) {
        const transcript = transcriptMap.get(languageCode);
        if (transcript) {
          return transcript;
        }
      }
    }
    throw new NoTranscriptFound(this.videoId, languageCodes, this);
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
  constructor(private readonly httpClient: HttpClient, private readonly proxyConfig?: ProxyConfig) {}

  async fetch(videoId: string): Promise<TranscriptList> {
    return TranscriptList.build(this.httpClient, videoId, await this.fetchCaptionsJson(videoId));
  }

  private async fetchCaptionsJson(videoId: string, tryNumber = 0): Promise<Record<string, unknown>> {
    try {
      const html = await this.fetchVideoHtml(videoId);
      const apiKey = this.extractInnertubeApiKey(html, videoId);
      const innertubeData = await this.fetchInnertubeData(videoId, apiKey);
      return this.extractCaptionsJson(innertubeData, videoId);
    } catch (error) {
      if (error instanceof RequestBlocked) {
        const retries = this.proxyConfig?.retriesWhenBlocked ?? 0;
        if (tryNumber + 1 < retries) {
          return this.fetchCaptionsJson(videoId, tryNumber + 1);
        }
        throw error.withProxyConfig(this.proxyConfig);
      }
      throw error;
    }
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
    return decodeHtmlEntities(await response.text());
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