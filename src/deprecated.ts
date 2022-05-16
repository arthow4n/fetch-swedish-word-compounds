import 'dotenv/config';
import 'log-timestamp';
import got from 'got';
import QuickLRU from 'quick-lru';
import {ServerResponse} from 'node:http';
import cheerio from 'cheerio';
import {uniq} from 'lodash-es';
import {responseHeadersWithCache} from './headers.js';

type WordQueryResponse = {
  baseform: string;
  compounds: string[];
  compoundsLemma: string[];
  definitions: string[];
  alternatives: string[];
};

const lru = new QuickLRU<string, WordQueryResponse>({maxSize: 1000000});

export const compoundsV1 = async ({
  word,
  res,
  reqUserAgent,
}: {
  word: string;
  res: ServerResponse;
  reqUserAgent: string;
}) => {
  const ok = (word: string, response: WordQueryResponse) => {
    response.compounds = uniq(response.compounds);
    response.compoundsLemma = uniq(response.compoundsLemma);
    response.alternatives = uniq(response.alternatives);
    lru.set(word, response);

    res.writeHead(200, responseHeadersWithCache);
    res.end(JSON.stringify(response));
  };

  const cached = lru.get(word);
  if (cached) {
    console.log(`GET (from LRU cache) /compounds?word=: ${word}`);
    return ok(word, cached);
  }

  console.log(`GET /compounds?word=: ${word}`);

  const {body} = await got(
    `https://svenska.se/tri/f_saol.php?sok=${encodeURIComponent(word)}`,
    {
      headers: {
        'User-Agent': reqUserAgent,
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
};
