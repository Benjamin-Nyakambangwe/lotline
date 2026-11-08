// Bundle the worker and the migration script into ESM files for production:
//   node dist/worker.mjs    the worker service
//   node dist/migrate.mjs   the web service's pre-deploy step
// Dependencies stay external (installed with `npm ci`); our own code and the @/ alias are bundled.
import { build } from "esbuild";

for (const [entry, out] of [
  ["src/worker/main.ts", "dist/worker.mjs"],
  ["scripts/migrate.ts", "dist/migrate.mjs"],
])
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    packages: "external",
    sourcemap: true,
    tsconfig: "tsconfig.json",
    logLevel: "info",
  });
