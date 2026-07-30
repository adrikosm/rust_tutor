#!/usr/bin/env node

import { rm } from "node:fs/promises";

const generated = [
  "target",
  "dist",
  "apps/web/dist",
  "apps/web/.tanstack",
  "apps/web/node_modules/.vite",
  "apps/web/node_modules/.vite-temp",
];

await Promise.all(generated.map((path) => rm(path, { recursive: true, force: true })));
console.log(`Removed generated build output: ${generated.join(", ")}`);
