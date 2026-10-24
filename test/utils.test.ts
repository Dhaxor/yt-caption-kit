import assert from "node:assert/strict";
import test from "node:test";

import { decodeHtmlEntities, extractVideoId, formatTimestamp, stripHtml } from "../src/utils.js";

test("extractVideoId handles bare ids and every URL form", () => {
  assert.equal(extractVideoId("GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://www.youtube.com/watch?list=PL123&v=GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://youtu.be/GJLlxj_dtq8?t=10"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://www.youtube.com/shorts/GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://www.youtube.com/embed/GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://www.youtube.com/live/GJLlxj_dtq8"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("https://m.youtube.com/watch?v=GJLlxj_dtq8&feature=x"), "GJLlxj_dtq8");
  assert.equal(extractVideoId("not a url"), null);
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=tooShort"), null);
});

test("formatTimestamp carries millisecond rounding into seconds", () => {
  assert.equal(formatTimestamp(1.9996, ","), "00:00:02,000");
  assert.equal(formatTimestamp(59.9999, ","), "00:01:00,000");
  assert.equal(formatTimestamp(0, ","), "00:00:00,000");
  assert.equal(formatTimestamp(3661.5, "."), "01:01:01.500");
});

test("decodeHtmlEntities decodes named, numeric and double-encoded entities without throwing", () => {
  assert.equal(decodeHtmlEntities("it&rsquo;s"), "it’s");
  assert.equal(decodeHtmlEntities("a&amp;b"), "a&b");
  assert.equal(decodeHtmlEntities("&amp;#39;"), "'");
  assert.equal(decodeHtmlEntities("&#x2014;"), "—");
  // HTML5 angle-bracket entities use the mathematical codepoints, not CJK.
  assert.equal(decodeHtmlEntities("&lang;x&rang;"), "⟨x⟩");
  // Out-of-range numeric reference becomes U+FFFD (Python html.unescape parity).
  assert.equal(decodeHtmlEntities("x &#x110000; y"), "x � y");
  // Malformed mixed entity no longer matches the decimal branch (no control char injected).
  assert.equal(decodeHtmlEntities("a&#3f;b"), "a&#3f;b");
});

test("decodeHtmlEntities never emits lone surrogates, NUL or raw control characters", () => {
  // Lone surrogates would corrupt UTF-8 encoding / JSON output downstream.
  assert.equal(decodeHtmlEntities("a &#xD800; b"), "a � b");
  assert.equal(decodeHtmlEntities("a &#56320; b"), "a � b");
  assert.equal(decodeHtmlEntities("&#0;"), "�");
  // C1 range remaps per Windows-1252 (HTML5 numeric-reference table).
  assert.equal(decodeHtmlEntities("&#x80;"), "€");
  assert.equal(decodeHtmlEntities("&#x9f;"), "Ÿ");
  // Other C0 controls and DEL are dropped; TAB/LF/CR survive.
  assert.equal(decodeHtmlEntities("a&#x1b;b&#127;c"), "abc");
  assert.equal(decodeHtmlEntities("a&#9;b&#10;c&#13;d"), "a\tb\nc\rd");
});

test("stripHtml removes all tags and sanitizes preserved formatting", () => {
  assert.equal(stripHtml("hello<br/>world"), "helloworld");
  assert.equal(stripHtml("a<00:00:01.240>b"), "ab");
  assert.equal(stripHtml("x <i>y</i> z", true), "x <i>y</i> z");
  assert.equal(stripHtml('<i onmouseover="alert(1)">y</i>', true), "<i>y</i>");
  assert.equal(stripHtml("<div>y</div>", true), "y");
  // Self-closed formatting tags must not become unbalanced open tags.
  assert.equal(stripHtml("a<i/>b", true), "ab");
  assert.equal(stripHtml("a<i />b", true), "ab");
});
