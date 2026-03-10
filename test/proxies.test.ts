import assert from "node:assert/strict";
import test from "node:test";

import { GenericProxyConfig, InvalidProxyConfig, WebshareProxyConfig } from "../src/index.js";

test("GenericProxyConfig validates inputs and mirrors missing protocols", () => {
  assert.throws(() => new GenericProxyConfig(), InvalidProxyConfig);

  const httpOnly = new GenericProxyConfig("http://localhost:8080");
  assert.deepEqual(httpOnly.toRequestsDict(), {
    http: "http://localhost:8080",
    https: "http://localhost:8080",
  });
});

test("WebshareProxyConfig builds rotating proxy URLs and retry defaults", () => {
  const proxy = new WebshareProxyConfig({
    filterIpLocations: ["de", "us"],
    proxyPassword: "password",
    proxyUsername: "username-rotate",
  });

  assert.equal(proxy.httpUrl, "http://username-DE-US-rotate:password@p.webshare.io:80/");
  assert.equal(proxy.httpsUrl, proxy.httpUrl);
  assert.equal(proxy.preventKeepingConnectionsAlive, true);
  assert.equal(proxy.retriesWhenBlocked, 10);
});