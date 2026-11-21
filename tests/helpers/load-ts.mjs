import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const React = require("react");

if (!globalThis.React) {
  globalThis.React = React;
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const jiti = createJiti(path.join(ROOT_DIR, "package.json"), {
  jsx: true,
  alias: {
    "@": path.join(ROOT_DIR, "src"),
    "server-only": path.join(ROOT_DIR, "node_modules/server-only/empty.js"),
  },
});

/**
 * Loads a TypeScript module from the repository using jiti (Node 20 compatible),
 * with `@/*` mapped to `src/*` and `server-only` stubbed to Next's empty module.
 */
export function loadTs(repoRelativePath) {
  return jiti(path.join(ROOT_DIR, repoRelativePath));
}
