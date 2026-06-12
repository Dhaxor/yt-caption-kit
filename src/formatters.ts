import { inspect, type InspectOptions } from "node:util";

import type { FetchedTranscript, FetchedTranscriptSnippet } from "./transcripts.js";
import { formatTimestamp } from "./utils.js";

export abstract class Formatter {
  abstract formatTranscript(transcript: FetchedTranscript, options?: unknown): string;
  abstract formatTranscripts(transcripts: FetchedTranscript[], options?: unknown): string;
}

export class PrettyPrintFormatter extends Formatter {
  formatTranscript(transcript: FetchedTranscript, options: InspectOptions = {}): string {
    return inspect(transcript.toRawData(), {
      colors: false,
      compact: false,
      depth: null,
      maxArrayLength: null,
      ...options,
    });
  }

  formatTranscripts(transcripts: FetchedTranscript[], options: InspectOptions = {}): string {
    return inspect(
      transcripts.map((transcript) => transcript.toRawData()),
      { colors: false, compact: false, depth: null, maxArrayLength: null, ...options },
    );
  }
}

export class JSONFormatter extends Formatter {
  formatTranscript(transcript: FetchedTranscript, options: { replacer?: (key: string, value: unknown) => unknown; space?: number | string } = {}): string {
    return JSON.stringify(transcript.toRawData(), options.replacer, options.space);
  }

  formatTranscripts(transcripts: FetchedTranscript[], options: { replacer?: (key: string, value: unknown) => unknown; space?: number | string } = {}): string {
    return JSON.stringify(
      transcripts.map((transcript) => transcript.toRawData()),
      options.replacer,
      options.space,
    );
  }
}

export class TextFormatter extends Formatter {
  formatTranscript(transcript: FetchedTranscript): string {
    return transcript.snippets.map((line) => line.text).join("\n");
  }

  formatTranscripts(transcripts: FetchedTranscript[]): string {
    return transcripts.map((transcript) => this.formatTranscript(transcript)).join("\n\n\n");
  }
}

abstract class TextBasedFormatter extends TextFormatter {
  protected abstract formatTranscriptHeader(lines: string[]): string;
  protected abstract formatTranscriptLine(index: number, timeText: string, snippet: FetchedTranscriptSnippet): string;
  protected abstract timestampSeparator: "," | ".";

  override formatTranscript(transcript: FetchedTranscript): string {
    const lines = transcript.snippets.map((snippet, index) => {
      const end = snippet.start + snippet.duration;
      const nextStart = transcript.snippets[index + 1]?.start;
      const effectiveEnd = nextStart !== undefined && nextStart < end ? nextStart : end;
      const timeText = `${formatTimestamp(snippet.start, this.timestampSeparator)} --> ${formatTimestamp(
        effectiveEnd,
        this.timestampSeparator,
      )}`;
      return this.formatTranscriptLine(index, timeText, snippet);
    });
    return this.formatTranscriptHeader(lines);
  }
}

export class SRTFormatter extends TextBasedFormatter {
  protected timestampSeparator: "," = ",";

  protected formatTranscriptHeader(lines: string[]): string {
    return `${lines.join("\n\n")}\n`;
  }

  protected formatTranscriptLine(index: number, timeText: string, snippet: FetchedTranscriptSnippet): string {
    return `${index + 1}\n${timeText}\n${snippet.text}`;
  }
}

export class WebVTTFormatter extends TextBasedFormatter {
  protected timestampSeparator: "." = ".";

  protected formatTranscriptHeader(lines: string[]): string {
    return `WEBVTT\n\n${lines.join("\n\n")}\n`;
  }

  protected formatTranscriptLine(_index: number, timeText: string, snippet: FetchedTranscriptSnippet): string {
    return `${timeText}\n${snippet.text}`;
  }
}

export class UnknownFormatterType extends Error {
  constructor(formatterType: string) {
    super(
      `The format '${formatterType}' is not supported. Choose one of the following formats: ${Object.keys(
        FormatterLoader.TYPES,
      ).join(", ")}`,
    );
    this.name = "UnknownFormatterType";
  }
}

export class FormatterLoader {
  static readonly TYPES = {
    json: JSONFormatter,
    pretty: PrettyPrintFormatter,
    srt: SRTFormatter,
    text: TextFormatter,
    webvtt: WebVTTFormatter,
  };

  load(formatterType: keyof typeof FormatterLoader.TYPES = "pretty"): Formatter {
    // Own-property check: `TYPES["constructor"]` is truthy via the prototype
    // chain and would otherwise slip through to `new Object()`.
    if (!Object.hasOwn(FormatterLoader.TYPES, formatterType)) {
      throw new UnknownFormatterType(formatterType);
    }
    return new FormatterLoader.TYPES[formatterType]();
  }
}