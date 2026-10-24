import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptList, YouTubeDataUnparsable } from "../src/index.js";
import { MockHttpClient } from "./helpers/mock-http-client.js";

test("TranscriptList.build skips malformed tracks and supports simpleText names + base-language fallback", () => {
  const client = new MockHttpClient();
  const captionsJson = {
    captionTracks: [
      { baseUrl: "https://x/timedtext?lang=en-US", name: { simpleText: "English (US)" }, languageCode: "en-US" },
      { name: { runs: [{ text: "Broken" }] }, languageCode: "br" }, // no baseUrl -> skipped
    ],
    translationLanguages: [{ languageName: { runs: [{ text: "Arabic" }] }, languageCode: "ar" }],
  };

  const list = TranscriptList.build(client, "vid", captionsJson);

  // Base-language fallback: a request for "en" resolves to the "en-US" track.
  const t = list.findTranscript(["en"]);
  assert.equal(t.languageCode, "en-US");
  assert.equal(t.language, "English (US)");
  assert.deepEqual(list.translationLanguages, [{ language: "Arabic", languageCode: "ar" }]);

  // The malformed (baseUrl-less) track was skipped.
  assert.throws(() => list.findTranscript(["br"]), /No transcripts were found/);
});

test("TranscriptList.build wraps response-shape drift in YouTubeDataUnparsable", () => {
  const client = new MockHttpClient();
  assert.throws(() => TranscriptList.build(client, "vid", { captionTracks: 42 as unknown as unknown[] }), YouTubeDataUnparsable);
});
