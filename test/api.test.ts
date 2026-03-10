import assert from "node:assert/strict";
import test from "node:test";

import {
  AgeRestricted,
  FailedToCreateConsentCookie,
  GenericProxyConfig,
  InvalidVideoId,
  IpBlocked,
  NoTranscriptFound,
  NotTranslatable,
  PoTokenRequired,
  RequestBlocked,
  TranscriptList,
  TranscriptsDisabled,
  TranslationLanguageNotAvailable,
  VideoUnavailable,
  VideoUnplayable,
  WebshareProxyConfig,
  YouTubeRequestFailed,
  YtCaptionKit,
} from "../src/index.js";
import { MockHttpClient } from "./helpers/mock-http-client.js";
import { loadAssetJson, loadAssetText } from "./helpers/fixtures.js";

function buildHappyPathClient(): MockHttpClient {
  const client = new MockHttpClient();
  client.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  client.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube.innertube.json.static") });
  client.onGet(/\/api\/timedtext/, { body: loadAssetText("transcript.xml.static") });
  return client;
}

test("fetch returns the expected transcript and strips formatting by default", async () => {
  const client = buildHappyPathClient();
  const api = new YtCaptionKit({ httpClient: client });

  const transcript = await api.fetch("GJLlxj_dtq8");

  assert.equal(transcript.language, "English");
  assert.equal(transcript.languageCode, "en");
  assert.equal(transcript.isGenerated, false);
  assert.equal(transcript.length, 3);
  assert.deepEqual(transcript.toRawData(), [
    { duration: 1.54, start: 0, text: "Hey, this is just a test" },
    { duration: 4.16, start: 1.54, text: "this is not the original transcript" },
    { duration: 3.239, start: 5.7, text: "just something shorter, I made up for testing" },
  ]);
});

test("fetch can preserve inline formatting tags", async () => {
  const client = buildHappyPathClient();
  const api = new YtCaptionKit({ httpClient: client });

  const transcript = await api.fetch("GJLlxj_dtq8", { preserveFormatting: true });

  assert.equal(transcript.at(1)?.text, "this is <i>not</i> the original transcript");
});

test("fetch decodes doubly encoded transcript entities from live-style responses", async () => {
  const client = new MockHttpClient();
  client.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  client.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube.innertube.json.static") });
  client.onGet(/\/api\/timedtext/, {
    body: [
      '<transcript>',
      '  <text start="0.0" dur="1.0">We aren&amp;#39;t done yet</text>',
      '  <text start="1.0" dur="1.0">&amp;gt;&amp;gt; Keep going</text>',
      '</transcript>',
    ].join("\n"),
  });

  const transcript = await new YtCaptionKit({ httpClient: client }).fetch("LKNldR60zss");

  assert.equal(transcript.at(0)?.text, "We aren't done yet");
  assert.equal(transcript.at(1)?.text, ">> Keep going");
});

test("list finds manually created and generated transcripts", async () => {
  const client = buildHappyPathClient();
  const api = new YtCaptionKit({ httpClient: client });

  const transcriptList = await api.list("GJLlxj_dtq8");

  assert.ok(transcriptList instanceof TranscriptList);
  assert.equal(transcriptList.findManuallyCreatedTranscript(["cs"]).isGenerated, false);
  assert.equal(transcriptList.findGeneratedTranscript(["en"]).isGenerated, true);
  assert.throws(() => transcriptList.findGeneratedTranscript(["cs"]), NoTranscriptFound);
});

test("fetch chooses the first available language and falls back correctly", async () => {
  const client = buildHappyPathClient();
  client.onGet(/\/watch\?v=F1xioXWb8CY/, { body: loadAssetText("youtube.html.static") });
  client.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube_ww1_nl_en.innertube.json.static") });
  client.onGet(/\/api\/timedtext/, { body: loadAssetText("transcript.xml.static") });

  const api = new YtCaptionKit({ httpClient: client });
  await api.fetch("GJLlxj_dtq8", { languages: ["de", "en"] });
  await api.fetch("F1xioXWb8CY", { languages: ["de", "en"] });

  const timedtextCalls = client.calls.filter((call) => call.url.includes("/api/timedtext"));
  assert.match(timedtextCalls[0]?.url ?? "", /lang=de/);
  assert.match(timedtextCalls[1]?.url ?? "", /lang=en/);
});

