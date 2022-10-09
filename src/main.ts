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

const lru = new QuickLRU<string, WordQueryResponse[]>({maxSize: 1000000});

const handler = async (req: Request): Promise<Response> => {
  try {
    const badRequest = () => {
      console.log(`${new Date().toISOString()}: Bad request: url=${req.url}`);
      return new Response(JSON.stringify({error: 'Bad request'}), {
        headers: responseHeadersWithCache,
        status: 400,
      });
    };

    const ok = (word: string, rr: WordQueryResponse[]) => {
      rr.forEach(r => {
        r.compounds = trimAndIgnoreEmpty(uniq(r.compounds));
        r.compoundsLemma = trimAndIgnoreEmpty(uniq(r.compoundsLemma));
        r.definitions = trimAndIgnoreEmpty(uniq(r.definitions));
      });

      const response = uniqBy(
        rr.filter(r => !!r.baseform),
        (r: WordQueryResponse) => `${r.baseform}||${r.upstream}`
      );

      lru.set(word, response);
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: responseHeadersWithCache,
      });
    };

    if (!req.url) {
      return badRequest();
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
      const word = new URL(req.url).searchParams.get('word');
      if (!word) {
        return badRequest();
      }

      if (url.pathname !== '/analyse') {
        return badRequest();
      }

      const cached = lru.get(word);
      if (cached) {
        console.log(
          `${new Date().toISOString()}: GET (from LRU cache) /analyse?word=: ${word}`
        );
        return ok(word, cached);
      }

      console.log(`${new Date().toISOString()}: GET /analyse?word=: ${word}`);

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

      return ok(word, [...saolResults, ...soResults.flat()]);
    }

    return badRequest();
  } catch (err) {
    console.error({req, err});
    return new Response(JSON.stringify({error: 'Internal server error'}), {
      status: 500,
      headers: commonHaders,
    });
  }
};

serve(handler, {port});
console.log(`${new Date().toISOString()}: Up and running on port ${port}`);
