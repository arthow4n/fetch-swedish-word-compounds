import {OutgoingHttpHeaders} from 'node:http';

export const commonHaders: OutgoingHttpHeaders = {
  'Content-Type': 'application/json',
};

export const cacheHeaders: OutgoingHttpHeaders = {
  'Cache-Control': 'public, max-age=604800, immutable',
};

export const responseHeadersWithCache: OutgoingHttpHeaders = {
  ...commonHaders,
  ...cacheHeaders,
};
