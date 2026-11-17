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

## Deployment with Workers Builds

This repository is ready for Cloudflare Workers Builds. There are no GitHub
Actions workflows: once connected, Workers Builds runs the checks and deploys
production directly from GitHub. Cloudflare creates and manages the build token;
you do not need to create a token manually or add a GitHub Actions secret.

`cloudflare.config.ts` defines the account, Worker name, entrypoint, compatibility
date, public workers.dev endpoint, CORS binding, and observability. The build
image reads `.node-version` for Node.js and `packageManager` in `package.json`
for npm. `package-lock.json` pins dependencies.

### Connect the existing Worker

1. Open [the Cloudflare Worker](https://dash.cloudflare.com/cfc930f5a1c44ec8df3c0e8819e7b9d0/workers/services/view/fetch-swedish-word-compounds/production)
   and go to **Settings → Builds → Connect**.
2. Choose **GitHub**, authorize the **Cloudflare Workers & Pages** GitHub app,
   and grant it access to `arthow4n/fetch-swedish-word-compounds`.
3. Connect the repository to the existing Worker with these settings:

   | Setting                                       | Value                                        |
   | --------------------------------------------- | -------------------------------------------- |
   | Production branch                             | `master`                                     |
   | Root directory                                | `/` (repository root)                        |
   | Build command                                 | `npm run check`                              |
   | Deploy command                                | `npm run deploy:built`                       |
   | API token                                     | Let Cloudflare create/manage the build token |
   | Builds for non-production branches / previews | Disabled                                     |

4. Save the settings and start the first build. If it does not start
   automatically, use **Retry build** or push a commit to `master`.
5. Confirm validation, deployment, and live smoke checks pass in the build log.
   Later pushes to `master` build and deploy automatically.

Leave automatic dependency installation enabled: the committed npm lockfile
selects npm. No custom Node/npm build variables or runtime secrets are required.
Use the commands above rather than the dashboard's default Wrangler commands;
this project uses the Cloudflare `cf` CLI and `cloudflare.config.ts`.

`npm run check` formats nothing: it verifies formatting, generates types,
type-checks, runs tests, and builds. A failed check prevents deployment.
`npm run deploy:built` deploys that exact build using `--prebuilt --mode production`
and then runs `npm run smoke` against the live Worker. A smoke failure fails the
build after deployment, so inspect the build log and deployed version if this
happens.

The initial Worker is already live. The API connection attempt reported
**This project is disconnected from your Git account**; the browser authorization
in step 2 must be completed before Workers Builds can be connected. The GitHub
app connection used by this coding assistant is separate from Cloudflare's
GitHub app authorization.

See [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
and [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
for the dashboard connection flow.

### Deploy from a local machine

For manual deployment outside Workers Builds, authenticate with the Cloudflare
CLI or set `CLOUDFLARE_API_TOKEN` in your local environment, then run:

```sh
npm ci
npm run check
npm run deploy:built
```

The consuming application is [web-swedish-reader](https://github.com/arthow4n/web-swedish-reader).
