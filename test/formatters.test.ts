import assert from "node:assert/strict";
import test from "node:test";

import {
  FetchedTranscript,
  FetchedTranscriptSnippet,
  FormatterLoader,
  JSONFormatter,
  SRTFormatter,
  TextFormatter,
  UnknownFormatterType,
  WebVTTFormatter,
} from "../src/index.js";

const transcript = new FetchedTranscript(
  [
    new FetchedTranscriptSnippet("Hello", 0, 1.25),
    new FetchedTranscriptSnippet("World", 1.25, 2.5),
  ],
  "video-id",
  "English",
  "en",
  false,
);

test("JSON and text formatters serialize transcripts", () => {
  assert.equal(new JSONFormatter().formatTranscript(transcript), JSON.stringify(transcript.toRawData()));
  assert.equal(new TextFormatter().formatTranscript(transcript), "Hello\nWorld");
});

test("SRT and WebVTT formatters render timed output", () => {
  assert.equal(
    new SRTFormatter().formatTranscript(transcript),
    "1\n00:00:00,000 --> 00:00:01,250\nHello\n\n2\n00:00:01,250 --> 00:00:03,750\nWorld\n",
  );
  assert.equal(
    new WebVTTFormatter().formatTranscript(transcript),
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nHello\n\n00:00:01.250 --> 00:00:03.750\nWorld\n",
  );
});

test("FormatterLoader loads known types and rejects unknown ones", () => {
  assert.ok(new FormatterLoader().load("json") instanceof JSONFormatter);
  assert.throws(() => new FormatterLoader().load("csv" as never), UnknownFormatterType);
});