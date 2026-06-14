import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { YtCaptionKit } from "./api.js";
import { FormatterLoader } from "./formatters.js";
import { GenericProxyConfig, WebshareProxyConfig, type ProxyConfig } from "./proxies.js";
import { extractVideoId, sanitizeVideoId } from "./utils.js";
import type { FetchedTranscript, TranscriptList } from "./transcripts.js";

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
type TranscriptLike = {
  fetch(preserveFormatting?: boolean): Promise<FetchedTranscript>;
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
  output: string | null;
  preserveFormatting: boolean;
  translate: string;
  version: boolean;
  videoIds: string[];
  webshareProxyPassword: string | null;
  webshareProxyUsername: string | null;
}

export interface CliDependencies {
  apiFactory?: (proxyConfig: ProxyConfig | undefined) => TranscriptApiLike;
  versionResolver?: () => string;
  stdin?: () => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
}

export interface CliRunResult {
  /** Content destined for stdout (empty when written to files via --output). */
  output: string;
  /** Per-video failures, destined for stderr. */
  errors: string[];
}

export class YtCaptionKitCli {
  /** Populated after run(); also surfaced via the CliRunResult. */
  readonly failures: string[] = [];

  constructor(private readonly args: string[], private readonly dependencies: CliDependencies = {}) {}

  /** Runs the CLI, returning stdout text (back-compat). Errors are in `failures`. */
  async run(): Promise<string> {
    return (await this.execute()).output;
  }

  async execute(): Promise<CliRunResult> {
    const parsedArgs = this.parseArgs();
    if (parsedArgs.help) {
      return { output: this.buildHelpText(), errors: [] };
    }
    if (parsedArgs.version) {
      return { output: `yt-caption-kit, version ${this.getVersion()}`, errors: [] };
    }

    const videoIds = await this.resolveVideoIds(parsedArgs.videoIds);
    if (videoIds.length === 0) {
      throw new Error("At least one video ID is required.");
    }
    if (parsedArgs.excludeGenerated && parsedArgs.excludeManuallyCreated) {
      return { output: "", errors: [] };
    }

    const proxyConfig = this.buildProxyConfig(parsedArgs);
    const yttApi = this.dependencies.apiFactory?.(proxyConfig) ?? new YtCaptionKit({ proxyConfig });

    const lists: Array<{ id: string; list: LooseTranscriptListLike }> = [];
    const fetched: Array<{ id: string; transcript: FetchedTranscript }> = [];

    for (const videoId of videoIds) {
      try {
        const transcriptList = await yttApi.list(videoId);
        if (parsedArgs.listTranscripts) {
          lists.push({ id: videoId, list: transcriptList });
        } else {
          fetched.push({ id: videoId, transcript: await this.fetchTranscript(parsedArgs, transcriptList) });
        }
      } catch (error) {
        this.failures.push(`${videoId}: ${String(error)}`);
      }
    }

    const output = await this.renderOutput(parsedArgs, lists, fetched);
    return { output, errors: this.failures };
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
      output: null,
      preserveFormatting: false,
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
      if (arg === "--preserve-formatting") {
        parsed.preserveFormatting = true;
        continue;
      }
      if (arg === "--languages") {
        parsed.languages = [];
        while (index + 1 < this.args.length) {
          const candidate = sanitizeVideoId(this.args[index + 1]!);
          // Stop at the next flag or at anything that looks like a video ID
          // (11 chars) rather than a short language code.
          if (this.args[index + 1]!.startsWith("--") || candidate.length > 10 || !LANGUAGE_CODE_PATTERN.test(candidate)) {
            break;
          }
          parsed.languages.push(candidate);
          index += 1;
        }
        if (parsed.languages.length === 0) {
          throw new Error("Missing value for --languages");
        }
        continue;
      }
      if (arg === "--format") {
        parsed.format = this.readNextValue(arg, ++index) as keyof typeof FormatterLoader.TYPES;
        continue;
      }
      if (arg === "--output" || arg === "-o") {
        parsed.output = this.readNextValue(arg, ++index);
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
      // Single-dash tokens (other than the "-" stdin sentinel) are unknown
      // flags, not video IDs. Backslash-escaped ids (\-id) arrive here too and
      // are de-escaped by sanitizeVideoId below.
      if (arg.startsWith("-") && arg !== "-") {
        throw new Error(`Unknown argument: ${arg}`);
      }
      parsed.videoIds.push(sanitizeVideoId(arg));
    }

    // Object.hasOwn: the `in` operator would accept prototype keys like
    // "constructor" and crash later inside the formatter loader.
    if (!Object.hasOwn(FormatterLoader.TYPES, parsed.format)) {
      throw new Error(`Unsupported format: ${parsed.format}`);
    }
    return parsed;
  }

