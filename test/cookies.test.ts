import assert from "node:assert/strict";
import test from "node:test";

import { CookieInvalid } from "../src/errors.js";
import { parseNetscapeCookies } from "../src/cookies.js";

test("parseNetscapeCookies parses tab-delimited cookies and skips comments", () => {
  const content = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tFALSE\t0\tCONSENT\tYES+1",
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tLOGIN_INFO\tabc",
    "",
  ].join("\n");
  const cookies = parseNetscapeCookies(content);
  assert.equal(cookies.length, 2);
  assert.deepEqual(cookies[0], { domain: ".youtube.com", name: "CONSENT", value: "YES+1" });
  assert.equal(cookies[1]?.name, "LOGIN_INFO");
  assert.equal(cookies[1]?.value, "abc");
});

test("parseNetscapeCookies throws CookieInvalid on content with no usable cookies", () => {
  assert.throws(() => parseNetscapeCookies("# only comments\n\n"), CookieInvalid);
});
