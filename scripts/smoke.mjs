import assert from "node:assert/strict";

const base =
  process.env.API_BASE_URL ||
  "https://fetch-swedish-word-compounds.arthow4n.workers.dev";
const call = (path, method = "GET") =>
  fetch(new URL(path, base), {
    method,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Origin: "https://arthow4n.github.io",
    },
    signal: AbortSignal.timeout(45000),
  });
const preflight = await call("/analyse", "OPTIONS");
assert.equal(preflight.status, 204);
assert.equal(await preflight.text(), "");
assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
for (const path of ["/analyse", "/analyse?word=x&sourceLanguage=constructor"]) {
  const response = await call(path);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
}
for (const [sourceLanguage, word] of [
  ["sv", "anden"],
  ["sv", "partiledare"],
  ["sv", "runt"],
  ["it", "di"],
  ["es", "casa"],
  ["fr", "maison"],
  ["de", "Haus"],
  ["pt", "casa"],
]) {
  const response = await call(
    `/analyse?${new URLSearchParams({ sourceLanguage, word })}`,
  );
  assert.equal(
    response.status,
    200,
    `${sourceLanguage}: ${await response.clone().text()}`,
  );
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const result = await response.json();
  assert.ok(
    Array.isArray(result) && result.length > 0,
    `${sourceLanguage}/${word}: no results`,
  );
  assert.ok(
    result.some((entry) => entry.definitions.length > 0),
    `${sourceLanguage}/${word}: no definitions`,
  );
  for (const entry of result) {
    assert.equal(typeof entry.baseform, "string");
    for (const key of ["compounds", "compoundsLemma", "definitions"])
      assert.ok(Array.isArray(entry[key]));
  }
  console.log(
    `${sourceLanguage}/${word}: ${result.length} results, ${result.flatMap((entry) => entry.definitions).length} definitions (${response.headers.get("cache-control")})`,
  );
}
console.log("Live Worker smoke checks passed");
