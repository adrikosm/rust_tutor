// Static verification only: checks design tokens, contrast ratios, motion and
// focus foundations, and bundled fonts. It opens no browser and drives no
// interaction; runtime behavior is covered by the Rust and web test suites.
import { existsSync, readdirSync, readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/styles/app.css", "utf8");
const themes = {
  light: css.match(/:root,\s*:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "",
  dark: css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "",
};

function token(block, name) {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing --${name} token`);
  return value;
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const [theme, block] of Object.entries(themes)) {
  const effectiveBlock = theme === "dark" ? `${block}\n${themes.light}` : block;
  for (const [foreground, background] of [
    ["text", "canvas"],
    ["text-muted", "canvas"],
    ["text", "surface"],
    ["focus", "canvas"],
    ["warning-on-brand", "forest"],
    ["terminal-text", "terminal"],
  ]) {
    const ratio = contrast(token(effectiveBlock, foreground), token(effectiveBlock, background));
    if (ratio < 4.5)
      throw new Error(`${theme} ${foreground}/${background} contrast is ${ratio.toFixed(2)}:1`);
  }
}

if (!css.includes("prefers-reduced-motion") || !css.includes(":focus-visible")) {
  throw new Error("Reduced-motion or visible-focus foundation is missing");
}
for (const font of [
  "apps/web/public/fonts/albert-sans/albert-sans-latin-variable.woff2",
  "apps/web/public/fonts/jetbrains-mono/jetbrains-mono-latin-variable.woff2",
]) {
  if (!existsSync(font)) throw new Error(`Missing self-hosted font: ${font}`);
}
if (/https?:\/\/[^")]+(?:woff2?|ttf|otf)/i.test(css)) {
  throw new Error("Stylesheet contains an external font request");
}
const assets = readdirSync("apps/web/dist/client/assets");
for (const route of ["dashboard-", "graph-", "practice-", "review-"]) {
  if (!assets.some((asset) => asset.startsWith(route)))
    throw new Error(`Missing split ${route} route asset`);
}
const manifest = JSON.parse(readFileSync("apps/web/dist/client/.vite/manifest.json", "utf8"));
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
if (!entry) throw new Error("Missing client entry in Vite manifest");
const initialFiles = new Set([entry.file]);
const pendingImports = [...(entry.imports ?? [])];
while (pendingImports.length > 0) {
  const key = pendingImports.pop();
  const chunk = manifest[key];
  if (!chunk || initialFiles.has(chunk.file)) continue;
  initialFiles.add(chunk.file);
  pendingImports.push(...(chunk.imports ?? []));
}
if ([...initialFiles].some((asset) => /monaco|graphology|cytoscape/i.test(asset))) {
  throw new Error("Initial shell unexpectedly includes an editor/graph renderer bundle");
}
console.log(
  "Verified light/dark semantic contrast, focus/reduced motion, and split heavy-route boundaries.",
);