test("translate appends tlang and validates translation availability", async () => {
  const client = buildHappyPathClient();
  const api = new YtCaptionKit({ httpClient: client });
  const transcript = (await api.list("GJLlxj_dtq8")).findTranscript(["en"]);

  const translated = transcript.translate("ar");

  assert.equal(translated.languageCode, "ar");
  assert.match(translated.url, /[?&]tlang=ar/);
  assert.throws(() => transcript.translate("xyz"), TranslationLanguageNotAvailable);
  transcript.translationLanguages = [];
  assert.throws(() => transcript.translate("af"), NotTranslatable);
});

test("consent pages create a consent cookie and retry", async () => {
  const client = new MockHttpClient();
  client.onGet(/\/watch\?v=/, { body: loadAssetText("youtube_consent_page.html.static") }, { body: loadAssetText("youtube.html.static") });
  client.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube.innertube.json.static") });
  client.onGet(/\/api\/timedtext/, { body: loadAssetText("transcript.xml.static") });

  const api = new YtCaptionKit({ httpClient: client });
  await api.fetch("F1xioXWb8CY");

  assert.equal(client.calls.length, 4);
  for (const call of client.calls.slice(1)) {
    assert.equal(call.headers.cookie, "CONSENT=YES+cb.20210328-17-p0.de+FX+119");
  }
});

test("consent failures raise FailedToCreateConsentCookie", async () => {
  const invalidClient = new MockHttpClient();
  invalidClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube_consent_page_invalid.html.static") });
  const invalidApi = new YtCaptionKit({ httpClient: invalidClient });
  await assert.rejects(() => invalidApi.fetch("F1xioXWb8CY"), FailedToCreateConsentCookie);

  const repeatedConsentClient = new MockHttpClient();
  repeatedConsentClient.onGet(
    /\/watch\?v=/,
    { body: loadAssetText("youtube_consent_page.html.static") },
    { body: loadAssetText("youtube_consent_page.html.static") },
  );
  const repeatedConsentApi = new YtCaptionKit({ httpClient: repeatedConsentClient });
  await assert.rejects(() => repeatedConsentApi.fetch("F1xioXWb8CY"), FailedToCreateConsentCookie);
});

test("playability and request errors surface as the expected exceptions", async () => {
  const scenarios = [
    ["youtube_video_unavailable.innertube.json.static", VideoUnavailable, "abc"],
    ["youtube_age_restricted.innertube.json.static", AgeRestricted, "Njp5uhTorCo"],
    ["youtube_request_blocked.innertube.json.static", RequestBlocked, "Njp5uhTorCo"],
    ["youtube_transcripts_disabled.innertube.json.static", TranscriptsDisabled, "dsMFmonKDD4"],
    ["youtube_transcripts_disabled2.innertube.json.static", TranscriptsDisabled, "Fjg5lYqvzUs"],
  ] as const;

  for (const [fixture, ErrorType, videoId] of scenarios) {
    const client = new MockHttpClient();
    client.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
    client.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson(fixture) });
    const api = new YtCaptionKit({ httpClient: client });
    await assert.rejects(() => api.fetch(videoId), ErrorType);
  }
});

