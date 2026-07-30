#!/usr/bin/env node

// Validates the from-zero course (apps/web/src/features/learning/course.ts):
// every knowledge-graph ID it references — wiki links [[ID|text]] and the
// per-chapter `concepts` arrays — must exist in the embedded tutor feed, so a
// renamed or dropped concept fails CI instead of shipping a dead link.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const feed = JSON.parse(await read("knowledge/feed/generated/tutor-feed.json"));
const nodeIds = new Set(feed.graphProjection.nodes.map((node) => node.id));

const source = await read("apps/web/src/features/learning/course.ts");

// Real IDs look like CON-RUST-OWNERSHIP-001 / RFT-RUST-SLICE-001 / ERR-RUST-E0382-001:
// an uppercase prefix and a trailing numeric segment. This skips the header
// comment's `[[GRAPH-ID|...]]` markup example.
const isGraphId = (value) => /^[A-Z]{2,5}-[A-Z0-9-]+-\d+$/.test(value);

const referenced = new Map(); // id -> where it was seen
for (const [, id] of source.matchAll(/\[\[([^\]|]+)\|/g)) {
  if (isGraphId(id)) referenced.set(id, "wiki link");
}
for (const [, body] of source.matchAll(/concepts:\s*\[([^\]]*)\]/g)) {
  for (const [, id] of body.matchAll(/"([^"]+)"/g)) {
    if (isGraphId(id)) referenced.set(id, "concepts array");
  }
}

const missing = [...referenced].filter(([id]) => !nodeIds.has(id));

if (missing.length > 0) {
  console.error("course.ts references graph IDs that are not in the tutor feed:");
  for (const [id, where] of missing) console.error(`  - ${id} (${where})`);
  process.exit(1);
}

console.log(`course.ts: ${referenced.size} graph references, all resolve in the tutor feed.`);
