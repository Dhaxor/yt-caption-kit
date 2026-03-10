import assert from "node:assert/strict";
import test from "node:test";

import * as publicApi from "../src/index.js";

test("top-level public API exports the expected primary entry points", () => {
  assert.equal(typeof publicApi.YtCaptionKit, "function");
  assert.equal(typeof publicApi.TranscriptList, "function");
  assert.equal(typeof publicApi.Transcript, "function");
  assert.equal(typeof publicApi.FetchedTranscript, "function");
  assert.equal(typeof publicApi.JSONFormatter, "function");
  assert.equal(typeof publicApi.WebVTTFormatter, "function");
  assert.equal(typeof publicApi.SRTFormatter, "function");
  assert.equal(typeof publicApi.GenericProxyConfig, "function");
  assert.equal(typeof publicApi.WebshareProxyConfig, "function");
  assert.equal(typeof publicApi.RequestBlocked, "function");
  assert.equal(typeof publicApi.NoTranscriptFound, "function");
});