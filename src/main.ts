import 'dotenv/config';
import 'log-timestamp';
import got from 'got';
import QuickLRU from 'quick-lru';
import {uniq, uniqBy} from 'lodash-es';
import {createServer} from 'node:http';
import {URLSearchParams} from 'node:url';
import cheerio from 'cheerio';
import {parse} from 'node:url';
import {WordQueryResponse} from './types.js';
import {createResponseFromSaol, createResponseFromSo} from './utils.js';
import {commonHaders, responseHeadersWithCache} from './headers.js';
import {compoundsV1} from './deprecated.js';

const port = process.env.FSWC_PORT || process.env.PORT || 8000;

const lru = new QuickLRU<string, WordQueryResponse[]>({maxSize: 1000000});

createServer(async (req, res) => {
  try {
    const badRequest = () => {
      console.log(`Bad request: url=${req.url}`);
      res.writeHead(400, responseHeadersWithCache);
      res.end(JSON.stringify({error: 'Bad request'}));
    };

    const ok = (word: string, rr: WordQueryResponse[]) => {
      rr.forEach(r => {
        r.compounds = uniq(r.compounds);
        r.compoundsLemma = uniq(r.compoundsLemma);
      });

      const response = uniqBy(
        rr.filter(r => !!r.baseform),
        r => `${r.baseform}||${r.upstream}`
      );

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

    const reqUserAgent = req.headers['user-agent'] ?? '';

    if (req.method === 'GET') {
      const parsed = parse(req.url);

      const word = new URLSearchParams(parsed.query ?? '').get('word');
      if (!word) {
        return badRequest();
      }

      if (parsed.pathname === '/compounds') {
        return await compoundsV1({word, res, reqUserAgent});
      }

      if (parsed.pathname !== '/analyse') {
        return badRequest();
      }

      const cached = lru.get(word);
      if (cached) {
        console.log(`GET (from LRU cache) /analyse?word=: ${word}`);
        return ok(word, cached);
      }

      console.log(`GET /analyse?word=: ${word}`);

      const {body: saolBody} = await got(
        `https://svenska.se/tri/f_saol.php?sok=${encodeURIComponent(word)}`,
        {
          headers: {
            'User-Agent': reqUserAgent,
          },
        }
      );

      const $saolBody = cheerio.load(saolBody);
      const saolSlanks = $saolBody('.slank').toArray();

      const saolResults = !saolSlanks.length
        ? [createResponseFromSaol($saolBody)]
        : await Promise.all(
            saolSlanks.map(async (x): Promise<WordQueryResponse> => {
              try {
                const {body} = await got(
                  `https://svenska.se${$saolBody(x).attr('href')}`,
                  {
                    headers: {
                      'User-Agent': req.headers['user-agent'] ?? '',
                    },
                  }
                );

                return createResponseFromSaol(cheerio.load(body));
              } catch {
                return {
                  upstream: '',
                  baseform: '',
                  compounds: [],
                  compoundsLemma: [],
                  definitions: [],
                };
              }
            })
          );

      const soResults = await Promise.all(
        saolResults.map(async (x): Promise<WordQueryResponse> => {
          try {
            const {body} = await got(
              `https://svenska.se/tri/f_so.php?sok=${encodeURIComponent(
                x.baseform
              )}`,
              {
                headers: {
                  'User-Agent': req.headers['user-agent'] ?? '',
                },
              }
            );

            return createResponseFromSo(x.baseform, cheerio.load(body));
          } catch {
            return {
              upstream: '',
              baseform: '',
              compounds: [],
              compoundsLemma: [],
              definitions: [],
            };
          }
        })
      );

      return ok(word, [...saolResults, ...soResults]);
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
