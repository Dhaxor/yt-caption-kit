import { createRequire } from "node:module";

import { YtCaptionKit } from "./api.js";
import { FormatterLoader } from "./formatters.js";
import { GenericProxyConfig, WebshareProxyConfig, type ProxyConfig } from "./proxies.js";
import { sanitizeVideoId } from "./utils.js";
import type { FetchedTranscript, TranscriptList } from "./transcripts.js";

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
type TranscriptLike = {
  fetch(): Promise<FetchedTranscript>;
  translate(languageCode: string): TranscriptLike;
};
type TranscriptListLike = Pick<
  TranscriptList,
  "findGeneratedTranscript" | "findManuallyCreatedTranscript" | "findTranscript" | "toString"
>;
type LooseTranscriptListLike = Omit<TranscriptListLike, "findGeneratedTranscript" | "findManuallyCreatedTranscript" | "findTranscript"> & {
  findGeneratedTranscript(languageCodes: Iterable<string>): TranscriptLike;
  findManuallyCreatedTranscript(languageCodes: Iterable<string>): TranscriptLike;
  findTranscript(languageCodes: Iterable<string>): TranscriptLike;
};
type TranscriptApiLike = {
  list(videoId: string): Promise<LooseTranscriptListLike>;
};

export interface ParsedCliArgs {
  excludeGenerated: boolean;
  excludeManuallyCreated: boolean;
  format: keyof typeof FormatterLoader.TYPES;
  help: boolean;
  httpProxy: string;
  httpsProxy: string;
  languages: string[];
  listTranscripts: boolean;
  translate: string;
  version: boolean;
  videoIds: string[];
  webshareProxyPassword: string | null;
  webshareProxyUsername: string | null;
}

export interface CliDependencies {
  apiFactory?: (proxyConfig: ProxyConfig | undefined) => TranscriptApiLike;
  versionResolver?: () => string;
}

export class YtCaptionKitCli {
  constructor(private readonly args: string[], private readonly dependencies: CliDependencies = {}) {}

  async run(): Promise<string> {
    const parsedArgs = this.parseArgs();
    if (parsedArgs.help) {
      return this.buildHelpText();
    }
    if (parsedArgs.version) {
      return `yt-caption-kit, version ${this.getVersion()}`;
    }
    if (parsedArgs.videoIds.length === 0) {
      throw new Error("At least one video ID is required.");
    }
    if (parsedArgs.excludeGenerated && parsedArgs.excludeManuallyCreated) {
      return "";
    }

    const proxyConfig = this.buildProxyConfig(parsedArgs);
    const yttApi = this.dependencies.apiFactory?.(proxyConfig) ?? new YtCaptionKit({ proxyConfig });
    const transcripts: FetchedTranscript[] | LooseTranscriptListLike[] = [];
    const exceptions: string[] = [];

    for (const videoId of parsedArgs.videoIds) {
      try {
        const transcriptList = await yttApi.list(videoId);
        if (parsedArgs.listTranscripts) {
          (transcripts as LooseTranscriptListLike[]).push(transcriptList);
        } else {
          (transcripts as FetchedTranscript[]).push(await this.fetchTranscript(parsedArgs, transcriptList));
        }
      } catch (error) {
        exceptions.push(String(error));
      }
    }

    const sections = [...exceptions];
    if (transcripts.length > 0) {
      if (parsedArgs.listTranscripts) {
        sections.push(...(transcripts as LooseTranscriptListLike[]).map((transcriptList) => transcriptList.toString()));
      } else {
        sections.push(
          new FormatterLoader().load(parsedArgs.format).formatTranscripts(transcripts as FetchedTranscript[]),
        );
      }
    }
    return sections.join("\n\n");
  }

