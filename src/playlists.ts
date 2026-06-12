import { YtCaptionKitError } from "./errors.js";
import type { HttpClient } from "./http-client.js";
import { INNERTUBE_BROWSE_URL, INNERTUBE_WEB_CONTEXT } from "./settings.js";

export interface VideoRef {
  videoId: string;
  title?: string;
}

export interface ListVideosOptions {
  /** Maximum number of videos to return. Default: 200. */
  limit?: number;
}

export class PlaylistUnavailable extends YtCaptionKitError {}

const PLAYLIST_ID_PATTERN = /^(?:PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{10,}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

async function fetchApiKey(httpClient: HttpClient): Promise<string> {
  const response = await httpClient.get("https://www.youtube.com/?persist_gl=1&gl=US&hl=en");
  const html = await response.text();
  const match = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
  if (!match?.[1]) {
    throw new PlaylistUnavailable("Could not obtain a YouTube API key for browsing playlists.");
  }
  return match[1];
}

async function resolveBrowseId(httpClient: HttpClient, target: string): Promise<string> {
  const trimmed = target.trim();

  // Bare playlist ID.
  if (PLAYLIST_ID_PATTERN.test(trimmed)) {
    return `VL${trimmed}`;
  }
  // Bare channel ID -> its uploads playlist (UC... -> UU...).
  if (CHANNEL_ID_PATTERN.test(trimmed)) {
    return `VLUU${trimmed.slice(2)}`;
  }

  // Playlist URL (?list=...).
  const listMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (listMatch?.[1]) {
    return `VL${listMatch[1]}`;
  }

  // Channel URL by ID.
  const channelMatch = trimmed.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (channelMatch?.[1]) {
    return `VLUU${channelMatch[1].slice(2)}`;
  }

  // Channel handle (@name), /user/, /c/ — resolve the canonical channel ID
  // from the channel page, then use its uploads playlist.
  if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("@")) {
    const url = trimmed.startsWith("@") ? `https://www.youtube.com/${trimmed}` : trimmed;
    const response = await httpClient.get(url);
    const html = await response.text();
    const idMatch =
      html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) ??
      html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ??
      html.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (idMatch?.[1]) {
      return `VLUU${idMatch[1].slice(2)}`;
    }
  }

  throw new PlaylistUnavailable(
    `Could not resolve "${target}" to a playlist or channel. Pass a playlist ID/URL, a channel ID (UC...), or a channel handle (@name).`,
  );
}

function collectFromContinuationItems(node: unknown, videos: VideoRef[], seen: Set<string>): string | undefined {
  let continuation: string | undefined;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, any>;

    if (typeof record.videoId === "string" && record.videoId.length === 11 && !seen.has(record.videoId)) {
      seen.add(record.videoId);
      const title = readTitle(record);
      videos.push(title ? { videoId: record.videoId, title } : { videoId: record.videoId });
    }

    const token = record.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string") {
      continuation = token;
    }

    for (const key of Object.keys(record)) {
      visit(record[key]);
    }
  };

  visit(node);
  return continuation;
}

function readTitle(record: Record<string, any>): string | undefined {
  const title = record.title;
  if (typeof title === "string") {
    return title;
  }
  return (title?.runs?.[0]?.text ?? title?.simpleText) as string | undefined;
}

/**
 * Enumerates the video IDs of a playlist or channel using YouTube's Innertube
 * "browse" endpoint, following continuations up to the requested limit.
 * Best-effort: relies on undocumented endpoints and may break on YouTube
 * response changes.
 */
export async function listPlaylistVideos(
  httpClient: HttpClient,
  target: string,
  options: ListVideosOptions = {},
): Promise<VideoRef[]> {
  const limit = options.limit ?? 200;
  const apiKey = await fetchApiKey(httpClient);
  const browseId = await resolveBrowseId(httpClient, target);
  const url = INNERTUBE_BROWSE_URL.replace("{apiKey}", apiKey);

  const videos: VideoRef[] = [];
  const seen = new Set<string>();

  let response = await httpClient.postJson(url, { context: INNERTUBE_WEB_CONTEXT, browseId });
  let payload = await response.json<Record<string, unknown>>();
  let continuation = collectFromContinuationItems(payload, videos, seen);

  let guard = 0;
  while (continuation && videos.length < limit && guard < 100) {
    guard += 1;
    response = await httpClient.postJson(url, { context: INNERTUBE_WEB_CONTEXT, continuation });
    payload = await response.json<Record<string, unknown>>();
    const nextContinuation = collectFromContinuationItems(payload, videos, seen);
    continuation = nextContinuation === continuation ? undefined : nextContinuation;
  }

  return videos.slice(0, limit);
}
