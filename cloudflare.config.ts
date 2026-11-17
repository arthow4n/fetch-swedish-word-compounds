import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "cfc930f5a1c44ec8df3c0e8819e7b9d0",
  worker: {
    name: "fetch-swedish-word-compounds",
    workersDev: true,
    entrypoint: "./src/main.ts",
    compatibilityDate: "2026-11-17",
    env: { FSWC_CORS_ALLOW_ORIGIN: bindings.text("*") },
    observability: { enabled: true, traces: { enabled: true } },
  },
});
