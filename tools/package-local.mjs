import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const platform = `${process.platform}-${process.arch}`;
if (!["darwin-arm64", "linux-x64"].includes(platform)) {
  throw new Error(`Unsupported beta package target: ${platform}`);
}

async function run(program, args, cwd = root) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)),
    );
  });
}

await run("pnpm", ["--filter", "@rust-tutor/web", "build"]);
await run("cargo", ["build", "--release", "--workspace"]);

const output = path.join(root, "dist", `rust-tutor-${platform}`);
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "web"), { recursive: true });
await cp(
  path.join(root, "target", "release", "rust-tutor-service"),
  path.join(output, "rust-tutor-service"),
);
await cp(path.join(root, "apps", "web", "dist", "client"), path.join(output, "web"), {
  recursive: true,
});
await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await cp(
  path.join(root, "content", "generated", "release-manifest.v1.json"),
  path.join(output, "release-manifest.json"),
);

// The curriculum is read at runtime, not compiled in. Without a packaged copy
// and an explicit path the binary falls back to its build-machine path, so the
// bundle only works on the machine that produced it.
const curriculum = path.join("content", "curriculum-v2", "release.json");
await mkdir(path.join(output, "content", "curriculum-v2"), { recursive: true });
await cp(path.join(root, curriculum), path.join(output, curriculum));

// Evaluations run with Cargo's network disabled. Ship the complete registry
// closure used by the imported exercises, including both thiserror majors
// present across the pinned starter and reviewed solution snapshots.
const vendorWorkspace = await mkdtemp(path.join(os.tmpdir(), "rust-tutor-vendor-"));
try {
  const mainmatter = JSON.parse(
    await readFile(path.join(root, "content", "curriculum-v2", "mainmatter.json"), "utf8"),
  );
  const upstreamLock = mainmatter.sharedWorkspaceFiles.find(
    (file) => file.path === "Cargo.lock",
  )?.content;
  if (!upstreamLock) throw new Error("Pinned Mainmatter Cargo.lock is missing");
  const lockedRegistryCrates = [
    ...upstreamLock.matchAll(
      /\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry\+[^\n]+"/gu,
    ),
  ].map((match, index) => ({ alias: `pinned_${index + 1}`, name: match[1], version: match[2] }));
  if (lockedRegistryCrates.length < 20)
    throw new Error("Pinned Mainmatter registry closure is unexpectedly small");
  const dependencyLines = lockedRegistryCrates
    .map(
      ({ alias, name, version }) =>
        `${alias} = { package = ${JSON.stringify(name)}, version = ${JSON.stringify(`=${version}`)} }`,
    )
    .join("\n");
  await writeFile(
    path.join(vendorWorkspace, "Cargo.toml"),
    `[package]
name = "rust-tutor-offline-crates"
version = "0.0.0"
edition = "2024"
publish = false

[lib]
path = "src.rs"

[dependencies]
${dependencyLines}
solution_thiserror_2 = { package = "thiserror", version = "=2.0.18" }
`,
  );
  await writeFile(path.join(vendorWorkspace, "src.rs"), "// dependency closure only\n");
  await run("cargo", ["generate-lockfile", "--manifest-path", "Cargo.toml"], vendorWorkspace);
  await run(
    "cargo",
    [
      "vendor",
      "--locked",
      "--versioned-dirs",
      "--manifest-path",
      "Cargo.toml",
      path.join(output, "vendor"),
    ],
    vendorWorkspace,
  );
} finally {
  await rm(vendorWorkspace, { recursive: true, force: true });
}
await mkdir(path.join(output, "cargo-home"), { recursive: true });
await writeFile(
  path.join(output, "cargo-home", "config.toml"),
  `[net]
offline = true

[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
`,
);

// Third-party attribution travels with the bundle, generated from the same
// pinned source records the About surface reads.
const release = JSON.parse(await readFile(path.join(root, curriculum), "utf8"));
await writeFile(
  path.join(output, "THIRD-PARTY-NOTICES.md"),
  [
    "# Third-party content in this build",
    "",
    "Rust Tutor's own code and curriculum are MIT licensed (see `LICENSE`).",
    "This build also bundles the material below. Because it includes",
    "CC BY-NC 4.0 material, **the bundled curriculum may not be used",
    "commercially.**",
    "",
    ...release.sources.flatMap((source) => [
      `## ${source.title}`,
      "",
      `- Publisher: ${source.publisher}`,
      `- License: ${source.license}`,
      `- Use: ${source.use}`,
      `- Source: ${source.canonicalUrl}`,
      ...(source.sourceCommit ? [`- Pinned commit: ${source.sourceCommit}`] : []),
      `- Attribution: ${source.attribution}`,
      "",
    ]),
  ].join("\n"),
);

await writeFile(
  path.join(output, "run.sh"),
  '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport CARGO_HOME="$HERE/cargo-home"\nexport CARGO_NET_OFFLINE=true\nexport RUST_TUTOR_WEB_DIST="$HERE/web"\nexport RUST_TUTOR_CURRICULUM_V2_PATH="$HERE/content/curriculum-v2/release.json"\nexport RUST_TUTOR_BIND=127.0.0.1:4317\nexport RUST_TUTOR_ALLOWED_ORIGIN=http://127.0.0.1:4317\nexec "$HERE/rust-tutor-service"\n',
  { mode: 0o755 },
);
console.log(output);
