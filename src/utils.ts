import {DOMParser, HTMLDocument, Element} from '../deps.ts';
import {WordQueryResponse} from './types.ts';

export const trimAndIgnoreEmpty = (x: string[]) =>
  x.map(x => x.trim()).filter(x => x);

export const toDocument = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html')!;

export const $$ = (document: HTMLDocument, selector: string) =>
  Array.from(document.querySelectorAll(selector)) as Element[];

export const $ = (
  document: HTMLDocument,
  selector: string
): Element | undefined => $$(document, selector).at(0);

export const createResponseFromSaol = (document: HTMLDocument) => {
  const compounds =
    $(document, '.grundform')
      ?.textContent.replace(/[^\p{L}| ]/gu, '')
      .split('|') ?? [];

  const baseform = compounds.join('');
  const compoundsLemma = $$(document, '.hvord').map(x =>
    x.textContent.replace(/[ 0-9]*$/gu, '')
  );

  const definitions = $$(document, '.lexemid .def').map(x => x.textContent);

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
  document: HTMLDocument
): WordQueryResponse => {
  // Ignore results with mismatching baseform.
  if (baseform !== $(document, '.orto')?.textContent) {
    return {
      upstream: '',
      baseform: '',
      compounds: [],
      compoundsLemma: [],
      definitions: [],
    };
  }

  // Can be tested by querying "ande"
  $$(document, '.fkomblock').forEach(x => {
    x.textContent = ` (${x.innerText}) `;
  });

  // Can be tested by querying "ande"
  $$(document, '.hkom').forEach(x => {
    x.textContent = ` <${x.innerText}> `;
  });

  return {
    upstream: 'so',
    baseform: baseform,
    compounds: [],
    compoundsLemma: [],
    definitions: $$(document, '.kbetydelse').map(x =>
      x.textContent
        .replace(/\s+/g, ' ')
        .replace(/(?![(<>)])[^\p{L}| ]/gu, '')
        .trim()
    ),
  };
};

export const reversoLanguageNameMapping: Record<string, string> = {
  it: 'italian',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  pt: 'portuguese',
};
