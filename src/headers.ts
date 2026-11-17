export const responseHeaders = (origin: string) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "604800",
});

export const cacheControl = "public, max-age=604800, immutable";
