import 'https://deno.land/x/dotenv@v3.2.0/load.ts';

export {serve} from 'https://deno.land/std@0.159.0/http/server.ts';

export {DOMParser} from 'https://deno.land/x/deno_dom@v0.1.35-alpha/deno-dom-wasm.ts';
export type {
  HTMLDocument,
  Element,
} from 'https://deno.land/x/deno_dom@v0.1.35-alpha/src/api.ts';

// @deno-types="https://raw.githubusercontent.com/sindresorhus/quick-lru/v6.1.1/index.d.ts"
import QuickLRU from 'https://raw.githubusercontent.com/sindresorhus/quick-lru/v6.1.1/index.js';
export {QuickLRU};

export {
  uniq,
  uniqBy,
} from 'https://raw.githubusercontent.com/lodash/lodash/4.17.21-es/lodash.js';
