export const commonHaders = {
  'Content-Type': 'application/json',
};

if (Deno.env.get('FSWC_CORS_ALLOW_ORIGIN')) {
  console.log(
    `${new Date().toISOString()}: Enabling CORS for ${Deno.env.get(
      'FSWC_CORS_ALLOW_ORIGIN'
    )}`
  );
  Object.assign(commonHaders, {
    'Access-Control-Allow-Origin': Deno.env.get('FSWC_CORS_ALLOW_ORIGIN'),
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Max-Age': '604800',
  });
}

export const cacheHeaders = {
  'Cache-Control': 'public, max-age=604800, immutable',
};

export const responseHeadersWithCache = {
  ...commonHaders,
  ...cacheHeaders,
};
