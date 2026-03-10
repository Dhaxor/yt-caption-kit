import assert from "node:assert/strict";
import test from "node:test";

import {
  FetchedTranscript,
  FetchedTranscriptSnippet,
  GenericProxyConfig,
  Transcript,
  TranscriptList,
  WebshareProxyConfig,
} from "../src/index.js";
import { YtCaptionKitCli } from "../src/cli.js";

const fetchedTranscript = new FetchedTranscript(
  [
    new FetchedTranscriptSnippet("Hey, this is just a test", 0, 1.54),
    new FetchedTranscriptSnippet("this is <i>not</i> the original transcript", 1.54, 4.16),
  ],
  "GJLlxj_dtq8",
  "English",
  "en",
  true,
);

function makeTranscriptList(fetchCalls: string[], translateCalls: string[]) {
  class FakeTranscript extends Transcript {
    constructor() {
      super(
        {
          get: async () => ({ headers: {}, json: async <T>() => ({} as T), statusCode: 200, text: async () => "" }),
          postJson: async () => ({ headers: {}, json: async <T>() => ({} as T), statusCode: 200, text: async () => "" }),
          setCookie: () => {},
        },
        "GJLlxj_dtq8",
        "https://www.youtube.com/api/timedtext?lang=en",
        "English",
        "en",
        true,
        [{ language: "Arabic", languageCode: "ar" }],
      );
    }

    override async fetch(): Promise<FetchedTranscript> {
      fetchCalls.push("fetch");
      return fetchedTranscript;
    }

    override translate(languageCode: string): Transcript {
      translateCalls.push(languageCode);
      return this;
    }
  }

  const transcript = new FakeTranscript();
  return {
    transcript,
    transcriptList: {
      findGeneratedTranscript(languageCodes: Iterable<string>) {
        return record(languageCodes);
      },
      findManuallyCreatedTranscript(languageCodes: Iterable<string>) {
        return record(languageCodes);
      },
      findTranscript(languageCodes: Iterable<string>) {
        return record(languageCodes);
      },
      toString() {
        return "transcript-list-output";
      },
    } as Pick<TranscriptList, "findGeneratedTranscript" | "findManuallyCreatedTranscript" | "findTranscript" | "toString">,
  };

  function record(languageCodes: Iterable<string>): Transcript {
    fetchCalls.push(`find:${[...languageCodes].join(",")}`);
    return transcript;
  }
}

test("CLI parses argument ordering, escapes leading dashes, and supports help/version", async () => {
  const parsed = new YtCaptionKitCli("v1 v2 --format json --languages de en".split(" ")).parseArgs();
  assert.deepEqual(parsed.videoIds, ["v1", "v2"]);
  assert.equal(parsed.format, "json");
  assert.deepEqual(parsed.languages, ["de", "en"]);

  const parsedWithLeadingDashes = new YtCaptionKitCli(String.raw`\-v1 \-\-v2 \--v3`.split(" ")).parseArgs();
  assert.deepEqual(parsedWithLeadingDashes.videoIds, ["-v1", "--v2", "--v3"]);

  assert.match(await new YtCaptionKitCli(["--help"]).run(), /Usage:/);
  assert.match(
    await new YtCaptionKitCli(["--version"], { versionResolver: () => "9.9.9" }).run(),
    /yt-caption-kit, version 9\.9\.9/,
  );
});

test("CLI run fetches transcripts, supports translation, and serializes JSON output", async () => {
  const fetchCalls: string[] = [];
  const translateCalls: string[] = [];
  const { transcriptList } = makeTranscriptList(fetchCalls, translateCalls);

  const cli = new YtCaptionKitCli("v1 v2 --languages de en --translate ar --format json".split(" "), {
    apiFactory: () => ({ list: async () => transcriptList } as never),
  });
  const output = await cli.run();

  assert.deepEqual(translateCalls, ["ar", "ar"]);
  assert.deepEqual(fetchCalls.filter((entry) => entry.startsWith("find:")), ["find:de,en", "find:de,en"]);
  assert.doesNotThrow(() => JSON.parse(output));
});

test("CLI run can list transcripts and create proxy configs", async () => {
  let observedProxy: unknown;
  const cli = new YtCaptionKitCli(
    "--list-transcripts v1 --webshare-proxy-username username --webshare-proxy-password password".split(" "),
    {
      apiFactory: (proxyConfig) => {
        observedProxy = proxyConfig;
        return { list: async () => ({ toString: () => "transcript-list-output" }) } as never;
      },
    },
  );
  assert.equal(await cli.run(), "transcript-list-output");
  assert.ok(observedProxy instanceof WebshareProxyConfig);

  const genericCli = new YtCaptionKitCli(
    "v1 --http-proxy http://user:pass@domain:port --https-proxy https://user:pass@domain:port".split(" "),
    {
      apiFactory: (proxyConfig) => ({
        list: async () => {
          observedProxy = proxyConfig;
          const transcript = {
            fetch: async () => fetchedTranscript,
            translate: () => transcript,
          };
          return {
            findGeneratedTranscript: () => transcript,
            findManuallyCreatedTranscript: () => transcript,
            findTranscript: () => transcript,
            toString: () => "unused",
          };
        },
      }),
    },
  );
  await genericCli.run();
  assert.ok(observedProxy instanceof GenericProxyConfig);
});

test("CLI returns empty output when both transcript sources are excluded", async () => {
  const output = await new YtCaptionKitCli(
    "v1 v2 --exclude-manually-created --exclude-generated".split(" "),
  ).run();
  assert.equal(output, "");
});