test("unplayable, invalid video ids, IP blocks, PO token and HTTP failures are handled", async () => {
  const unplayableClient = new MockHttpClient();
  unplayableClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  unplayableClient.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube_unplayable.innertube.json.static") });
  const api = new YtCaptionKit({ httpClient: unplayableClient });
  await assert.rejects(
    async () => {
      await api.fetch("Njp5uhTorCo");
    },
    (error: unknown) => {
      assert.ok(error instanceof VideoUnplayable);
      assert.equal(error.reason, "Custom Reason");
      assert.deepEqual(error.subReasons, ["Sub Reason 1", "Sub Reason 2"]);
      return true;
    },
  );

  const invalidVideoClient = new MockHttpClient();
  invalidVideoClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  invalidVideoClient.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube_video_unavailable.innertube.json.static") });
  await assert.rejects(
    () => new YtCaptionKit({ httpClient: invalidVideoClient }).list("https://www.youtube.com/watch?v=GJLlxj_dtq8"),
    InvalidVideoId,
  );

  const htmlBlockedClient = new MockHttpClient();
  htmlBlockedClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube_too_many_requests.html.static") });
  await assert.rejects(() => new YtCaptionKit({ httpClient: htmlBlockedClient }).fetch("abc"), IpBlocked);

  const timedtextBlockedClient = new MockHttpClient();
  timedtextBlockedClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  timedtextBlockedClient.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube.innertube.json.static") });
  timedtextBlockedClient.onGet(/\/api\/timedtext/, { statusCode: 429 });
  await assert.rejects(() => new YtCaptionKit({ httpClient: timedtextBlockedClient }).fetch("abc"), IpBlocked);

  const poTokenClient = new MockHttpClient();
  poTokenClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  poTokenClient.onPost(/\/youtubei\/v1\/player\?key=/, { json: loadAssetJson("youtube_po_token_required.innertube.json.static") });
  await assert.rejects(() => new YtCaptionKit({ httpClient: poTokenClient }).fetch("GJLlxj_dtq8"), PoTokenRequired);

  const failedRequestClient = new MockHttpClient();
  failedRequestClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") });
  failedRequestClient.onPost(/\/youtubei\/v1\/player\?key=/, { statusCode: 500, body: "server error" });
  await assert.rejects(() => new YtCaptionKit({ httpClient: failedRequestClient }).fetch("abc"), YouTubeRequestFailed);
});

test("proxy retry behavior retries request-blocked responses and then succeeds or rethrows", async () => {
  const successClient = new MockHttpClient();
  successClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") }, { body: loadAssetText("youtube.html.static") }, { body: loadAssetText("youtube.html.static") }, { body: loadAssetText("youtube.html.static") });
  successClient.onPost(
    /\/youtubei\/v1\/player\?key=/,
    { json: loadAssetJson("youtube_request_blocked.innertube.json.static") },
    { json: loadAssetJson("youtube_request_blocked.innertube.json.static") },
    { json: loadAssetJson("youtube_request_blocked.innertube.json.static") },
    { json: loadAssetJson("youtube.innertube.json.static") },
  );
  successClient.onGet(/\/api\/timedtext/, { body: loadAssetText("transcript.xml.static") });

  const retryingApi = new YtCaptionKit({
    httpClient: successClient,
    proxyConfig: new WebshareProxyConfig({ proxyPassword: "password", proxyUsername: "username" }),
  });
  const transcript = await retryingApi.fetch("Njp5uhTorCo");
  assert.equal(transcript.length, 3);
  assert.equal(successClient.calls.filter((call) => call.method === "POST").length, 4);

  const rethrowingClient = new MockHttpClient();
  rethrowingClient.onGet(/\/watch\?v=/, { body: loadAssetText("youtube.html.static") }, { body: loadAssetText("youtube.html.static") });
  rethrowingClient.onPost(
    /\/youtubei\/v1\/player\?key=/,
    { json: loadAssetJson("youtube_request_blocked.innertube.json.static") },
    { json: loadAssetJson("youtube_request_blocked.innertube.json.static") },
  );

  const genericApi = new YtCaptionKit({
    httpClient: rethrowingClient,
    proxyConfig: new GenericProxyConfig("http://localhost:8080", "http://localhost:8080"),
  });
  await assert.rejects(
    () => genericApi.fetch("Njp5uhTorCo"),
    (error: unknown) => {
      assert.ok(error instanceof RequestBlocked);
      assert.match(String(error), /YouTube is blocking your requests/);
      return true;
    },
  );
});