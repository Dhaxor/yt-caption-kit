import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../app.js";
import { RequestBlocked, TranscriptsDisabled } from "../dist/src/errors.js";

const SNIPPETS = [
  { text: "Hello", start: 0, duration: 1.25 },
  { text: "World", start: 1.25, duration: 2.5 },
];

function stubYt(overrides = {}) {
  return {
    async list() {
      if (overrides.listError) throw overrides.listError;
      return {
        translationLanguages: [{ language: "Arabic", languageCode: "ar" }],
        [Symbol.iterator]() {
          return [
            { language: "English", languageCode: "en", isGenerated: false, isTranslatable: true },
          ][Symbol.iterator]();
        },
      };
    },
    async fetch(videoId, opts = {}) {
      if (overrides.fetchError) throw overrides.fetchError;
      overrides.onFetch?.(opts);
      return {
        videoId,
        language: "English",
        languageCode: opts.translateTo || "en",
        isGenerated: false,
        snippets: SNIPPETS,
        toRawData: () => SNIPPETS,
      };
    },
  };
}

async function withServer(app, fn) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("list endpoint returns transcripts, translation languages, cache + security headers", async () => {
  const app = createApp({ yt: stubYt(), rateLimit: null, serveStatic: false });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/captions/GJLlxj_dtq8`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=86400/);
    const body = await res.json();
    assert.equal(body.transcripts.length, 1);
    assert.deepEqual(body.translationLanguages, [{ language: "Arabic", languageCode: "ar" }]);
  });
});

test("fetch endpoint serves all four formats (the .formatTranscript fix)", async () => {
  const app = createApp({ yt: stubYt(), rateLimit: null, serveStatic: false });
  await withServer(app, async (base) => {
    const json = await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?format=json`);
    assert.equal(json.status, 200);
    assert.equal((await json.json()).snippets.length, 2);

    const srt = await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?format=srt`);
    assert.equal(srt.status, 200);
    assert.match(srt.headers.get("content-type") ?? "", /subrip/);
    assert.match(await srt.text(), /00:00:00,000 --> /);

    const vtt = await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?format=webvtt`);
    assert.equal(vtt.status, 200);
    assert.match(vtt.headers.get("content-type") ?? "", /text\/vtt/);
    assert.match(await vtt.text(), /^WEBVTT/);

    const txt = await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?format=text`);
    assert.equal(txt.status, 200);
    assert.equal(await txt.text(), "Hello\nWorld");
  });
});

test("fetch endpoint validates parameters and video ids", async () => {
  const app = createApp({ yt: stubYt(), rateLimit: null, serveStatic: false });
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/captions/not-an-id/fetch`)).status, 400);
    assert.equal((await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?format=xml`)).status, 400);
    assert.equal((await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?lang=${"x".repeat(50)}`)).status, 400);
  });
});

test("translateTo is forwarded to the transcript client", async () => {
  let seen;
  const app = createApp({
    yt: stubYt({ onFetch: (opts) => { seen = opts.translateTo; } }),
    rateLimit: null,
    serveStatic: false,
  });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/captions/GJLlxj_dtq8/fetch?translateTo=ar`);
    assert.equal(res.status, 200);
    assert.equal(seen, "ar");
  });
});

test("errors map to sanitized typed responses without leaking internals", async () => {
  const disabled = createApp({ yt: stubYt({ listError: new TranscriptsDisabled("x") }), rateLimit: null, serveStatic: false });
  await withServer(disabled, async (base) => {
    const res = await fetch(`${base}/api/captions/GJLlxj_dtq8`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.name, "TranscriptsDisabled");
    assert.doesNotMatch(body.error, /proxy|webshare|open an issue/i);
  });

  const blocked = createApp({ yt: stubYt({ listError: new RequestBlocked("x") }), rateLimit: null, serveStatic: false });
  await withServer(blocked, async (base) => {
    const res = await fetch(`${base}/api/captions/GJLlxj_dtq8`);
    assert.equal(res.status, 503);
    assert.ok(res.headers.get("retry-after"));
  });
});

test("rate limiting returns 429 after the per-window budget", async () => {
  const app = createApp({ yt: stubYt(), rateLimit: { windowMs: 60_000, max: 2 }, serveStatic: false });
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/captions/GJLlxj_dtq8`)).status, 200);
    assert.equal((await fetch(`${base}/api/captions/GJLlxj_dtq8`)).status, 200);
    const limited = await fetch(`${base}/api/captions/GJLlxj_dtq8`);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
  });
});

test("rate limiting cannot be bypassed by spoofing X-Forwarded-For", async () => {
  // trustProxy 0: nothing in front of the test server, so the header is untrusted.
  const app = createApp({ yt: stubYt(), rateLimit: { windowMs: 60_000, max: 2 }, serveStatic: false, trustProxy: 0 });
  await withServer(app, async (base) => {
    const spoof = (ip) => fetch(`${base}/api/captions/GJLlxj_dtq8`, { headers: { "x-forwarded-for": ip } });
    assert.equal((await spoof("1.1.1.1")).status, 200);
    assert.equal((await spoof("2.2.2.2")).status, 200);
    // Third request from the same real client must be limited despite a fresh header.
    assert.equal((await spoof("3.3.3.3")).status, 429);
  });
});

test("unknown /api paths return a JSON 404, not the SPA document", async () => {
  const app = createApp({ yt: stubYt(), rateLimit: null, serveStatic: true });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.equal((await res.json()).name, "NotFound");
  });
});
