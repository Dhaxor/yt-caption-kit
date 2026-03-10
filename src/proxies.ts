export class InvalidProxyConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProxyConfig";
  }
}

export interface RequestsProxyConfigDict {
  http: string;
  https: string;
}

export interface ProxyConfig {
  toRequestsDict(): RequestsProxyConfigDict;
  readonly preventKeepingConnectionsAlive: boolean;
  readonly retriesWhenBlocked: number;
}

export class GenericProxyConfig implements ProxyConfig {
  protected readonly _httpUrl?: string;
  protected readonly _httpsUrl?: string;

  constructor(httpUrl?: string, httpsUrl?: string) {
    if (!httpUrl && !httpsUrl) {
      throw new InvalidProxyConfig(
        "GenericProxyConfig requires you to define at least one of the two: http or https",
      );
    }
    this._httpUrl = httpUrl;
    this._httpsUrl = httpsUrl;
  }

  get httpUrl(): string | undefined {
    return this._httpUrl;
  }

  get httpsUrl(): string | undefined {
    return this._httpsUrl;
  }

  toRequestsDict(): RequestsProxyConfigDict {
    return {
      http: this.httpUrl ?? this.httpsUrl!,
      https: this.httpsUrl ?? this.httpUrl!,
    };
  }

  get preventKeepingConnectionsAlive(): boolean {
    return false;
  }

  get retriesWhenBlocked(): number {
    return 0;
  }
}

export interface WebshareProxyConfigOptions {
  proxyUsername: string;
  proxyPassword: string;
  filterIpLocations?: string[];
  retriesWhenBlocked?: number;
  domainName?: string;
  proxyPort?: number;
}

export class WebshareProxyConfig extends GenericProxyConfig {
  static readonly DEFAULT_DOMAIN_NAME = "p.webshare.io";
  static readonly DEFAULT_PORT = 80;

  readonly proxyUsername: string;
  readonly proxyPassword: string;
  readonly domainName: string;
  readonly proxyPort: number;
  private readonly filterIpLocations: string[];
  private readonly retryCount: number;

  constructor(options: WebshareProxyConfigOptions) {
    super("http://placeholder", "http://placeholder");
    this.proxyUsername = options.proxyUsername;
    this.proxyPassword = options.proxyPassword;
    this.domainName = options.domainName ?? WebshareProxyConfig.DEFAULT_DOMAIN_NAME;
    this.proxyPort = options.proxyPort ?? WebshareProxyConfig.DEFAULT_PORT;
    this.filterIpLocations = options.filterIpLocations ?? [];
    this.retryCount = options.retriesWhenBlocked ?? 10;
  }

  get url(): string {
    const locationCodes = this.filterIpLocations
      .map((locationCode) => `-${locationCode.toUpperCase()}`)
      .join("");
    const username = this.proxyUsername.endsWith("-rotate")
      ? this.proxyUsername.slice(0, -"-rotate".length)
      : this.proxyUsername;
    return `http://${username}${locationCodes}-rotate:${this.proxyPassword}@${this.domainName}:${this.proxyPort}/`;
  }

  override get httpUrl(): string {
    return this.url;
  }

  override get httpsUrl(): string {
    return this.url;
  }

  override get preventKeepingConnectionsAlive(): boolean {
    return true;
  }

  override get retriesWhenBlocked(): number {
    return this.retryCount;
  }
}