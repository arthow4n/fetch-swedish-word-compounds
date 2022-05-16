import {CheerioAPI} from 'cheerio';
import {WordQueryResponse} from './types';

export const trimAndIgnoreEmpty = (x: string[]) =>
  x.map(x => x.trim()).filter(x => x);

/**
 * @example
 * createResponseFromSaol(cheerio.load("html from SAOL"));
 */
export const createResponseFromSaol = ($: CheerioAPI) => {
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

  const resp: WordQueryResponse = {
    upstream: 'saol',
    baseform,
    compounds,
    compoundsLemma,
    definitions,
  };

  return resp;
};

export const createResponseFromSo = (
  baseform: string,
  $: CheerioAPI
): WordQueryResponse => {
  // Ignore results with mismatching baseform.
  if (baseform !== $('.orto').eq(0).text()) {
    return {
      upstream: '',
      baseform: '',
      compounds: [],
      compoundsLemma: [],
      definitions: [],
    };
  }

  $('.fkomblock')
    .toArray()
    .forEach(x => {
      $(x).text(` (${$(x).text()}) `);
    });

  return {
    upstream: 'so',
    baseform: baseform,
    compounds: [],
    compoundsLemma: [],
    definitions: $('.kbetydelse')
      .toArray()
      .map(x =>
        $(x)
          .text()
          .replace(/(?![()])[^\p{L}| ]/gu, '')
          .trim()
      ),
  };
};
