/**
 * Pluggable cache used to memoize captions metadata and fetched transcripts so
 * repeated requests for the same video avoid extra round trips to YouTube
 * (which reduces both block risk and metered-proxy cost). Implementations may
 * be synchronous or asynchronous.
 */
export interface TranscriptCache {
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  set<T>(key: string, value: T): void | Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Simple in-memory cache with a TTL and a bounded entry count (LRU-ish: oldest
 * insertion evicted first). Safe default for a single long-lived process.
 */
export class InMemoryTranscriptCache implements TranscriptCache {
  private readonly store = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly maxEntries = 500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