  parseArgs(): ParsedCliArgs {
    const parsed: ParsedCliArgs = {
      excludeGenerated: false,
      excludeManuallyCreated: false,
      format: "pretty",
      help: false,
      httpProxy: "",
      httpsProxy: "",
      languages: ["en"],
      listTranscripts: false,
      translate: "",
      version: false,
      videoIds: [],
      webshareProxyPassword: null,
      webshareProxyUsername: null,
    };

    for (let index = 0; index < this.args.length; index += 1) {
      const arg = this.args[index]!;
      if (arg === "--help" || arg === "-h") {
        parsed.help = true;
        continue;
      }
      if (arg === "--version") {
        parsed.version = true;
        continue;
      }
      if (arg === "--list-transcripts") {
        parsed.listTranscripts = true;
        continue;
      }
      if (arg === "--exclude-generated") {
        parsed.excludeGenerated = true;
        continue;
      }
      if (arg === "--exclude-manually-created") {
        parsed.excludeManuallyCreated = true;
        continue;
      }
      if (arg === "--languages") {
        parsed.languages = [];
        while (
          index + 1 < this.args.length &&
          !this.args[index + 1]!.startsWith("--") &&
          LANGUAGE_CODE_PATTERN.test(sanitizeVideoId(this.args[index + 1]!))
        ) {
          parsed.languages.push(sanitizeVideoId(this.args[index + 1]!));
          index += 1;
        }
        continue;
      }
      if (arg === "--format") {
        parsed.format = this.readNextValue(arg, ++index) as keyof typeof FormatterLoader.TYPES;
        continue;
      }
      if (arg === "--translate") {
        parsed.translate = this.readNextValue(arg, ++index);
        continue;
      }
      if (arg === "--http-proxy") {
        parsed.httpProxy = this.readNextValue(arg, ++index);
        continue;
      }
      if (arg === "--https-proxy") {
        parsed.httpsProxy = this.readNextValue(arg, ++index);
        continue;
      }
      if (arg === "--webshare-proxy-username") {
        parsed.webshareProxyUsername = this.readNextValue(arg, ++index);
        continue;
      }
      if (arg === "--webshare-proxy-password") {
        parsed.webshareProxyPassword = this.readNextValue(arg, ++index);
        continue;
      }
      if (arg.startsWith("--")) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      parsed.videoIds.push(sanitizeVideoId(arg));
    }

    if (!(parsed.format in FormatterLoader.TYPES)) {
      throw new Error(`Unsupported format: ${parsed.format}`);
    }
    return parsed;
  }

  private buildProxyConfig(parsedArgs: ParsedCliArgs): ProxyConfig | undefined {
    if (parsedArgs.webshareProxyUsername || parsedArgs.webshareProxyPassword) {
      if (!parsedArgs.webshareProxyUsername || !parsedArgs.webshareProxyPassword) {
        throw new Error("Both Webshare proxy username and password are required.");
      }
      return new WebshareProxyConfig({
        proxyPassword: parsedArgs.webshareProxyPassword,
        proxyUsername: parsedArgs.webshareProxyUsername,
      });
    }
    if (parsedArgs.httpProxy || parsedArgs.httpsProxy) {
      return new GenericProxyConfig(parsedArgs.httpProxy || undefined, parsedArgs.httpsProxy || undefined);
    }
    return undefined;
  }

  private async fetchTranscript(parsedArgs: ParsedCliArgs, transcriptList: LooseTranscriptListLike): Promise<FetchedTranscript> {
    const transcript = parsedArgs.excludeManuallyCreated
      ? transcriptList.findGeneratedTranscript(parsedArgs.languages)
      : parsedArgs.excludeGenerated
        ? transcriptList.findManuallyCreatedTranscript(parsedArgs.languages)
        : transcriptList.findTranscript(parsedArgs.languages);
    const translatedTranscript = parsedArgs.translate ? transcript.translate(parsedArgs.translate) : transcript;
    return translatedTranscript.fetch();
  }

  private getVersion(): string {
    if (this.dependencies.versionResolver) {
      return this.dependencies.versionResolver();
    }
    const require = createRequire(import.meta.url);
    return (require("../../package.json") as { version?: string }).version ?? "unknown";
  }

  private readNextValue(flag: string, index: number): string {
    const value = this.args[index];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  private buildHelpText(): string {
    return [
      "Usage: yt-caption-kit [options] <video_id ...>",
      "",
      "Options:",
      "  --languages <codes...>",
      "  --list-transcripts",
      "  --exclude-generated",
      "  --exclude-manually-created",
      `  --format <${Object.keys(FormatterLoader.TYPES).join("|")}>`,
      "  --translate <code>",
      "  --webshare-proxy-username <username>",
      "  --webshare-proxy-password <password>",
      "  --http-proxy <url>",
      "  --https-proxy <url>",
      "  --version",
      "  --help",
    ].join("\n");
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const output = await new YtCaptionKitCli(args).run();
  if (output) {
    console.log(output);
  }
}