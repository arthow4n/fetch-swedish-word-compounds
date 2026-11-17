# fetch-swedish-word-compounds

A Cloudflare Worker that analyses Swedish words using svenska.se (SAOL and SO),
and translates Italian, Spanish, French, German, and Portuguese words into
English using Glosbe and Reverso.

Production: https://fetch-swedish-word-compounds.arthow4n.workers.dev

## Development

Use Node.js 24.22 or later in the Node 24 release line (see `.node-version`) and npm.

```sh
npm ci
npm run dev
curl 'http://localhost:5173/analyse?word=anden'
npm run check
```

`npm run check` checks formatting, generates Cloudflare runtime/binding types,
type-checks TypeScript, runs Vitest tests inside workerd, and builds the Worker.
Individual commands: `npm run format`, `npm run typecheck`, `npm test`,
`npm run build`. Generated types and build output live under `.cloudflare/`.
The npm lockfile pins the complete dependency tree. The Cloudflare CLI and Vite
plugin currently use pinned release candidates.

## API

`GET /analyse?word=anden` defaults to `sourceLanguage=sv`. Other supported language
codes are `it`, `es`, `fr`, `de`, and `pt`. URL-encode query values.

```json
[
  {
    "upstream": "saol",
    "baseform": "ande",
    "compounds": [],
    "compoundsLemma": [],
    "definitions": ["själ; personlighet; övernaturligt väsen"]
  }
]
```

Results contain `upstream`, `baseform`, `compounds`, `compoundsLemma`, and
`definitions`. HTML is removed and duplicate values are removed. Unknown words
return an empty array (or empty translation definitions). Swedish index names
may include svenska.se's current generation identifier.

Successful complete responses have a seven-day public cache lifetime, backed by
Cloudflare's per-location Cache API. Keys include the word and language; unrelated
query parameters do not duplicate entries. Invalid requests return JSON errors
with status 400. Network errors, timeouts, and upstream HTTP errors return 502
when no source is available. For translations, if one source fails the available
source is returned with an empty result for the unavailable source. Partial
results and errors use `Cache-Control: no-store`, allowing immediate recovery.
Reverso may deny server-side requests with HTTP 403; Glosbe remains usable.

`OPTIONS` returns a bodyless 204 with CORS headers. The text binding
`FSWC_CORS_ALLOW_ORIGIN` in `cloudflare.config.ts` defaults to `*`, including for
errors. Upstream requests have a 15-second timeout. No runtime secrets or storage
resources are required. Workers Logs and Traces are enabled.

## Deployment

`cloudflare.config.ts` defines the account, entrypoint, compatibility date,
public workers.dev endpoint, CORS binding, and observability. To deploy with a
Cloudflare API token that can edit Workers scripts in the configured account:

```sh
npm ci
npm run check
# Set CLOUDFLARE_API_TOKEN in your environment, then:
npm run deploy
npm run smoke
```

The `Worker checks` GitHub Actions workflow runs on pushes and pull requests.
The manual `Deploy Worker` workflow validates and deploys the selected revision;
it requires a `CLOUDFLARE_API_TOKEN` GitHub environment/repository secret.
The initial production deployment was uploaded through authenticated Cloudflare
API access. Automatic Git-based deployment is not connected: Cloudflare reports
the Git account is disconnected, and the available GitHub integration cannot
manage Actions secrets. Reconnect Git in Cloudflare to use Workers Builds, or
configure the Actions secret to enable the included deployment workflow.

The consuming application is [web-swedish-reader](https://github.com/arthow4n/web-swedish-reader).
