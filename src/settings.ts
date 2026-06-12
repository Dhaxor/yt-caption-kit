export const WATCH_URL = "https://www.youtube.com/watch?v={videoId}";
export const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?key={apiKey}";
export const INNERTUBE_BROWSE_URL =
  "https://www.youtube.com/youtubei/v1/browse?key={apiKey}";
export const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
  },
};
// Browse (playlist/channel) payloads are only served to web clients.
export const INNERTUBE_WEB_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20250110.01.00",
  },
};
// Requests without a User-Agent are a strong bot signal to YouTube and get
// blocked far more often; mimic a current desktop browser by default.
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
