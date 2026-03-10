const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const FORMATTING_TAGS = new Set([
  "strong",
  "em",
  "b",
  "i",
  "mark",
  "small",
  "del",
  "ins",
  "sub",
  "sup",
]);

export function decodeHtmlEntities(input: string): string {
  let decoded = input;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const next = decodeHtmlEntitiesOnce(decoded);
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}

function decodeHtmlEntitiesOnce(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return HTML_ENTITY_MAP[entity] ?? `&${entity};`;
  });
}

export function sanitizeVideoId(videoId: string): string {
  return videoId.replaceAll("\\", "");
}

export function stripHtml(input: string, preserveFormatting = false): string {
  return input.replace(/<\/?([a-zA-Z0-9-]+)(?:\s[^>]*)?>/g, (tag, tagName: string) => {
    if (preserveFormatting && FORMATTING_TAGS.has(tagName.toLowerCase())) {
      return tag;
    }
    return "";
  });
}

export function formatTimestamp(totalSeconds: number, millisecondSeparator: "," | ".") {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds - Math.trunc(totalSeconds)) * 1000);
  const millis = milliseconds.toString().padStart(3, "0");
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}${millisecondSeparator}${millis}`;
}