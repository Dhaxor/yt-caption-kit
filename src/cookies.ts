import { readFileSync } from "node:fs";

import { CookieInvalid, CookiePathInvalid } from "./errors.js";

export interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
}

/**
 * Parses a Netscape-format cookies.txt file (as exported by browser
 * extensions or yt-dlp) so YouTube cookies can authenticate requests for
 * age-restricted videos.
 *
 * @throws CookiePathInvalid when the file cannot be read.
 * @throws CookieInvalid when the file contains no usable cookies.
 */
export function loadCookieFile(path: string): ParsedCookie[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new CookiePathInvalid(
      `Could not read cookie file at "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseNetscapeCookies(raw, path);
}

export function parseNetscapeCookies(content: string, source = "<string>"): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Comments start with '#', except the "#HttpOnly_" prefix some exporters add.
    if (trimmed === "" || (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))) {
      continue;
    }
    const fields = line.replace(/^#HttpOnly_/, "").split("\t");
    if (fields.length < 7) {
      continue;
    }
    const [domain, , , , , name, value] = fields;
    if (!name) {
      continue;
    }
    cookies.push({ domain: domain ?? "", name, value: value ?? "" });
  }
  if (cookies.length === 0) {
    throw new CookieInvalid(
      `The cookie file at "${source}" is not a valid Netscape-format cookies.txt file or contains no cookies.`,
    );
  }
  return cookies;
}
