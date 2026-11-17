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
The `Deploy Worker` workflow runs after each push to `master`, or manually from
the Actions tab with `master` selected. It validates the source, deploys that
same build with `--prebuilt --mode production`, then runs live smoke checks.
Deployments are serialized. Other branches cannot deploy to production.

### GitHub Actions setup

One secret is required; the account ID is already configured in
`cloudflare.config.ts`.

1. Open [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens)
   and create a custom token named `fetch-swedish-word-compounds GitHub Actions`.
   Grant **Account / Workers Scripts / Edit** and **Account / Account Settings /
   Read**, restricted to the **arthow4n** account. No zone permissions are needed
   for this workers.dev deployment. Copy the generated token.
2. Open [GitHub Actions secrets](https://github.com/arthow4n/fetch-swedish-word-compounds/settings/secrets/actions)
   and select **New repository secret**. Name it `CLOUDFLARE_API_TOKEN` and paste
   the token as its value. Alternatively, add it to the existing **Production**
   environment. Never commit the token or paste it into chat.
3. Open [Deploy Worker](https://github.com/arthow4n/fetch-swedish-word-compounds/actions/workflows/deploy.yml),
   select **Run workflow**, select `master`, and run it. Confirm the deployment
   and live verification steps pass. Later pushes to `master` deploy automatically.

With an appropriately authorized GitHub CLI login, step 2 can also be performed
with this command, which prompts for the secret value without putting it in
shell history:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo arthow4n/fetch-swedish-word-compounds
```

When the secret is missing, validation still runs, but deployment and live
verification are skipped. The workflow emits a warning and records **Deployment
pending configuration** in its summary. A green check alone does not mean a
deployment occurred; look for **Worker deployed and verified** in the summary.

The initial production deployment was uploaded through authenticated Cloudflare
API access. The available GitHub app credential cannot manage Actions secrets,
and Cloudflare token management requires reconnecting the app. Completing the
secret setup above does not require Cloudflare's separate Git integration or
Workers Builds.

The consuming application is [web-swedish-reader](https://github.com/arthow4n/web-swedish-reader).
