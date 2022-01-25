import 'dotenv/config';
import 'log-timestamp';
import got from 'got';
import QuickLRU from 'quick-lru';
import {createServer, OutgoingHttpHeaders} from 'node:http';
import {URLSearchParams} from 'node:url';
import cheerio from 'cheerio';
import {parse} from 'node:url';

type WordQueryResponse = {
  baseform: string;
  compounds: string[];
  compoundsLemma: string[];
  definitions: string[];
  alternatives: string[];
};

const port = process.env.FSWC_PORT || 8000;
const commonHaders: OutgoingHttpHeaders = {
  'Content-Type': 'application/json',
};

const lru = new QuickLRU<string, WordQueryResponse>({maxSize: 100000});
const uniq = <T>(x: T[]) => Array.from(new Set(x));

const cacheHeaders: OutgoingHttpHeaders = {
  'Cache-Control': 'public, max-age=604800, immutable',
};

if (process.env.FSWC_CORS_ALLOW_ORIGIN) {
  console.log(`Enabling CORS for ${process.env.FSWC_CORS_ALLOW_ORIGIN}`);
  Object.assign(commonHaders, {
    'Access-Control-Allow-Origin': process.env.FSWC_CORS_ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Max-Age': '604800',
  });
}

const responseHeadersWithCache: OutgoingHttpHeaders = {
  ...commonHaders,
  ...cacheHeaders,
};

createServer(async (req, res) => {
  try {
    const badRequest = () => {
      console.log(`Bad request: url=${req.url}`);
      res.writeHead(400, responseHeadersWithCache);
      res.end(JSON.stringify({error: 'Bad request'}));
    };

    const ok = (word: string, response: WordQueryResponse) => {
      response.compounds = uniq(response.compounds);
      response.compoundsLemma = uniq(response.compoundsLemma);
      response.alternatives = uniq(response.alternatives);
      lru.set(word, response);

      res.writeHead(200, responseHeadersWithCache);
      res.end(JSON.stringify(response));
    };

    if (!req.url) {
      return badRequest();
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, commonHaders);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const parsed = parse(req.url);
      if (parsed.pathname !== '/compounds') {
        return badRequest();
      }

      const word = new URLSearchParams(parsed.query ?? '').get('word');
      if (!word) {
        return badRequest();
      }

      if (lru.has(word)) {
        const cached = lru.get(word);
        if (!cached) {
          throw new Error("Expected LRU cache hit but didn't");
        }

        console.log(`GET (from LRU cache) /compounds?word=: ${word}`);
        return ok(word, cached);
      }

      console.log(`GET /compounds?word=: ${word}`);

      const {body} = await got(
        `https://svenska.se/tri/f_saol.php?sok=${encodeURIComponent(word)}`,
        {
          headers: {
            'User-Agent': req.headers['user-agent'] ?? '',
          },
        }
      );

      const $ = cheerio.load(body);
      const slanks = $('.slank').toArray();
      if (slanks.length) {
        return ok(word, {
          baseform: '',
          compounds: [],
          compoundsLemma: [],
          definitions: [],
          alternatives: slanks
            .map(
              x =>
                $(x)
                  .text()
                  .match(/\((.+)\)/)?.[1] ?? ''
            )
            .filter(x => x),
        });
      }

      const compounds = $('.grundform')
        .eq(0)
        .text()
        .replace(/[^\p{L}| ]/gu, '')
        .split('|');

      const baseform = compounds.join('');
      const compoundsLemma = $('.hvord')
        .toArray()
        .map(x =>
          $(x)
            .text()
            .replace(/[ 0-9]*$/gu, '')
        );

      const definitions = $('.lexemid .def')
        .toArray()
        .map(x => $(x).text());

      return ok(word, {
        baseform,
        compounds,
        compoundsLemma,
        definitions,
        alternatives: [],
      });
    }

    return badRequest();
  } catch (err) {
    console.error({req, err});
    res.writeHead(500, commonHaders);
    res.end(JSON.stringify({error: 'Internal server error'}));
    return;
  }
}).listen(port, () => {
  console.log(`Up and running on port ${port}`);
});
