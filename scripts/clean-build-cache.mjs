/**
 * Runs before every `npm run build` (the `prebuild` script), locally and on Vercel.
 *
 * Turbopack keeps a persistent cache in .next/cache/turbopack, and Vercel
 * restores .next/cache between deploys. When that cache goes stale the build
 * dies resolving the Google fonts with "next/font/google queries have exactly
 * one entry", even though nothing in the code changed. Dropping just this
 * folder costs a few seconds of build time and removes that failure; the
 * dev server keeps its own cache under .next/dev and is not touched.
 */
import { rmSync } from "node:fs";

rmSync(new URL("../.next/cache/turbopack", import.meta.url), { recursive: true, force: true });
console.log("Cleared .next/cache/turbopack before building.");
