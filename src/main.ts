import { uniq } from "./utils.ts";
import { WordQueryResponse } from "./types.ts";
import {
  $$,
  reversoLanguageNameMapping,
  stripHtml,
  toDocument,
  trimAndIgnoreEmpty,
  textContent,
} from "./utils.ts";
import { responseHeaders, cacheControl } from "./headers.ts";

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const commonHeaders = responseHeaders(env.FSWC_CORS_ALLOW_ORIGIN);
    const responseHeadersWithCache = {
      ...commonHeaders,
      "Cache-Control": cacheControl,
    };
    let cacheKey: Request;
    try {
      const badRequest = (reason: string) => {
        console.log(JSON.stringify({ event: "bad_request", reason }));
        return new Response(
          JSON.stringify({ error: `Bad request: ${reason}` }),
          {
            headers: { ...commonHeaders, "Cache-Control": "no-store" },
            status: 400,
          },
        );
      };

      const ok = (rr: WordQueryResponse[], cacheable: boolean) => {
        rr.forEach((r) => {
          r.baseform = stripHtml(r.baseform);
          r.compounds = trimAndIgnoreEmpty(uniq(r.compounds.map(stripHtml)));
          r.compoundsLemma = trimAndIgnoreEmpty(
            uniq(r.compoundsLemma.map(stripHtml)),
          );
          r.definitions = trimAndIgnoreEmpty(
            uniq(r.definitions.map(stripHtml)),
          );
        });

        const response = rr.filter((r) => !!r.baseform);

        const result = new Response(JSON.stringify(response), {
          status: 200,
          headers: cacheable
            ? responseHeadersWithCache
            : { ...commonHeaders, "Cache-Control": "no-store" },
        });
        if (cacheable)
          ctx.waitUntil(
            caches.default
              .put(cacheKey, result.clone())
              .catch((error: unknown) => {
                console.error(
                  JSON.stringify({
                    event: "cache_write_failed",
                    error: String(error),
                  }),
                );
              }),
          );
        return result;
      };

      if (!req.url) {
        return badRequest("URL is invalid.");
      }

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: commonHeaders,
        });
      }

      const reqUserAgent = req.headers.get("User-Agent") || "Mozilla/5.0";

      if (req.method === "GET") {
        const url = new URL(req.url);
        const word = url.searchParams.get("word");
        if (!word) {
          return badRequest("Missing required parameter: ?word=");
        }

        if (url.pathname !== "/analyse") {
          return badRequest(
            "Endpoints beside /analyse are not implemented yet.",
          );
        }

        const sourceLanguage = url.searchParams.get("sourceLanguage") || "sv";

        if (
          sourceLanguage !== "sv" &&
          !reversoLanguageNameMapping[sourceLanguage]
        ) {
          return badRequest(`${sourceLanguage} is not a valid language code.`);
        }
        const key = new URL("/cache/v2/analyse", url.origin);
        key.searchParams.set("sourceLanguage", sourceLanguage);
        key.searchParams.set("word", word);
        cacheKey = new Request(key);
        const cached = await caches.default.match(cacheKey);
        if (cached) return cached;

        if (sourceLanguage != "sv") {
          const reversoLanguageName =
            reversoLanguageNameMapping[sourceLanguage];

          const encodedText = encodeURIComponent(word);
          const glosbeBodyPromise = fetchUpstream(
            `https://glosbe.com/${sourceLanguage}/en/${encodedText}`,
            {
              headers: {
                "User-Agent": reqUserAgent,
              },
            },
          ).then((r) => r.text());

          const reversoBodyPromise = fetchUpstream(
            `https://context.reverso.net/translation/${reversoLanguageName}-english/${encodedText}`,
            { headers: { "User-Agent": reqUserAgent } },
          ).then((r) => r.text());

          const results = await Promise.allSettled([
            glosbeBodyPromise,
            reversoBodyPromise,
          ]);
          const failed = results.filter(
            (result) => result.status === "rejected",
          );
          if (failed.length === results.length)
            throw new Error("All translation upstreams failed");
          for (const result of failed) {
            console.warn(
              JSON.stringify({
                event: "upstream_unavailable",
                error: String(result.reason),
              }),
            );
          }
          const [glosbeBody, reversoBody] = results.map((result) =>
            result.status === "fulfilled" ? result.value : "",
          );
          return ok(
            [
              {
                upstream: "glosbe",
                baseform: word,
                compounds: [],
                compoundsLemma: [],
                definitions: uniq(
                  $$(toDocument(glosbeBody), 'h3[id^="translation_"]')
                    .map((x) =>
                      textContent(x)
                        .replace(/(?![()])[^\p{L}| ]/gu, "")
                        .trim(),
                    )
                    .filter((x) => x),
                ),
              },
              {
                upstream: "reverso",
                baseform: word,
                compounds: [],
                compoundsLemma: [],
                definitions: uniq(
                  $$(toDocument(reversoBody), ".translation.dict")
                    .map((x) =>
                      (x.attribs["data-term"] || "")
                        .replace(/(?![()])[^\p{L}| ]/gu, "")
                        .trim(),
                    )
                    .filter((x) => x),
                ),
              },
            ],
            failed.length === 0,
          );
        }

        // Can be tested by searching for anden, partiledare, runt
        const svenskaMsearchResponse = await fetchUpstream(
          `https://svenska.se/api/msearch`,
          {
            method: "POST",
            headers: {
              "User-Agent": reqUserAgent,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              saol: {
                index: "sa-svenska-saol",
                query: word,
                exact_match: true,
                from: 0,
                size: 30,
              },
              so: {
                index: "sa-svenska-so",
                query: word,
                exact_match: true,
                from: 0,
                size: 30,
              },
              saob: {
                index: "sa-svenska-saob",
                query: word,
                exact_match: true,
                from: 0,
                size: 30,
              },
            }),
          },
        ).then((r) => r.json<SvenskaResponse>());

        const saolHits = (svenskaMsearchResponse.saol?.hits?.hits || []).filter(
          (hit: SvenskaHit) => hit._index.endsWith("-saol"),
        );
        const soHits = (svenskaMsearchResponse.so?.hits?.hits || []).filter(
          (hit: SvenskaHit) => hit._index.endsWith("-so"),
        );

        const parseLemmaFromHtml = (html: string) => {
          const match = html.match(/<a[^>]*>(.*?)<\/a>/);
          if (match) {
            return match[1]!.trim();
          }
          return stripHtml(html)
            .replace(/^se (även )?/i, "")
            .trim();
        };

        const saolResults: WordQueryResponse[] = saolHits.map(
          (hit: SvenskaHit) => ({
            upstream: "saol",
            baseform: hit._source.ortografi,
            compounds: [],
            compoundsLemma: [
              ...(hit._source.sparv_compound || []),
              ...(hit._source.enbartDigitalaHänvisningar || []).map(
                parseLemmaFromHtml,
              ),
            ],
            definitions: (hit._source.huvudbetydelser || []).map(
              (hb: { definition?: string }) => stripHtml(hb.definition),
            ),
          }),
        );

        const soResults: WordQueryResponse[] = soHits.map((hit: SvenskaHit) => {
          return {
            upstream: "so",
            baseform: hit._source.ortografi,
            compounds: [],
            compoundsLemma: [
              ...(hit._source.sparv_compound || []),
              ...(hit._source.enbartDigitalaHänvisningar || []).map(
                parseLemmaFromHtml,
              ),
            ],
            definitions: (hit._source.huvudbetydelser || []).map(
              (hb: { definition?: string }) => stripHtml(hb.definition),
            ),
          };
        });

        return ok([...saolResults, ...soResults], true);
      }

      return badRequest("Cannot parse request.");
    } catch (err) {
      console.error(
        JSON.stringify({ event: "request_failed", error: String(err) }),
      );
      return new Response(
        JSON.stringify({ error: "Upstream service unavailable" }),
        {
          status: 502,
          headers: { ...commonHeaders, "Cache-Control": "no-store" },
        },
      );
    }
  },
} satisfies ExportedHandler<Env>;

type SvenskaHit = {
  _index: string;
  _source: {
    ortografi: string;
    sparv_compound?: string[];
    enbartDigitalaHänvisningar?: string[];
    huvudbetydelser?: { definition?: string }[];
  };
};
type SvenskaResponse = {
  saol?: { hits?: { hits?: SvenskaHit[] } };
  so?: { hits?: { hits?: SvenskaHit[] } };
};

const fetchUpstream = async (
  url: string,
  init?: RequestInit,
): Promise<Response> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Upstream ${new URL(url).hostname} returned ${response.status}`,
    );
  }
  return response;
};