  private async resolveVideoIds(videoIds: string[]): Promise<string[]> {
    if (!videoIds.includes("-")) {
      return videoIds;
    }
    // Expand the "-" sentinel into newline/whitespace-separated tokens from stdin.
    const stdinContent = await (this.dependencies.stdin?.() ?? readStdin());
    const stdinIds = stdinContent
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const expanded: string[] = [];
    for (const id of videoIds) {
      if (id === "-") {
        expanded.push(...stdinIds);
      } else {
        expanded.push(id);
      }
    }
    return expanded;
  }

  private async renderOutput(
    parsedArgs: ParsedCliArgs,
    lists: Array<{ id: string; list: LooseTranscriptListLike }>,
    fetched: Array<{ id: string; transcript: FetchedTranscript }>,
  ): Promise<string> {
    const loader = new FormatterLoader();

    if (parsedArgs.listTranscripts) {
      const text = lists.map((entry) => entry.list.toString()).join("\n\n");
      return this.emit(parsedArgs, text, lists.map((entry) => ({ id: entry.id, content: entry.list.toString() })));
    }

    if (fetched.length === 0) {
      return "";
    }

    const formatter = loader.load(parsedArgs.format);
    const combined = formatter.formatTranscripts(fetched.map((entry) => entry.transcript));
    const perVideo = fetched.map((entry) => ({
      id: entry.id,
      content: formatter.formatTranscript(entry.transcript),
    }));
    return this.emit(parsedArgs, combined, perVideo);
  }

  private async emit(
    parsedArgs: ParsedCliArgs,
    combined: string,
    perVideo: Array<{ id: string; content: string }>,
  ): Promise<string> {
    if (!parsedArgs.output) {
      return combined;
    }
    const write = this.dependencies.writeFile ?? ((path: string, content: string) => writeFile(path, content, "utf8"));
    if (parsedArgs.output.includes("{videoId}")) {
      for (const entry of perVideo) {
        const resolvedId = extractVideoId(entry.id) ?? sanitizeVideoId(entry.id);
        await write(parsedArgs.output.replace(/\{videoId\}/g, resolvedId), entry.content);
      }
    } else {
      await write(parsedArgs.output, combined.endsWith("\n") ? combined : `${combined}\n`);
    }
    // Confirmation goes to stderr (via failures-adjacent channel); keep stdout clean.
    return "";
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
    return translatedTranscript.fetch(parsedArgs.preserveFormatting);
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
    if (value === undefined || (value.startsWith("--") && value.length > 2)) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  private buildHelpText(): string {
    return [
      "Usage: yt-caption-kit [options] <video_id|url ...>",
      "",
      "Accepts bare 11-character video IDs or full YouTube URLs (watch, youtu.be,",
      "shorts, embed, live). Pass '-' to read newline-separated IDs from stdin.",
      "",
      "Options:",
      "  --languages <codes...>            Preferred languages, most-preferred first (default: en)",
      "  --list-transcripts               List available transcripts instead of fetching",
      "  --exclude-generated              Ignore auto-generated transcripts",
      "  --exclude-manually-created       Ignore manually created transcripts",
      "  --preserve-formatting            Keep inline <i>/<b> formatting tags",
      `  --format <${Object.keys(FormatterLoader.TYPES).join("|")}>   Output format (default: pretty)`,
      "  --translate <code>               Translate into the given language code",
      "  --output, -o <file>              Write to a file ('{videoId}' templates per-video files)",
      "  --webshare-proxy-username <username>",
      "  --webshare-proxy-password <password>",
      "  --http-proxy <url>",
      "  --https-proxy <url>",
      "  --version",
      "  --help",
    ].join("\n");
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const cli = new YtCaptionKitCli(args);
  const { output, errors } = await cli.execute();
  if (output) {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}
