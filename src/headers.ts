import {OutgoingHttpHeaders} from 'node:http';

export const commonHaders: OutgoingHttpHeaders = {
  'Content-Type': 'application/json',
};

if (process.env.FSWC_CORS_ALLOW_ORIGIN) {
  console.log(`Enabling CORS for ${process.env.FSWC_CORS_ALLOW_ORIGIN}`);
  Object.assign(commonHaders, {
    'Access-Control-Allow-Origin': process.env.FSWC_CORS_ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Max-Age': '604800',
  });
}

export const cacheHeaders: OutgoingHttpHeaders = {
  'Cache-Control': 'public, max-age=604800, immutable',
};

export const responseHeadersWithCache: OutgoingHttpHeaders = {
  ...commonHaders,
  ...cacheHeaders,
};
