import {WordQueryResponse} from './types.ts';

export const trimAndIgnoreEmpty = (x: string[]) =>
  x.map(x => x.trim()).filter(x => x);

/**
 * @example
 * createResponseFromSaol(cheerio.load("html from SAOL"));
 */
// deno-lint-ignore no-explicit-any
export const createResponseFromSaol = ($: any) => {
  const compounds = $('.grundform')
    .eq(0)
    .text()
    .replace(/[^\p{L}| ]/gu, '')
    .split('|');

  const baseform = compounds.join('');
  const compoundsLemma = $('.hvord')
    .toArray()
    .map((x: unknown) =>
      $(x)
        .text()
        .replace(/[ 0-9]*$/gu, '')
    );

  const definitions = $('.lexemid .def')
    .toArray()
    .map((x: unknown) => $(x).text());

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
  // deno-lint-ignore no-explicit-any
  $: any
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
    .forEach((x: unknown) => {
      $(x).text(` (${$(x).text()}) `);
    });

  return {
    upstream: 'so',
    baseform: baseform,
    compounds: [],
    compoundsLemma: [],
    definitions: $('.kbetydelse')
      .toArray()
      .map((x: unknown) =>
        $(x)
          .text()
          .replace(/(?![()])[^\p{L}| ]/gu, '')
          .trim()
      ),
  };
};
