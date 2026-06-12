import { IpBlocked, RequestBlocked, YouTubeRequestFailed } from "./errors.js";
import type { ProxyConfig } from "./proxies.js";

/**
 * Controls automatic retries of transient failures (HTTP 429/5xx, timeouts and
 * dropped connections). Blocked-IP retries via a rotating proxy are governed
 * separately by {@link ProxyConfig.retriesWhenBlocked}.
 */
export interface RetryPolicy {
  /** Extra attempts for transient errors. Default: 0 (disabled). */
  retries?: number;
  /** Base backoff in milliseconds for the first retry. Default: 500. */
  backoffMs?: number;
  /** Upper bound on a single backoff delay. Default: 8000. */
  maxBackoffMs?: number;
  /** Add random jitter to backoff delays. Default: true. */
  jitter?: boolean;
  /** HTTP status codes treated as retryable. Default: [429, 500, 502, 503, 504]. */
  retryOnStatus?: number[];
  /** Injectable sleep, primarily for testing. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0,1), primarily for testing. */
  random?: () => number;
}

export interface ResolvedRetryPolicy {
  retries: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitter: boolean;
  retryOnStatus: Set<number>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "ENOTFOUND",
]);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function resolveRetryPolicy(policy?: RetryPolicy): ResolvedRetryPolicy | undefined {
  if (!policy || (policy.retries ?? 0) <= 0) {
    return undefined;
  }
  return {
    retries: policy.retries ?? 0,
    backoffMs: policy.backoffMs ?? 500,
    maxBackoffMs: policy.maxBackoffMs ?? 8000,
    jitter: policy.jitter ?? true,
    retryOnStatus: new Set(policy.retryOnStatus ?? [429, 500, 502, 503, 504]),
    sleep: policy.sleep ?? defaultSleep,
    random: policy.random ?? Math.random,
  };
}

export interface RetryContext {
  proxyConfig?: ProxyConfig;
  retryPolicy?: ResolvedRetryPolicy;
}

function isTransient(error: unknown, policy: ResolvedRetryPolicy): boolean {
  if (error instanceof IpBlocked) {
    return policy.retryOnStatus.has(429);
  }
  if (error instanceof YouTubeRequestFailed && typeof error.statusCode === "number") {
    return policy.retryOnStatus.has(error.statusCode);
  }
  if (error instanceof Error) {
    if (error.name === "RequestTimeout") {
      return true;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code !== undefined && RETRYABLE_NETWORK_CODES.has(code);
  }
  return false;
}

function computeBackoff(attempt: number, policy: ResolvedRetryPolicy, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, policy.maxBackoffMs);
  }
  const exponential = Math.min(policy.backoffMs * 2 ** attempt, policy.maxBackoffMs);
  if (!policy.jitter) {
    return exponential;
  }
  return Math.round(exponential * (0.5 + policy.random() * 0.5));
}

/**
 * Runs an operation, retrying blocked-IP failures via the proxy's rotation
 * budget (no delay) and transient failures via the retry policy (backoff).
 * On a terminal {@link RequestBlocked} the proxy config is attached so the
 * error message can offer proxy-aware guidance.
 */
export async function runWithRetries<T>(operation: () => Promise<T>, ctx: RetryContext): Promise<T> {
  const blockedBudget = ctx.proxyConfig?.retriesWhenBlocked ?? 0;
  const policy = ctx.retryPolicy;
  let blockedAttempts = 0;
  let transientAttempts = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      // A user-initiated abort must cancel immediately — never rotate or retry.
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof RequestBlocked && blockedAttempts < blockedBudget) {
        blockedAttempts += 1;
        continue;
      }
      if (policy && transientAttempts < policy.retries && isTransient(error, policy)) {
        const retryAfterMs = error instanceof RequestBlocked ? error.retryAfterMs : undefined;
        await policy.sleep(computeBackoff(transientAttempts, policy, retryAfterMs));
        transientAttempts += 1;
        continue;
      }
      if (error instanceof RequestBlocked) {
        throw error.withProxyConfig(ctx.proxyConfig);
      }
      throw error;
    }
  }
}
