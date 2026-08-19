import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const platform = `${process.platform}-${process.arch}`;
const bundle = path.join(root, "dist", `rust-tutor-${platform}`);
const binary = path.join(bundle, "rust-tutor-service");
const web = path.join(bundle, "web");
const curriculumPath = path.join(bundle, "content", "curriculum-v2", "release.json");

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

const webFiles = await files(web);
for (const file of webFiles) {
  if (!/\.(?:html|css|js|json)$/.test(file)) continue;
  const body = await readFile(file, "utf8");
  const externalReference =
    (file.endsWith(".html") && /(?:src|href)\s*=\s*["']https?:\/\//i.test(body)) ||
    (file.endsWith(".css") && /url\(\s*["']?https?:\/\//i.test(body)) ||
    (file.endsWith(".js") && /(?:fetch|import)\(\s*["']https?:\/\//i.test(body));
  if (externalReference) throw new Error(`Runtime external asset request found in ${file}`);
}
const sourceImage = webFiles.find((file) => /\/trpl14-01-[^/]+\.png$/u.test(file));
if (!sourceImage) throw new Error("Packaged Rust Book image assets are missing");

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
    // Point at the bundle's own copy: inheriting the build-machine fallback
    // would hide a package that ships without its curriculum.
    RUST_TUTOR_CURRICULUM_V2_PATH: curriculumPath,
    RUST_TUTOR_DATA_DIR: temporary,
    CARGO_HOME: path.join(bundle, "cargo-home"),
    CARGO_NET_OFFLINE: "true",
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
  const imagePath = path.relative(web, sourceImage).split(path.sep).join("/");
  const image = await fetch(`${origin}/${imagePath}`);
  if (!image.ok || image.headers.get("content-type") !== "image/png")
    throw new Error(`Packaged Rust Book image is unavailable (${image.status})`);
  const content = await fetch(`${origin}/api/v1/content/ownership`).then((response) =>
    response.json(),
  );
  const graph = await fetch(`${origin}/api/v1/graph?id=ERR-RUST-E0382-001&depth=1`).then(
    (response) => response.json(),
  );
  if (!content.lesson || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error("Packaged offline learning content or graph is unavailable");
  }

  // A healthy API is insufficient: prove a registry-dependent reference
  // solution compiles against only the crates shipped in this bundle.
  const curriculumBytes = await readFile(curriculumPath);
  const curriculum = JSON.parse(curriculumBytes.toString("utf8"));
  const dependencyExercise = curriculum.exercises.find(
    (exercise) => exercise.id === "mainmatter-05-ticket_v2-11-dependencies",
  );
  if (!dependencyExercise) throw new Error("Packaged dependency exercise is missing");
  const tokenResponse = await fetch(`${origin}/api/v1/session`, {
    headers: { origin },
  });
  const { token } = await tokenResponse.json();
  if (!tokenResponse.ok || typeof token !== "string")
    throw new Error("Packaged service did not issue a local session token");
  const evaluationResponse = await fetch(`${origin}/api/v1/evaluate`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-rust-tutor-session": token,
      "x-rust-tutor-mutation": "1",
    },
    body: JSON.stringify({
      runId: "RUN-OFFLINE-PACKAGE-DEPENDENCY-001",
      exerciseId: dependencyExercise.id,
      action: "test",
      files: Object.fromEntries(
        dependencyExercise.referenceSolution.files
          .filter((file) => dependencyExercise.evaluator.editableFiles.includes(file.path))
          .map((file) => [file.path, file.content]),
      ),
      contentHash: createHash("sha256").update(curriculumBytes).digest("hex"),
    }),
  });
  const evaluation = await evaluationResponse.json();
  if (!evaluationResponse.ok || evaluation.status !== "ACCEPTED")
    throw new Error(
      `Packaged offline dependency evaluation failed (${evaluationResponse.status}): ${JSON.stringify(evaluation)}\n${serviceOutput}`,
    );
  console.log(
    "Verified packaged SPA, Rust Book assets, API, lesson, graph, and registry-dependent evaluation with external proxies forced closed and Cargo using only the bundled vendor directory.",
  );
} finally {
  const exited =
    child.exitCode === null && child.signalCode === null
      ? new Promise((resolve) => child.once("exit", resolve))
      : Promise.resolve();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exited;
  await rm(temporary, { recursive: true, force: true });
}
