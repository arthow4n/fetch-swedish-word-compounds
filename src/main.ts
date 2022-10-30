import {uniq, uniqBy, QuickLRU, serve} from '../deps.ts';
import {WordQueryResponse} from './types.ts';
import {
  $,
  $$,
  createResponseFromSaol,
  createResponseFromSo,
  toDocument,
  trimAndIgnoreEmpty,
} from './utils.ts';
import {commonHaders, responseHeadersWithCache} from './headers.ts';

const port = parseInt(
  Deno.env.get('FSWC_PORT') || Deno.env.get('PORT') || '8000',
  10
);

const sourceLanguageLruMapping: Record<
  string,
  QuickLRU<string, WordQueryResponse[]>
> = Object.create(null);

const getLru = (sourceLanguage: string) => {
  sourceLanguageLruMapping[sourceLanguage] ??= new QuickLRU<
    string,
    WordQueryResponse[]
  >({maxSize: 1000000});
  return sourceLanguageLruMapping[sourceLanguage];
};

const handler = async (req: Request): Promise<Response> => {
  try {
    const badRequest = (reason: string) => {
      console.log(`${new Date().toISOString()}: Bad request: url=${req.url}`);
      return new Response(JSON.stringify({error: `Bad request: ${reason}`}), {
        headers: responseHeadersWithCache,
        status: 400,
      });
    };

    const ok = (
      sourceLanguage: string,
      word: string,
      rr: WordQueryResponse[]
    ) => {
      rr.forEach(r => {
        r.compounds = trimAndIgnoreEmpty(uniq(r.compounds));
        r.compoundsLemma = trimAndIgnoreEmpty(uniq(r.compoundsLemma));
        r.definitions = trimAndIgnoreEmpty(uniq(r.definitions));
      });

      const response = uniqBy(
        rr.filter(r => !!r.baseform),
        (r: WordQueryResponse) => `${r.baseform}||${r.upstream}`
      );

      getLru(sourceLanguage).set(word, response);
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: responseHeadersWithCache,
      });
    };

    if (!req.url) {
      return badRequest('URL is invalid.');
    }

    if (req.method === 'OPTIONS') {
      return new Response('', {
        status: 204,
        headers: commonHaders,
      });
    }

    const reqUserAgent = req.headers.get('User-Agent') ?? '';

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const word = url.searchParams.get('word');
      if (!word) {
        return badRequest('Missing required parameter: ?word=');
      }

      if (url.pathname !== '/analyse') {
        return badRequest('Endpoints beside /analyse are not implemented yet.');
      }

      const sourceLanguage = url.searchParams.get('sourceLanguage') || 'sv';

      const cached = getLru(sourceLanguage).get(word);
      if (cached) {
        console.log(
          `${new Date().toISOString()}: GET (from LRU cache) /analyse?sourceLanguage=:${sourceLanguage}, word=: ${word}`
        );
        return ok(sourceLanguage, word, cached);
      }

      console.log(
        `${new Date().toISOString()}: GET /analyse?sourceLanguage=:${sourceLanguage}, word=: ${word}`
      );

      if (sourceLanguage != 'sv') {
        if (!/[a-z]{2}/.test(sourceLanguage)) {
          return badRequest(`${sourceLanguage} is not a valid language code.`);
        }

        const encodedText = encodeURIComponent(word);
        const glosbeBodyPromise = fetch(
          `https://glosbe.com/${sourceLanguage}/en/${encodedText}`,
          {
            headers: {
              'User-Agent': reqUserAgent,
            },
          }
        ).then(r => r.text());

        const reversoBodyPromise = fetch(
          `https://context.reverso.net/translation/italian-english/${encodedText}`
        ).then(r => r.text());

        return ok(sourceLanguage, word, [
          {
            upstream: 'glosbe',
            baseform: word,
            compounds: [],
            compoundsLemma: [],
            definitions: uniq(
              $$(toDocument(await glosbeBodyPromise), 'h3.translation')
                .map(x =>
                  x.textContent.replace(/(?![()])[^\p{L}| ]/gu, '').trim()
                )
                .filter(x => x)
            ),
          },
          {
            upstream: 'reverso',
            baseform: word,
            compounds: [],
            compoundsLemma: [],
            definitions: uniq(
              $$(toDocument(await reversoBodyPromise), '.translation.dict')
                .map(x =>
                  (x.getAttribute('data-term') || '')
                    .replace(/(?![()])[^\p{L}| ]/gu, '')
                    .trim()
                )
                .filter(x => x)
            ),
          },
        ]);
      }

      const saolBody = await fetch(
        `https://svenska.se/tri/f_saol.php?sok=${encodeURIComponent(word)}`,
        {
          headers: {
            'User-Agent': reqUserAgent,
          },
        }
      ).then(r => r.text());

      const $saolBody = toDocument(saolBody);
      const saolFoundNothing = $($saolBody, 'body')
        ?.textContent.trim()
        .startsWith(`Sökningen på ${word} i`);

      // This can be tested by querying "anden".
      const saolSlanks = $$($saolBody, '.slank');

      const createEmptyResponse = (): WordQueryResponse => {
        return {
          upstream: '',
          baseform: '',
          compounds: [],
          compoundsLemma: [],
          definitions: [],
        };
      };

      const saolResults = saolFoundNothing
        ? []
        : !saolSlanks.length
        ? [createResponseFromSaol($saolBody)]
        : await Promise.all(
            saolSlanks.map(async (x): Promise<WordQueryResponse> => {
              try {
                const body = await fetch(
                  `https://svenska.se${x.getAttribute('href')}`,
                  {
                    headers: {
                      'User-Agent': reqUserAgent,
                    },
                  }
                ).then(r => r.text());

                return createResponseFromSaol(toDocument(body));
              } catch {
                return createEmptyResponse();
              }
            })
          );

      const soResults = await Promise.all(
        saolResults.map(async (x): Promise<WordQueryResponse[]> => {
          try {
            const baseform = x.baseform;
            const soBody = await fetch(
              `https://svenska.se/tri/f_so.php?sok=${encodeURIComponent(
                baseform
              )}`,
              {
                headers: {
                  'User-Agent': reqUserAgent,
                },
              }
            ).then(r => r.text());

            const $soBody = toDocument(soBody);
            const soFoundNothing = $soBody.textContent.startsWith(
              `Sökningen på ${word} i`
            );
            // This can be tested by querying "runt".
            const soSlanks = $$($soBody, '.slank');
            return soFoundNothing
              ? []
              : !soSlanks.length
              ? [createResponseFromSo(baseform, $soBody)]
              : await Promise.all(
                  soSlanks.map(async (x): Promise<WordQueryResponse> => {
                    try {
                      const body = await fetch(
                        `https://svenska.se${x.getAttribute('href')}`,
                        {
                          headers: {
                            'User-Agent': reqUserAgent,
                          },
                        }
                      ).then(r => r.text());

                      return createResponseFromSo(baseform, toDocument(body));
                    } catch {
                      return createEmptyResponse();
                    }
                  })
                );
          } catch {
            return [];
          }
        })
      );

      return ok(sourceLanguage, word, [...saolResults, ...soResults.flat()]);
    }

    return badRequest('Cannot parse request.');
  } catch (err) {
    console.error({req, err});
    return new Response(JSON.stringify({error: 'Internal server error'}), {
      status: 500,
      headers: commonHaders,
    });
  }
};

serve(handler, {port});

console.log(
  `${new Date().toISOString()}: Link for debugging: http://localhost:${port}/analyse?word=anden`
);
console.log(
  `${new Date().toISOString()}: Link for debugging: http://localhost:${port}/analyse?sourceLanguage=it&word=di`
);
console.log(
  `${new Date().toISOString()}: Link for debugging: http://localhost:${port}/analyse?sourceLanguage=it&word=offrirvi`
);

console.log(`${new Date().toISOString()}: Up and running on port ${port}`);
