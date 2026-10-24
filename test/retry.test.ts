import assert from "node:assert/strict";
import test from "node:test";

import { RequestBlocked, YouTubeRequestFailed } from "../src/errors.js";
import type { ProxyConfig } from "../src/proxies.js";
import { resolveRetryPolicy, runWithRetries } from "../src/retry.js";

function fakeProxy(retriesWhenBlocked: number): ProxyConfig {
  return {
    toRequestsDict: () => ({ http: "http://x", https: "http://x" }),
    preventKeepingConnectionsAlive: false,
    retriesWhenBlocked,
  };
}

test("resolveRetryPolicy is disabled unless retries > 0", () => {
  assert.equal(resolveRetryPolicy(undefined), undefined);
  assert.equal(resolveRetryPolicy({ retries: 0 }), undefined);
  assert.ok(resolveRetryPolicy({ retries: 2 }));
});

test("runWithRetries retries transient failures with backoff then succeeds", async () => {
  const sleeps: number[] = [];
  const policy = resolveRetryPolicy({
    retries: 3,
    jitter: false,
    backoffMs: 10,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  let calls = 0;
  const result = await runWithRetries(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new YouTubeRequestFailed("v", "HTTP 503", 503);
      }
      return "ok";
    },
    { retryPolicy: policy },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("runWithRetries rotates blocked errors via the proxy budget without delay", async () => {
  let calls = 0;
  const result = await runWithRetries(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new RequestBlocked("v");
      }
      return "ok";
    },
    { proxyConfig: fakeProxy(5) },
  );
  assert.equal(calls, 3);
  assert.equal(result, "ok");
});

test("runWithRetries rethrows a terminal blocked error after exhausting the budget", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithRetries(
        async () => {
          calls += 1;
          throw new RequestBlocked("v");
        },
        { proxyConfig: fakeProxy(0) },
      ),
    RequestBlocked,
  );
  assert.equal(calls, 1);
});

test("runWithRetries never retries a user-initiated abort", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithRetries(
        async () => {
          calls += 1;
          const abort = new Error("This operation was aborted");
          abort.name = "AbortError";
          throw abort;
        },
        { retryPolicy: resolveRetryPolicy({ retries: 5, sleep: async () => {} }), proxyConfig: fakeProxy(5) },
      ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("runWithRetries does not retry non-transient errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithRetries(
        async () => {
          calls += 1;
          throw new YouTubeRequestFailed("v", "HTTP 404", 404);
        },
        { retryPolicy: resolveRetryPolicy({ retries: 3, sleep: async () => {} }) },
      ),
    YouTubeRequestFailed,
  );
  assert.equal(calls, 1);
});
