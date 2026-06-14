import path from "path";
import { fileURLToPath } from "url";

import express from "express";

import { extractVideoId } from "./dist/src/index.js";
import {
  AgeRestricted,
  InvalidVideoId,
  IpBlocked,
  NoTranscriptFound,
  NotTranslatable,
  PoTokenRequired,
  RequestBlocked,
  TranscriptsDisabled,
  TranslationLanguageNotAvailable,
  VideoUnavailable,
  VideoUnplayable,
  YouTubeRequestFailed,
} from "./dist/src/errors.js";
import {
  JSONFormatter,
  SRTFormatter,
  TextFormatter,
  WebVTTFormatter,
} from "./dist/src/formatters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LANG_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/;
const FORMATS = new Set(["json", "srt", "webvtt", "text"]);
const SUCCESS_CACHE_CONTROL = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";
const NOT_FOUND_CACHE_CONTROL = "public, max-age=0, s-maxage=300";

/**
 * Maps a thrown error to a sanitized HTTP response. Known transcript errors
 * get a stable status, name and short message; everything else collapses to a
 * generic 500 so internal details (stack traces, proxy vendor, upstream URLs)
 * never reach API clients.
 */
function mapError(err) {
  if (err instanceof InvalidVideoId) {
    return { status: 400, name: "InvalidVideoId", message: "Invalid YouTube video ID or URL." };
  }
  if (err instanceof VideoUnavailable) {
    return { status: 404, name: "VideoUnavailable", message: "This video is no longer available." };
  }
  if (err instanceof TranscriptsDisabled) {
    return { status: 404, name: "TranscriptsDisabled", message: "Subtitles are disabled for this video." };
  }
  if (err instanceof NoTranscriptFound) {
    return { status: 404, name: "NoTranscriptFound", message: "No transcript was found in the requested language(s)." };
  }
  if (err instanceof TranslationLanguageNotAvailable) {
    return { status: 404, name: "TranslationLanguageNotAvailable", message: "The requested translation language is not available." };
  }
  if (err instanceof NotTranslatable) {
    return { status: 400, name: "NotTranslatable", message: "The selected transcript cannot be translated." };
  }
  if (err instanceof AgeRestricted) {
    return { status: 403, name: "AgeRestricted", message: "This video is age-restricted and cannot be fetched without authentication." };
  }
  if (err instanceof VideoUnplayable) {
    return { status: 404, name: "VideoUnplayable", message: "This video is unplayable." };
  }
  if (err instanceof PoTokenRequired) {
    return { status: 422, name: "PoTokenRequired", message: "This video requires a PO token to retrieve its transcript." };
  }
  if (err instanceof IpBlocked || err instanceof RequestBlocked) {
    return { status: 503, name: "RequestBlocked", message: "Temporarily unable to reach YouTube. Please try again shortly.", retryAfter: 30 };
  }
  if (err instanceof YouTubeRequestFailed) {
    return { status: 502, name: "YouTubeRequestFailed", message: "YouTube returned an unexpected response. Please try again." };
  }
  if (err instanceof Error && (err.name === "RequestTimeout" || err.name === "AbortError")) {
    return { status: 504, name: "RequestTimeout", message: "The request to YouTube timed out. Please try again." };
  }
  return { status: 500, name: "InternalError", message: "An unexpected error occurred." };
}

