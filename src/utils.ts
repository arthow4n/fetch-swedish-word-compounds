import { parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { selectAll } from "css-select";
import { textContent } from "domutils";

export const uniq = <T>(values: T[]): T[] => [...new Set(values)];
export const trimAndIgnoreEmpty = (values: string[]) =>
  values.map((value) => value.trim()).filter(Boolean);
export const toDocument = (html: string) => parseDocument(html);
export const stripHtml = (html: string | undefined) =>
  html ? textContent(toDocument(html)) : "";
export const $$ = (document: ReturnType<typeof toDocument>, selector: string) =>
  selectAll<AnyNode, Element>(selector, document);
export { textContent };

export const reversoLanguageNameMapping: Record<string, string> = Object.assign(
  Object.create(null),
  {
    it: "italian",
    es: "spanish",
    fr: "french",
    de: "german",
    pt: "portuguese",
  },
);
