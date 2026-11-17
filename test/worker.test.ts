import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import worker from "../src/main.ts";
import { stripHtml } from "../src/utils.ts";

const upstream = vi.fn<typeof fetch>();
const request = async (path: string, method = "GET") => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://example.com${path}`, { method }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
};
const svenskaResponse = {
  saol: {
    hits: {
      hits: [
        {
          _index: "sa-svenska--g-89a96195f1cf47b385d24ea37736f38f-saol",
          _source: {
            ortografi: "<b>ande</b>",
            sparv_compound: ["and+e", "and+e", ""],
            enbartDigitalaHänvisningar: [
              'se <a href="/">and</a>',
              "se även <i>fågel</i>",
            ],
            huvudbetydelser: [
              { definition: "<b>själ</b> &amp; sinne" },
              { definition: "<b>själ</b> &amp; sinne" },
            ],
          },
        },
        { _index: "other", _source: { ortografi: "ignore" } },
        {
          _index: "sa-svenska--g-89a96195f1cf47b385d24ea37736f38f-saol",
          _source: { ortografi: "" },
        },
      ],
    },
  },
  so: {
    hits: {
      hits: [
        {
          _index: "sa-svenska--g-89a96195f1cf47b385d24ea37736f38f-so",
          _source: {
            ortografi: "ande",
            huvudbetydelser: [{ definition: "en <i>varelse</i>" }],
          },
        },
      ],
    },
  },
};

beforeEach(() => {
  upstream.mockReset();
  upstream.mockRejectedValue(new Error("Unexpected network request"));
  vi.stubGlobal("fetch", upstream);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const word of ["anden", "cache", "empty", "failure"]) {
    const url = new URL("https://example.com/cache/v2/analyse");
    url.searchParams.set("sourceLanguage", "sv");
    url.searchParams.set("word", word);
    await caches.default.delete(url.href);
  }
});

it("returns a bodyless CORS preflight", async () => {
  const res = await request("/analyse", "OPTIONS");
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  expect(upstream).not.toHaveBeenCalled();
});
it.each([
  "/analyse",
  "/analyse?word=",
  "/other?word=x",
  "/analyse?word=x&sourceLanguage=en",
  "/analyse?word=x&sourceLanguage=constructor",
  "/analyse?word=x&sourceLanguage=__proto__",
  "/analyse?word=x&sourceLanguage=toString",
])("rejects invalid input: %s", async (path) => {
  const res = await request(path);
  expect(res.status).toBe(400);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(await res.json()).toHaveProperty("error");
  expect(upstream).not.toHaveBeenCalled();
});
it("rejects unsupported methods", async () => {
  expect((await request("/analyse?word=x", "POST")).status).toBe(400);
});
it("preserves Swedish results, lemma extraction, cleanup and deduplication", async () => {
  upstream.mockResolvedValueOnce(Response.json(svenskaResponse));
  const res = await request("/analyse?word=anden");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toContain("max-age=604800");
  expect(await res.json()).toEqual([
    {
      upstream: "saol",
      baseform: "ande",
      compounds: [],
      compoundsLemma: ["and+e", "and", "fågel"],
      definitions: ["själ & sinne"],
    },
    {
      upstream: "so",
      baseform: "ande",
      compounds: [],
      compoundsLemma: [],
      definitions: ["en varelse"],
    },
  ]);
  expect(upstream).toHaveBeenCalledTimes(1);
  const [url, init] = upstream.mock.calls[0]!;
  expect(url).toBe("https://svenska.se/api/msearch");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual(
    Object.fromEntries(
      ["saol", "so", "saob"].map((source) => [
        source,
        {
          index: `sa-svenska-${source}`,
          query: "anden",
          exact_match: true,
          from: 0,
          size: 30,
        },
      ]),
    ),
  );
});
it("caches by word and language, ignoring unrelated query parameters", async () => {
  upstream.mockResolvedValueOnce(Response.json(svenskaResponse));
  const first = await request("/analyse?word=cache&cacheBuster=1");
  const second = await request(
    "/analyse?sourceLanguage=sv&word=cache&cacheBuster=2",
  );
  expect(await second.json()).toEqual(await first.json());
  expect(second.status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(1);
  upstream.mockResolvedValueOnce(Response.json({}));
  expect((await request("/analyse?word=empty")).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("returns empty results for an unknown word", async () => {
  upstream.mockResolvedValueOnce(Response.json({}));
  expect(await (await request("/analyse?word=empty")).json()).toEqual([]);
});
it.each([
  ["it", "italian"],
  ["es", "spanish"],
  ["fr", "french"],
  ["de", "german"],
  ["pt", "portuguese"],
])("preserves %s translations and URL encoding", async (language, name) => {
  const word = "café & thé";
  const encoded = encodeURIComponent(word);
  upstream.mockResolvedValueOnce(
    new Response(
      '<h3 id="translation_1">tea (drink)1</h3><h3 id="translation_2">tea (drink)1</h3><h3>ignore</h3>',
    ),
  );
  upstream.mockResolvedValueOnce(
    new Response(
      '<a class="translation dict" data-term="tea!">ignored</a><a class="translation dict" data-term="tea!">ignored</a>',
    ),
  );
  const res = await request(
    `/analyse?sourceLanguage=${language}&word=${encoded}`,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    {
      upstream: "glosbe",
      baseform: word,
      compounds: [],
      compoundsLemma: [],
      definitions: ["tea (drink)"],
    },
    {
      upstream: "reverso",
      baseform: word,
      compounds: [],
      compoundsLemma: [],
      definitions: ["tea"],
    },
  ]);
  expect(upstream.mock.calls.map(([url]) => url)).toEqual([
    `https://glosbe.com/${language}/en/${encoded}`,
    `https://context.reverso.net/translation/${name}-english/${encoded}`,
  ]);
});
it("does not cache upstream failures", async () => {
  upstream.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
  const res = await request("/analyse?word=failure");
  expect(res.status).toBe(502);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  upstream.mockResolvedValueOnce(Response.json(svenskaResponse));
  expect((await request("/analyse?word=failure")).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});
it("handles malformed upstream JSON", async () => {
  upstream.mockResolvedValueOnce(new Response("not json"));
  expect((await request("/analyse?word=invalid")).status).toBe(502);
});
it("handles network errors", async () => {
  expect((await request("/analyse?word=timeout")).status).toBe(502);
});
it("strips fragments and decodes HTML entities", () => {
  expect(stripHtml("<b>räv</b> &amp; <i>varg</i>")).toBe("räv & varg");
  expect(stripHtml(undefined)).toBe("");
});

it("returns available translations without caching a partial outage", async () => {
  upstream.mockResolvedValueOnce(
    new Response('<h3 id="translation_1">of</h3>'),
  );
  upstream.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
  const res = await request("/analyse?word=di&sourceLanguage=it");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toMatchObject([
    { upstream: "glosbe", definitions: ["of"] },
    { upstream: "reverso", definitions: [] },
  ]);
  // Both upstreams are tried again after a partial response.
  upstream.mockResolvedValueOnce(
    new Response('<h3 id="translation_1">of</h3>'),
  );
  upstream.mockResolvedValueOnce(
    new Response('<a class="translation dict" data-term="from"></a>'),
  );
  expect((await request("/analyse?word=di&sourceLanguage=it")).status).toBe(
    200,
  );
  expect(upstream).toHaveBeenCalledTimes(4);
});
it("returns an uncached error when both translation upstreams fail", async () => {
  const res = await request("/analyse?word=offline&sourceLanguage=it");
  expect(res.status).toBe(502);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
