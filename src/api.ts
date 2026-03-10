import { DefaultHttpClient, type HttpClient } from "./http-client.js";
import type { ProxyConfig } from "./proxies.js";
import { TranscriptList, TranscriptListFetcher, type FetchedTranscript } from "./transcripts.js";

export interface YtCaptionKitOptions {
  proxyConfig?: ProxyConfig;
  httpClient?: HttpClient;
}

export interface FetchTranscriptOptions {
  languages?: Iterable<string>;
  preserveFormatting?: boolean;
}

export class YtCaptionKit {
  private readonly fetcher: TranscriptListFetcher;

  constructor(options: YtCaptionKitOptions = {}) {
    const httpClient = options.httpClient ?? new DefaultHttpClient(options.proxyConfig);
    this.fetcher = new TranscriptListFetcher(httpClient, options.proxyConfig);
  }

  async fetch(videoId: string, options: FetchTranscriptOptions = {}): Promise<FetchedTranscript> {
    const languages = options.languages ?? ["en"];
    const preserveFormatting = options.preserveFormatting ?? false;
    return (await this.list(videoId)).findTranscript(languages).fetch(preserveFormatting);
  }

  async list(videoId: string): Promise<TranscriptList> {
    return this.fetcher.fetch(videoId);
  }
}