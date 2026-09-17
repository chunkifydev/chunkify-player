import { build } from "esbuild";

// Bundle React's development runtime for local tests and the example, not for publication.
await build({
  entryPoints: {
    react: "tests/fixtures/react.ts",
    "react-runtime": "tests/fixtures/react-runtime.ts",
    example: "examples/react/main.tsx",
  },
  splitting: true,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: "tests/fixtures/dist",
  external: ["@chunkify/player-react"],
  define: { "process.env.NODE_ENV": '"development"' },
});
