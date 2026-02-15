import {QuickLRU, serve, uniq} from '../deps.ts';
import {WordQueryResponse} from './types.ts';
import {
  $$,
  reversoLanguageNameMapping,
  stripHtml,
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

      const response = rr.filter(r => !!r.baseform);

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
        const reversoLanguageName = reversoLanguageNameMapping[sourceLanguage];
        if (!reversoLanguageName) {
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
          `https://context.reverso.net/translation/${reversoLanguageName}-english/${encodedText}`
        ).then(r => r.text());

        return ok(sourceLanguage, word, [
          {
            upstream: 'glosbe',
            baseform: word,
            compounds: [],
            compoundsLemma: [],
            definitions: uniq(
              $$(toDocument(await glosbeBodyPromise), 'h3[id^="translation_"]')
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

      // Can be tested by searching for anden, partiledare, runt
      const svenskaMsearchResponse = await fetch(
        `https://svenska.se/api/msearch`,
        {
          method: 'POST',
          headers: {
            'User-Agent': reqUserAgent,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            saol: {
              index: 'sa-svenska-saol',
              query: word,
              exact_match: true,
              from: 0,
              size: 30,
            },
            so: {
              index: 'sa-svenska-so',
              query: word,
              exact_match: true,
              from: 0,
              size: 30,
            },
            saob: {
              index: 'sa-svenska-saob',
              query: word,
              exact_match: true,
              from: 0,
              size: 30,
            },
          }),
        }
      ).then(r => r.json());

      const saolHits = (svenskaMsearchResponse.saol?.hits?.hits || []).filter(
        (hit: any) => hit._index === 'sa-svenska-saol'
      );
      const soHits = (svenskaMsearchResponse.so?.hits?.hits || []).filter(
        (hit: any) => hit._index === 'sa-svenska-so'
      );

      const saolResults: WordQueryResponse[] = saolHits.map((hit: any) => ({
        upstream: 'saol',
        baseform: hit._source.ortografi,
        compounds: [],
        compoundsLemma: hit._source.sparv_compound || [],
        definitions: (hit._source.huvudbetydelser || []).map((hb: any) =>
          stripHtml(hb.definition)
        ),
      }));

      const soResults: WordQueryResponse[] = soHits.map((hit: any) => {
        return {
          upstream: 'so',
          baseform: hit._source.ortografi,
          compounds: [],
          compoundsLemma: hit._source.sparv_compound || [],
          definitions: (hit._source.huvudbetydelser || []).map((hb: any) =>
            stripHtml(hb.definition)
          ),
        };
      });

      return ok(sourceLanguage, word, [...saolResults, ...soResults]);
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
