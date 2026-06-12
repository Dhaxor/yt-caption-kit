import { WATCH_URL } from "./settings.js";
import type { ProxyConfig } from "./proxies.js";
import { GenericProxyConfig, WebshareProxyConfig } from "./proxies.js";
import type { TranscriptList } from "./transcripts.js";

export class YtCaptionKitError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CookieError extends YtCaptionKitError {}

export class CookiePathInvalid extends CookieError {}

export class CookieInvalid extends CookieError {}

export class CouldNotRetrieveTranscript extends YtCaptionKitError {
  protected errorMessage = "\nCould not retrieve a transcript for the video {videoUrl}!";
  protected causeMessageIntro = " This is most likely caused by:\n\n{cause}";
  protected githubReferral =
    "\n\nIf you are sure that the described cause is not responsible for this error and that a transcript should be retrievable, please open an issue for this package and include the video ID, package version, runtime details, and a minimal reproduction.";

  /** Parsed Retry-After hint (in milliseconds) when YouTube provided one. */
  retryAfterMs?: number;

  constructor(public readonly videoId: string) {
    super();
    // Error sets no own "message" when constructed without one, so expose the
    // human-readable cause lazily; subclass fields used by causeText are only
    // assigned after this constructor returns.
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: false,
      get: () => this.toString(),
    });
  }

  protected get causeText(): string {
    return "";
  }

  override toString(): string {
    let message = this.errorMessage.replace("{videoUrl}", WATCH_URL.replace("{videoId}", this.videoId));
    if (this.causeText) {
      message += this.causeMessageIntro.replace("{cause}", this.causeText) + this.githubReferral;
    }
    return message;
  }
}

export class YouTubeDataUnparsable extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "The data required to fetch the transcript is not parsable. This should not happen, please open an issue (make sure to include the video ID)!";
  }
}

export class YouTubeRequestFailed extends CouldNotRetrieveTranscript {
  constructor(videoId: string, public readonly reason: string, public readonly statusCode?: number) {
    super(videoId);
  }

  protected override get causeText(): string {
    return `Request to YouTube failed: ${this.reason}`;
  }
}

export class VideoUnplayable extends CouldNotRetrieveTranscript {
  constructor(videoId: string, public readonly reason: string | null, public readonly subReasons: string[]) {
    super(videoId);
  }

  protected override get causeText(): string {
    const baseReason = this.reason ?? "No reason specified!";
    const details = this.subReasons.length
      ? `\n\nAdditional Details:\n${this.subReasons.map((subReason) => ` - ${subReason}`).join("\n")}`
      : "";
    return `The video is unplayable for the following reason: ${baseReason}${details}`;
  }
}

export class VideoUnavailable extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "The video is no longer available";
  }
}

export class InvalidVideoId extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return 'You provided an invalid video id. Make sure you are using the video id and NOT the url!\n\nDo NOT run: `new YtCaptionKit().fetch("https://www.youtube.com/watch?v=1234")`\nInstead run: `new YtCaptionKit().fetch("1234")`';
  }
}

export class RequestBlocked extends CouldNotRetrieveTranscript {
  static readonly BASE_CAUSE_MESSAGE =
    "YouTube is blocking requests from your IP. This usually is due to one of the following reasons:\n- You have done too many requests and your IP has been blocked by YouTube\n- You are doing requests from an IP belonging to a cloud provider (like AWS, Google Cloud Platform, Azure, etc.). Unfortunately, most IPs from cloud providers are blocked by YouTube.\n\n";
  protected proxyConfig?: ProxyConfig;

  withProxyConfig(proxyConfig?: ProxyConfig): this {
    this.proxyConfig = proxyConfig;
    return this;
  }

  protected override get causeText(): string {
    if (this.proxyConfig instanceof WebshareProxyConfig) {
      return 'YouTube is blocking your requests, despite you using Webshare proxies. Make sure you are using rotating residential proxies instead of proxy-server or static-residential products, because those are blocked much more often.\n\nA large rotating residential pool is usually the most reliable way to keep finding IPs that have not been blocked yet.';
    }
    if (this.proxyConfig instanceof GenericProxyConfig) {
      return 'YouTube is blocking your requests, despite you using proxies. A proxy only substitutes your visible IP address; it does not guarantee that the proxy IP itself is not already blocked.\n\nIn practice, rotating residential IPs tend to be far more reliable than a small fixed proxy pool.';
    }
    return `${RequestBlocked.BASE_CAUSE_MESSAGE}Two common mitigations are:\n1. Route requests through a proxy or a rotating residential proxy pool.\n2. Reduce request volume and retry later if your current IP has been rate-limited.\n\nAuthenticating requests with personal cookies is not recommended because YouTube may still ban the account used for those requests.`;
  }
}

export class IpBlocked extends RequestBlocked {
  protected override get causeText(): string {
    if (this.proxyConfig instanceof WebshareProxyConfig) {
      return 'YouTube is blocking the IPs of your requests, despite you using Webshare proxies. Make sure you are using rotating residential proxies instead of proxy-server or static-residential products, because those are blocked much more often.';
    }
    if (this.proxyConfig instanceof GenericProxyConfig) {
      return 'YouTube is blocking the IP of your proxy. A proxy only substitutes your visible IP address; rotate to a different proxy IP before retrying.';
    }
    return `${RequestBlocked.BASE_CAUSE_MESSAGE}Use a different IP address or a rotating proxy pool before retrying.\n`;
  }
}

export class TranscriptsDisabled extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "Subtitles are disabled for this video";
  }
}

export class AgeRestricted extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return 'This video is age-restricted. Therefore, you are unable to retrieve transcripts for it without authenticating yourself.\n\nYou can authenticate by exporting your YouTube cookies to a Netscape-format cookies.txt file and passing its path via the "cookiesPath" option: `new YtCaptionKit({ cookiesPath: "/path/to/cookies.txt" })`. Note that YouTube may still ban accounts used for automated requests.';
  }
}

export class NotTranslatable extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "The requested language is not translatable";
  }
}

export class TranslationLanguageNotAvailable extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "The requested translation language is not available";
  }
}

export class FailedToCreateConsentCookie extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "Failed to automatically give consent to saving cookies";
  }
}

export class NoTranscriptFound extends CouldNotRetrieveTranscript {
  private readonly requestedLanguageCodes: string[];

  constructor(videoId: string, requestedLanguageCodes: Iterable<string>, private readonly transcriptData: TranscriptList) {
    super(videoId);
    // Materialize eagerly: a one-shot Iterable (e.g. a generator) may already
    // be exhausted by the lookup that failed, which would hide the codes here.
    this.requestedLanguageCodes = [...requestedLanguageCodes];
  }

  protected override get causeText(): string {
    return `No transcripts were found for any of the requested language codes: ${this.requestedLanguageCodes}\n\n${this.transcriptData.toString()}`;
  }
}

export class PoTokenRequired extends CouldNotRetrieveTranscript {
  protected override get causeText(): string {
    return "The requested video cannot be retrieved without a PO Token. If this persists, please open an issue for this package.";
  }
}