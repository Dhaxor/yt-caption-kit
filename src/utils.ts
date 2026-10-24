// HTML5 named character references that occur in YouTube captions and watch
// pages. Python's html.unescape covers the full HTML5 set; this table covers
// the Latin-1 supplement, typographic punctuation, Greek, currency, math and
// arrow entities, which is the subset observed in real caption payloads.
const HTML_ENTITY_MAP: Record<string, string> = {
  AElig: "Æ",
  Aacute: "Á",
  Acirc: "Â",
  Agrave: "À",
  Alpha: "Α",
  Aring: "Å",
  Atilde: "Ã",
  Auml: "Ä",
  Beta: "Β",
  Ccedil: "Ç",
  Chi: "Χ",
  Dagger: "‡",
  Delta: "Δ",
  ETH: "Ð",
  Eacute: "É",
  Ecirc: "Ê",
  Egrave: "È",
  Epsilon: "Ε",
  Eta: "Η",
  Euml: "Ë",
  Gamma: "Γ",
  Iacute: "Í",
  Icirc: "Î",
  Igrave: "Ì",
  Iota: "Ι",
  Iuml: "Ï",
  Kappa: "Κ",
  Lambda: "Λ",
  Mu: "Μ",
  Ntilde: "Ñ",
  Nu: "Ν",
  OElig: "Œ",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ograve: "Ò",
  Omega: "Ω",
  Omicron: "Ο",
  Oslash: "Ø",
  Otilde: "Õ",
  Ouml: "Ö",
  Phi: "Φ",
  Pi: "Π",
  Prime: "″",
  Psi: "Ψ",
  Rho: "Ρ",
  Scaron: "Š",
  Sigma: "Σ",
  THORN: "Þ",
  Tau: "Τ",
  Theta: "Θ",
  Uacute: "Ú",
  Ucirc: "Û",
  Ugrave: "Ù",
  Upsilon: "Υ",
  Uuml: "Ü",
  Xi: "Ξ",
  Yacute: "Ý",
  Yuml: "Ÿ",
  Zeta: "Ζ",
  aacute: "á",
  acirc: "â",
  acute: "´",
  aelig: "æ",
  agrave: "à",
  alefsym: "ℵ",
  alpha: "α",
  amp: "&",
  and: "∧",
  ang: "∠",
  apos: "'",
  aring: "å",
  asymp: "≈",
  atilde: "ã",
  auml: "ä",
  bdquo: "„",
  beta: "β",
  brvbar: "¦",
  bull: "•",
  cap: "∩",
  ccedil: "ç",
  cedil: "¸",
  cent: "¢",
  chi: "χ",
  circ: "ˆ",
  clubs: "♣",
  cong: "≅",
  copy: "©",
  crarr: "↵",
  cup: "∪",
  curren: "¤",
  dArr: "⇓",
  dagger: "†",
  darr: "↓",
  deg: "°",
  delta: "δ",
  diams: "♦",
  divide: "÷",
  eacute: "é",
  ecirc: "ê",
  egrave: "è",
  empty: "∅",
  emsp: " ",
  ensp: " ",
  epsilon: "ε",
  equiv: "≡",
  eta: "η",
  eth: "ð",
  euml: "ë",
  euro: "€",
  exist: "∃",
  fnof: "ƒ",
  forall: "∀",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frasl: "⁄",
  gamma: "γ",
  ge: "≥",
  gt: ">",
  hArr: "⇔",
  harr: "↔",
  hearts: "♥",
  hellip: "…",
  iacute: "í",
  icirc: "î",
  iexcl: "¡",
  igrave: "ì",
  image: "ℑ",
  infin: "∞",
  int: "∫",
  iota: "ι",
  iquest: "¿",
  isin: "∈",
  iuml: "ï",
  kappa: "κ",
  lArr: "⇐",
  lambda: "λ",
  lang: "⟨",
  laquo: "«",
  larr: "←",
  lceil: "⌈",
  ldquo: "“",
  le: "≤",
  lfloor: "⌊",
  lowast: "∗",
  loz: "◊",
  lrm: "‎",
  lsaquo: "‹",
  lsquo: "‘",
  lt: "<",
  macr: "¯",
  mdash: "—",
  micro: "µ",
  middot: "·",
  minus: "−",
  mu: "μ",
  nabla: "∇",
  nbsp: " ",
  ndash: "–",
  ne: "≠",
  ni: "∋",
  not: "¬",
  notin: "∉",
  nsub: "⊄",
  ntilde: "ñ",
  nu: "ν",
  oacute: "ó",
  ocirc: "ô",
  oelig: "œ",
  ograve: "ò",
  oline: "‾",
  omega: "ω",
  omicron: "ο",
  oplus: "⊕",
  or: "∨",
  ordf: "ª",
  ordm: "º",
  oslash: "ø",
  otilde: "õ",
  otimes: "⊗",
  ouml: "ö",
  para: "¶",
  part: "∂",
  permil: "‰",
  perp: "⊥",
  phi: "φ",
  pi: "π",
  piv: "ϖ",
  plusmn: "±",
  pound: "£",
  prime: "′",
  prod: "∏",
  prop: "∝",
  psi: "ψ",
  quot: '"',
  rArr: "⇒",
  radic: "√",
  rang: "⟩",
  raquo: "»",
  rarr: "→",
  rceil: "⌉",
  rdquo: "”",
  real: "ℜ",
  reg: "®",
  rfloor: "⌋",
  rho: "ρ",
  rlm: "‏",
  rsaquo: "›",
  rsquo: "’",
  sbquo: "‚",
  scaron: "š",
  sdot: "⋅",
  sect: "§",
  shy: "­",
  sigma: "σ",
  sigmaf: "ς",
  sim: "∼",
  spades: "♠",
  sub: "⊂",
  sube: "⊆",
  sum: "∑",
  sup: "⊃",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  supe: "⊇",
  szlig: "ß",
  tau: "τ",
  there4: "∴",
  theta: "θ",
  thetasym: "ϑ",
  thinsp: " ",
  thorn: "þ",
  tilde: "˜",
  times: "×",
  trade: "™",
  uArr: "⇑",
  uacute: "ú",
  uarr: "↑",
  ucirc: "û",
  ugrave: "ù",
  uml: "¨",
  upsih: "ϒ",
  upsilon: "υ",
  uuml: "ü",
  weierp: "℘",
  xi: "ξ",
  yacute: "ý",
  yen: "¥",
  yuml: "ÿ",
  zeta: "ζ",
  zwj: "‍",
  zwnj: "‌",
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

const MAX_VALID_CODE_POINT = 0x10ffff;

// HTML5 numeric-character-reference replacement table (mirrors Python's
// html.unescape): NUL becomes U+FFFD and the 0x80-0x9F range is remapped per
// Windows-1252 instead of emitting raw C1 control characters.
const NUMERIC_REFERENCE_OVERRIDES: Record<number, string> = {
  0x00: "�",
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

function isRemovedControlCodePoint(codePoint: number): boolean {
  // C0 controls (except TAB/LF/CR) and DEL are stripped, matching Python.
  return (
    (codePoint >= 0x01 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    codePoint === 0x7f
  );
}

/**
 * Decodes HTML character references. YouTube serves caption text XML-escaped
 * and the text itself may contain HTML entities, so two passes cover the
 * double-encoded case (e.g. `&amp;#39;` -> `&#39;` -> `'`), mirroring the
 * XML-decode + html.unescape sequence of the Python original.
 */
export function decodeHtmlEntities(input: string, maxPasses = 2): string {
  let decoded = input;
  for (let iteration = 0; iteration < maxPasses; iteration += 1) {
    const next = decodeHtmlEntitiesOnce(decoded);
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}

function decodeHtmlEntitiesOnce(input: string): string {
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return codePointToString(Number.parseInt(entity.slice(2), 16), match);
    }
    if (entity.startsWith("#")) {
      return codePointToString(Number.parseInt(entity.slice(1), 10), match);
    }
    return HTML_ENTITY_MAP[entity] ?? `&${entity};`;
  });
}

function codePointToString(codePoint: number, _fallback: string): string {
  // Mirrors Python's html.unescape so malformed references in user-generated
  // content never crash a fetch or inject control characters / lone surrogates.
  if (!Number.isInteger(codePoint)) {
    return "�";
  }
  const override = NUMERIC_REFERENCE_OVERRIDES[codePoint];
  if (override !== undefined) {
    return override;
  }
  if (
    codePoint < 0 ||
    codePoint > MAX_VALID_CODE_POINT ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "�";
  }
  if (isRemovedControlCodePoint(codePoint)) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}

export function sanitizeVideoId(videoId: string): string {
  return videoId.replaceAll("\\", "");
}

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const VIDEO_URL_PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch|embed|shorts|live|v|e)(?:\?(?:[^#]*&)?v=|\/)([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/attribution_link\?[^#]*u=%2Fwatch%3Fv%3D([a-zA-Z0-9_-]{11})/,
];

/**
 * Extracts the 11-character video ID from a YouTube URL (watch, youtu.be,
 * embed, shorts, live, music/m subdomains) or returns a bare ID unchanged.
 * Returns null when no video ID can be derived from the input.
 */
export function extractVideoId(urlOrId: string): string | null {
  const input = urlOrId.trim();
  if (VIDEO_ID_PATTERN.test(input)) {
    return input;
  }
  for (const pattern of VIDEO_URL_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function stripHtml(input: string, preserveFormatting = false): string {
  return input.replace(/<[^>]*>/g, (tag) => {
    if (!preserveFormatting) {
      return "";
    }
    // Self-closed formatting tags (<i/>) would re-emit as an unbalanced open
    // tag and italicize the rest of a downstream render; drop them instead.
    if (/\/\s*>$/.test(tag)) {
      return "";
    }
    const tagName = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag);
    if (tagName && FORMATTING_TAGS.has(tagName[2]!.toLowerCase())) {
      // Re-emit the bare tag without attributes so event handlers or styles
      // smuggled inside caption markup cannot reach downstream HTML renderers.
      return `<${tagName[1]}${tagName[2]!.toLowerCase()}>`;
    }
    return "";
  });
}

export function formatTimestamp(totalSeconds: number, millisecondSeparator: "," | ".") {
  // Derive everything from rounded total milliseconds so the rounding carries
  // into seconds instead of producing four-digit millisecond fields.
  const totalMilliseconds = Math.round(totalSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = (totalMilliseconds % 1000).toString().padStart(3, "0");
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}${millisecondSeparator}${millis}`;
}
