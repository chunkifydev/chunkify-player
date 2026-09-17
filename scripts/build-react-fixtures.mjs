import { build } from "esbuild";

// Bundle React's development runtime for local browser tests, not for publication.
await build({
  entryPoints: ["tests/fixtures/react.ts", "tests/fixtures/react-runtime.ts"],
  splitting: true,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: "tests/fixtures/dist",
  external: ["@chunkify/player-react"],
  define: { "process.env.NODE_ENV": '"development"' },
});
