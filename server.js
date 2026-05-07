import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { YtCaptionKit } from "./dist/src/index.js";
import {
  JSONFormatter,
  TextFormatter,
  SRTFormatter,
  WebVTTFormatter,
} from "./dist/src/formatters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function extractVideoId(raw) {
  if (!raw) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return m[1];
  }
  return null;
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/captions/:videoId", async (req, res) => {
  try {
    const videoId = extractVideoId(req.params.videoId);
    if (!videoId) return res.status(400).json({ error: "Invalid video ID" });

    const yt = new YtCaptionKit({});
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

    res.json({ videoId, transcripts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.constructor.name : "Error";
    res.status(500).json({ error: message, name });
  }
});

app.get("/api/captions/:videoId/fetch", async (req, res) => {
  try {
    const videoId = extractVideoId(req.params.videoId);
    if (!videoId) return res.status(400).json({ error: "Invalid video ID" });

    const lang = typeof req.query.lang === "string" ? req.query.lang : undefined;
    const preserveFormatting = req.query.preserveFormatting === "true";
    const format = typeof req.query.format === "string" ? req.query.format : "json";

    const yt = new YtCaptionKit({});
    const languages = lang ? [lang] : undefined;
    const transcript = await yt.fetch(videoId, { languages, preserveFormatting });

    switch (format) {
      case "srt":
        res.type("text/plain; charset=utf-8");
        return res.send(new SRTFormatter().format(transcript));
      case "webvtt":
        res.type("text/plain; charset=utf-8");
        return res.send(new WebVTTFormatter().format(transcript));
      case "text":
        res.type("text/plain; charset=utf-8");
        return res.send(new TextFormatter().format(transcript));
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
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.constructor.name : "Error";
    const code =
      name === "InvalidVideoId" || name === "VideoUnavailable" ? 404 : 500;
    res.status(code).json({ error: message, name });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Get YT Transcripts → http://localhost:${PORT}`);
  });
}

export default app;
