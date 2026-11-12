import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig, type Plugin } from "vitest/config";

const FIXTURE_DIR = join(import.meta.dirname, "test/fixture");
const MODULE_ID = "virtual:fixture";

/** テストのデータ (test/fixture/ の Parquet と目録) を { 相対パス: ArrayBuffer } として import できるようにする */
const fixture: Plugin = {
  name: "fixture",
  resolveId: (id) => (id === MODULE_ID ? `\0${MODULE_ID}` : null),
  load(id) {
    if (id !== `\0${MODULE_ID}`) return null;
    const entries = readdirSync(FIXTURE_DIR, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".parquet") || f.endsWith(".json"))
      .map(
        (f) =>
          `${JSON.stringify(relative(FIXTURE_DIR, join(FIXTURE_DIR, f)))}: Uint8Array.from(atob("${readFileSync(join(FIXTURE_DIR, f)).toString("base64")}"), (c) => c.charCodeAt(0)).buffer`,
      )
      .join(",\n");
    return `export default {${entries}};`;
  },
};

export default defineConfig({
  plugins: [
    fixture,
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // test/fixture/ (test/make-fixture.py) を R2 の fixture/ に置いて、目録から読む
      miniflare: {
        bindings: {
          AREA_PROFILE_SOURCE: "fixture/area_profile.json",
          COMPANY_PROFILE_SOURCE: "fixture/company_profile.json",
        },
      },
    }),
  ],
});
