import {DOMParser, Element, HTMLDocument} from '../deps.ts';

export const trimAndIgnoreEmpty = (x: string[]) =>
  x.map(x => x.trim()).filter(x => x);

export const toDocument = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html')!;

export const stripHtml = (html: string | undefined) =>
  (html && toDocument(html).body?.textContent) || '';

export const $$ = (document: HTMLDocument, selector: string) =>
  Array.from(document.querySelectorAll(selector)) as Element[];

export const $ = (
  document: HTMLDocument,
  selector: string
): Element | undefined => $$(document, selector).at(0);

export const reversoLanguageNameMapping: Record<string, string> = {
  it: 'italian',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  pt: 'portuguese',
};
