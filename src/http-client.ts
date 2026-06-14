import { request as httpRequest, type Agent } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

import { ProxyAgent } from "proxy-agent";

import type { ProxyConfig } from "./proxies.js";
import { DEFAULT_USER_AGENT } from "./settings.js";

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export interface HttpClient {
  get(url: string): Promise<HttpResponse>;
  postJson(url: string, body: unknown): Promise<HttpResponse>;
  setCookie(name: string, value: string, domain?: string): void;
}

export interface DefaultHttpClientOptions {
  proxyConfig?: ProxyConfig;
  /** Inactivity timeout per request in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Maximum number of 3xx redirects followed per request. Default: 5. */
  maxRedirects?: number;
  /** Overrides the default browser-like User-Agent header. */
  userAgent?: string;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Custom agent for keep-alive tuning, mTLS, SOCKS, or testing.
   * Takes precedence over proxyConfig and useEnvProxy.
   */
  agent?: Agent;
  /** Resolve the proxy from HTTP_PROXY/HTTPS_PROXY/NO_PROXY env variables. */
  useEnvProxy?: boolean;
  /** Aborts in-flight requests when triggered. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

class BufferedHttpResponse implements HttpResponse {
  constructor(
    public readonly statusCode: number,
    public readonly headers: Record<string, string | string[] | undefined>,
    private readonly bodyText: string,
  ) {}

  async text(): Promise<string> {
    return this.bodyText;
  }

  async json<T>(): Promise<T> {
    return JSON.parse(this.bodyText) as T;
  }
}

function isProxyConfig(value: DefaultHttpClientOptions | ProxyConfig): value is ProxyConfig {
  return typeof (value as ProxyConfig).toRequestsDict === "function";
}

export class DefaultHttpClient implements HttpClient {
  private readonly cookies = new Map<string, string>();
  private readonly defaultHeaders: Record<string, string>;
  private readonly proxyConfig?: ProxyConfig;
  private readonly agent?: Agent;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly signal?: AbortSignal;

  constructor(options: DefaultHttpClientOptions | ProxyConfig = {}) {
    const normalized: DefaultHttpClientOptions = isProxyConfig(options) ? { proxyConfig: options } : options;
    this.proxyConfig = normalized.proxyConfig;
    this.timeoutMs = normalized.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = normalized.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.signal = normalized.signal;
    this.defaultHeaders = {
      "Accept-Language": "en-US",
      "User-Agent": normalized.userAgent ?? DEFAULT_USER_AGENT,
      ...normalized.defaultHeaders,
    };
    if (this.proxyConfig?.preventKeepingConnectionsAlive) {
      this.defaultHeaders.Connection = "close";
    }
    // One agent for the client's lifetime: constructing a ProxyAgent per
    // request would defeat connection reuse and churn allocations under load.
    if (normalized.agent) {
      this.agent = normalized.agent;
    } else if (this.proxyConfig) {
      const proxyConfig = this.proxyConfig;
      this.agent = new ProxyAgent({
        getProxyForUrl: (url: string) =>
          proxyConfig.toRequestsDict()[new URL(url).protocol === "https:" ? "https" : "http"],
      }) as unknown as Agent;
    } else if (normalized.useEnvProxy) {
      this.agent = new ProxyAgent() as unknown as Agent;
    }
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  async get(url: string): Promise<HttpResponse> {
    return this.request("GET", url);
  }

  async postJson(url: string, body: unknown): Promise<HttpResponse> {
    return this.request("POST", url, JSON.stringify(body), {
      "Content-Type": "application/json",
    });
  }

  private buildCookieHeader(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private async request(
    method: "GET" | "POST",
    urlString: string,
    body?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResponse> {
    let currentUrl = new URL(urlString);
    let currentMethod = method;
    let currentBody = body;

    // node:http never follows redirects on its own. YouTube relies on them
    // (e.g. the EEA consent flow 302s to consent.youtube.com), so follow a
    // bounded number of same-scheme-family hops like a browser would.
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await this.requestOnce(currentMethod, currentUrl, currentBody, extraHeaders);
      const location = firstHeaderValue(response.headers.location);
      if (
        response.statusCode < 300 ||
        response.statusCode >= 400 ||
        !location ||
        redirectCount >= this.maxRedirects
      ) {
        return response;
      }
      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        return response;
      }
      if (response.statusCode === 303 || currentMethod === "POST") {
        currentMethod = "GET";
        currentBody = undefined;
      }
      currentUrl = nextUrl;
    }
  }

  private requestOnce(
    method: "GET" | "POST",
    url: URL,
    body: string | undefined,
    extraHeaders: Record<string, string>,
  ): Promise<BufferedHttpResponse> {
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = { ...this.defaultHeaders, ...extraHeaders };
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }

    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const req = requestFn(
        url,
        { agent: this.agent, headers, method, signal: this.signal, timeout: this.timeoutMs },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          // A connection dropped mid-body surfaces on the response stream, not
          // the request; without this listener the promise would never settle.
          response.on("error", fail);
          response.on("end", () => {
            if (!settled) {
              settled = true;
              resolve(
                new BufferedHttpResponse(
                  response.statusCode ?? 0,
                  response.headers,
                  Buffer.concat(chunks).toString("utf8"),
                ),
              );
            }
          });
        },
      );

      req.on("timeout", () => {
        const timeoutError = new Error(
          `Request to ${url.host} timed out after ${this.timeoutMs}ms of inactivity`,
        );
        timeoutError.name = "RequestTimeout";
        req.destroy(timeoutError);
      });
      req.on("error", fail);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