function sendError(res, err, logger) {
  const mapped = mapError(err);
  if (mapped.status >= 500) {
    logger.error(`[${mapped.name}] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
  if (mapped.retryAfter) {
    res.set("Retry-After", String(mapped.retryAfter));
  }
  res.set("Cache-Control", mapped.status === 404 ? NOT_FOUND_CACHE_CONTROL : "no-store");
  res.status(mapped.status).json({ error: mapped.message, name: mapped.name });
}

const RATE_LIMITER_MAX_KEYS = 10000;

/**
 * Fixed-window in-memory per-IP rate limiter (per process instance). Keys off
 * req.ip — with `trust proxy` configured Express derives it from the trusted
 * hop of X-Forwarded-For, so clients cannot spoof a fresh identity per
 * request by rotating the header themselves.
 */
function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const current = now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt <= current) {
      // Bound memory even under a flood of distinct keys: evict expired
      // entries first, then oldest-inserted entries if still over the cap.
      if (hits.size >= RATE_LIMITER_MAX_KEYS) {
        for (const [key, value] of hits) {
          if (value.resetAt <= current) hits.delete(key);
        }
        while (hits.size >= RATE_LIMITER_MAX_KEYS) {
          const oldest = hits.keys().next().value;
          if (oldest === undefined) break;
          hits.delete(oldest);
        }
      }
      hits.set(ip, { count: 1, resetAt: current + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - current) / 1000)));
      res.set("Cache-Control", "no-store");
      return res.status(429).json({ error: "Too many requests. Please slow down.", name: "RateLimited" });
    }
    return next();
  };
}

/**
 * Builds the Express application. Dependencies are injected so the app can be
 * unit-tested with a stubbed transcript client.
 */
export function createApp({
  yt,
  logger = console,
  corsOrigin = "*",
  rateLimit = { windowMs: 60_000, max: 30 },
  serveStatic = true,
  trustProxy = 1,
} = {}) {
  if (!yt) {
    throw new Error("createApp requires a `yt` transcript client.");
  }

  const app = express();
  app.disable("x-powered-by");
  // One trusted hop (Vercel's proxy) so req.ip reflects the real client IP
  // from X-Forwarded-For without trusting client-supplied values.
  app.set("trust proxy", trustProxy);

  // Baseline security headers on every response.
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  // CORS + rate limiting scoped to the API surface only.
  const limiter = rateLimit ? createRateLimiter(rateLimit) : (_req, _res, next) => next();
  app.use("/api", (req, res, next) => {
    if (corsOrigin) {
      res.set("Access-Control-Allow-Origin", corsOrigin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  });
  app.use("/api", limiter);

  if (serveStatic) {
    app.use(express.static(path.join(__dirname, "public")));
  }

  app.get("/api/captions/:videoId", async (req, res) => {
    try {
      const videoId = extractVideoId(req.params.videoId);
      if (!videoId) {
        return sendError(res, new InvalidVideoId(req.params.videoId), logger);
      }
      const list = await yt.list(videoId);
      const transcripts = [];
      for (const t of list) {
        transcripts.push({
          language: t.language,
          languageCode: t.languageCode,
          isGenerated: t.isGenerated,
          isTranslatable: t.isTranslatable,
        });
      }
      res.set("Cache-Control", SUCCESS_CACHE_CONTROL);
      res.json({
        videoId,
        transcripts,
        translationLanguages: list.translationLanguages ?? [],
      });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  app.get("/api/captions/:videoId/fetch", async (req, res) => {
    try {
      const videoId = extractVideoId(req.params.videoId);
      if (!videoId) {
        return sendError(res, new InvalidVideoId(req.params.videoId), logger);
      }

      const lang = typeof req.query.lang === "string" ? req.query.lang : undefined;
      if (lang !== undefined && !LANG_PATTERN.test(lang)) {
        return res.status(400).json({ error: "Invalid `lang` parameter.", name: "InvalidParameter" });
      }
      const translateTo = typeof req.query.translateTo === "string" ? req.query.translateTo : undefined;
      if (translateTo !== undefined && !LANG_PATTERN.test(translateTo)) {
        return res.status(400).json({ error: "Invalid `translateTo` parameter.", name: "InvalidParameter" });
      }
      const format = typeof req.query.format === "string" ? req.query.format : "json";
      if (!FORMATS.has(format)) {
        return res.status(400).json({ error: `Invalid \`format\`. Choose one of: ${[...FORMATS].join(", ")}.`, name: "InvalidParameter" });
      }
      const preserveFormatting = req.query.preserveFormatting === "true";

      const transcript = await yt.fetch(videoId, {
        languages: lang ? [lang] : undefined,
        preserveFormatting,
        translateTo,
      });

      res.set("Cache-Control", SUCCESS_CACHE_CONTROL);
      switch (format) {
        case "srt":
          res.type("application/x-subrip; charset=utf-8");
          return res.send(new SRTFormatter().formatTranscript(transcript));
        case "webvtt":
          res.type("text/vtt; charset=utf-8");
          return res.send(new WebVTTFormatter().formatTranscript(transcript));
        case "text":
          res.type("text/plain; charset=utf-8");
          return res.send(new TextFormatter().formatTranscript(transcript));
        case "json":
        default:
          return res.json({
            videoId: transcript.videoId,
            language: transcript.language,
            languageCode: transcript.languageCode,
            isGenerated: transcript.isGenerated,
            snippets: transcript.toRawData(),
          });
      }
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // Unmatched API paths must return a JSON 404, never the SPA document.
  app.use("/api", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found.", name: "NotFound" });
  });

  if (serveStatic) {
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "public", "index.html"));
    });
  }

  return app;
}

export { mapError };
