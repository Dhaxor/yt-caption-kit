import { YtCaptionKit } from "./dist/src/index.js";
import { GenericProxyConfig, WebshareProxyConfig } from "./dist/src/proxies.js";

import { createApp } from "./app.js";

function buildProxyConfig() {
  // Raw credential string: IP:PORT:USERNAME:PASSWORD (static/dedicated proxy)
  if (process.env.WEBSHARE_PROXY) {
    const parts = process.env.WEBSHARE_PROXY.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      const url = `http://${username}:${password}@${host}:${port}`;
      return new GenericProxyConfig(url);
    }
  }

  // Webshare rotating proxy (p.webshare.io)
  if (process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD) {
    return new WebshareProxyConfig({
      proxyUsername: process.env.WEBSHARE_PROXY_USERNAME,
      proxyPassword: process.env.WEBSHARE_PROXY_PASSWORD,
      filterIpLocations: process.env.WEBSHARE_FILTER_IP_LOCATIONS
        ? process.env.WEBSHARE_FILTER_IP_LOCATIONS.split(",").map((s) => s.trim())
        : undefined,
    });
  }

  // Generic HTTP/HTTPS/SOCKS proxy
  if (process.env.PROXY_URL) {
    return new GenericProxyConfig(process.env.PROXY_URL);
  }

  return undefined;
}

const proxyConfig = buildProxyConfig();

// Let the library enforce timeouts and transient-error retries so the request
// fails fast with a typed error instead of hanging the serverless function.
const yt = new YtCaptionKit({
  proxyConfig,
  timeoutMs: Number(process.env.YT_TIMEOUT_MS) || 20_000,
  retry: { retries: 2 },
});

const app = createApp({
  yt,
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  rateLimit:
    process.env.RATE_LIMIT_DISABLED === "true"
      ? null
      : {
          windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
          max: Number(process.env.RATE_LIMIT_MAX) || 30,
        },
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Get YT Transcripts → http://localhost:${PORT}`);
    if (!proxyConfig) {
      console.warn("No proxy configured — set WEBSHARE_PROXY_USERNAME / WEBSHARE_PROXY_PASSWORD or PROXY_URL env vars.");
    }
  });
}

export default app;
