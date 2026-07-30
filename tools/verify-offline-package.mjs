import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const platform = `${process.platform}-${process.arch}`;
const bundle = path.join(root, "dist", `rust-tutor-${platform}`);
const binary = path.join(bundle, "rust-tutor-service");
const web = path.join(bundle, "web");

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? files(target) : [target];
    }),
  );
  return nested.flat();
}

for (const file of await files(web)) {
  if (!/\.(?:html|css|js|json)$/.test(file)) continue;
  const body = await readFile(file, "utf8");
  const externalReference =
    (file.endsWith(".html") && /(?:src|href)\s*=\s*["']https?:\/\//i.test(body)) ||
    (file.endsWith(".css") && /url\(\s*["']?https?:\/\//i.test(body)) ||
    (file.endsWith(".js") && /(?:fetch|import)\(\s*["']https?:\/\//i.test(body));
  if (externalReference) throw new Error(`Runtime external asset request found in ${file}`);
}

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const temporary = await mkdtemp(path.join(os.tmpdir(), "rust-tutor-offline-package-"));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(binary, [], {
  cwd: bundle,
  env: {
    ...process.env,
    RUST_TUTOR_BIND: `127.0.0.1:${port}`,
    RUST_TUTOR_ALLOWED_ORIGIN: origin,
    RUST_TUTOR_WEB_DIST: web,
    RUST_TUTOR_DATA_DIR: temporary,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serviceOutput = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serviceOutput = `${serviceOutput}${chunk}`.slice(-4_000);
  });
}
try {
  let health;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      health = await fetch(`${origin}/api/v1/health`).then((response) => response.json());
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (health?.status !== "healthy")
    throw new Error(`Packaged service did not become healthy\n${serviceOutput}`);
  const shell = await fetch(origin);
  const html = await shell.text();
  if (!shell.ok || !html.includes("Rust Tutor"))
    throw new Error(
      `Packaged SPA shell is unavailable (${shell.status}); body=${JSON.stringify(html.slice(0, 240))}\n${serviceOutput}`,
    );
  const content = await fetch(`${origin}/api/v1/content/ownership`).then((response) =>
    response.json(),
  );
  const graph = await fetch(`${origin}/api/v1/graph?id=ERR-RUST-E0382-001&depth=1`).then(
    (response) => response.json(),
  );
  if (!content.lesson || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error("Packaged offline learning content or graph is unavailable");
  }
  console.log(
    "Verified packaged SPA, API, lesson, and graph with external proxies forced to a closed loopback port and no runtime external asset URLs.",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(temporary, { recursive: true, force: true });
}
