import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

import { ProxyAgent } from "proxy-agent";

import type { ProxyConfig } from "./proxies.js";

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

export class DefaultHttpClient implements HttpClient {
  private readonly cookies = new Map<string, string>();
  private readonly defaultHeaders: Record<string, string> = {
    "Accept-Language": "en-US",
  };

  constructor(private readonly proxyConfig?: ProxyConfig) {
    if (proxyConfig?.preventKeepingConnectionsAlive) {
      this.defaultHeaders.Connection = "close";
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
    const url = new URL(urlString);
    const cookieHeader = this.buildCookieHeader();
    const headers: Record<string, string> = { ...this.defaultHeaders, ...extraHeaders };
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }

    const proxyUrl = this.proxyConfig?.toRequestsDict()[url.protocol === "https:" ? "https" : "http"];
    const agent = proxyUrl ? new ProxyAgent({ getProxyForUrl: () => proxyUrl }) : undefined;
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        url,
        { agent, headers, method, timeout: 15000 },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve(
              new BufferedHttpResponse(
                response.statusCode ?? 0,
                response.headers,
                Buffer.concat(chunks).toString("utf8"),
              ),
            );
          });
        },
      );

      req.on("error", reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}