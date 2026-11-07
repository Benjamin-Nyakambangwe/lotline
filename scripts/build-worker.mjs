// Bundle the worker into a single ESM file for production (`node dist/worker.mjs`).
// Dependencies stay external (installed with `npm ci`); our own code and the @/ alias are bundled.
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker/main.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
