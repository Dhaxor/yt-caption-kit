import type { HttpClient, HttpResponse } from "../../src/http-client.js";

type Matcher = RegExp | string | ((url: string) => boolean);

interface MockResponseInit {
  body?: string;
  headers?: Record<string, string>;
  json?: unknown;
  statusCode?: number;
}

interface MockCall {
  body?: unknown;
  headers: Record<string, string>;
  method: "GET" | "POST";
  url: string;
}

class MockResponse implements HttpResponse {
  constructor(
    public readonly statusCode: number,
    public readonly headers: Record<string, string>,
    private readonly responseBody: string,
    private readonly responseJson?: unknown,
  ) {}

  async text(): Promise<string> {
    return this.responseBody;
  }

  async json<T>(): Promise<T> {
    return (this.responseJson ?? JSON.parse(this.responseBody)) as T;
  }
}

interface Stub {
  matcher: Matcher;
  method: "GET" | "POST";
  responses: MockResponseInit[];
}

export class MockHttpClient implements HttpClient {
  readonly calls: MockCall[] = [];
  private readonly cookies = new Map<string, string>();
  private readonly stubs: Stub[] = [];

  onGet(matcher: Matcher, ...responses: MockResponseInit[]): void {
    this.stubs.push({ matcher, method: "GET", responses });
  }

  onPost(matcher: Matcher, ...responses: MockResponseInit[]): void {
    this.stubs.push({ matcher, method: "POST", responses });
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  async get(url: string): Promise<HttpResponse> {
    return this.respond("GET", url);
  }

  async postJson(url: string, body: unknown): Promise<HttpResponse> {
    return this.respond("POST", url, body);
  }

  private async respond(method: "GET" | "POST", url: string, body?: unknown): Promise<HttpResponse> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    this.calls.push({ body, headers, method, url });
    const stub = this.stubs.find(
      (candidate) => candidate.method === method && candidate.responses.length > 0 && matches(candidate.matcher, url),
    );
    if (!stub || stub.responses.length === 0) {
      throw new Error(`Unexpected ${method} request to ${url}`);
    }
    const response = stub.responses.shift()!;
    return new MockResponse(
      response.statusCode ?? 200,
      response.headers ?? {},
      response.body ?? JSON.stringify(response.json ?? {}),
      response.json,
    );
  }
}

function matches(matcher: Matcher, url: string): boolean {
  if (typeof matcher === "string") {
    return matcher === url;
  }
  if (matcher instanceof RegExp) {
    return matcher.test(url);
  }
  return matcher(url);
}