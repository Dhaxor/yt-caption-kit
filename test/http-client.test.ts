import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DefaultHttpClient } from "../src/http-client.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("DefaultHttpClient sends a User-Agent and returns the body", async () => {
  let seenUA: string | undefined;
  const server = createServer((req, res) => {
    seenUA = req.headers["user-agent"];
    res.end("hello");
  });
  const port = await listen(server);
  try {
    const res = await new DefaultHttpClient().get(`http://127.0.0.1:${port}/`);
    assert.equal(res.statusCode, 200);
    assert.equal(await res.text(), "hello");
    assert.match(seenUA ?? "", /Mozilla/);
  } finally {
    await close(server);
  }
});

test("DefaultHttpClient follows redirects up to the limit", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: "/dest" });
      res.end();
    } else {
      res.end("arrived");
    }
  });
  const port = await listen(server);
  try {
    const res = await new DefaultHttpClient().get(`http://127.0.0.1:${port}/start`);
    assert.equal(res.statusCode, 200);
    assert.equal(await res.text(), "arrived");
  } finally {
    await close(server);
  }
});

test("DefaultHttpClient times out a stalled response instead of hanging", async () => {
  const server = createServer(() => {
    /* never responds */
  });
  const port = await listen(server);
  try {
    const client = new DefaultHttpClient({ timeoutMs: 150 });
    await assert.rejects(() => client.get(`http://127.0.0.1:${port}/`), /timed out/);
  } finally {
    await close(server);
  }
});

test("DefaultHttpClient rejects (does not hang) when the connection drops mid-body", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-length": "100" });
    res.write("partial");
    res.socket?.destroy();
  });
  const port = await listen(server);
  try {
    await assert.rejects(() => new DefaultHttpClient({ timeoutMs: 2000 }).get(`http://127.0.0.1:${port}/`));
  } finally {
    await close(server);
  }
});
