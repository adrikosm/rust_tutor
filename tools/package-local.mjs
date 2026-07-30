import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const platform = `${process.platform}-${process.arch}`;
if (!["darwin-arm64", "linux-x64"].includes(platform)) {
  throw new Error(`Unsupported beta package target: ${platform}`);
}

async function run(program, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: "inherit" });
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
await writeFile(
  path.join(output, "run.sh"),
  '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport RUST_TUTOR_WEB_DIST="$HERE/web"\nexport RUST_TUTOR_BIND=127.0.0.1:4317\nexport RUST_TUTOR_ALLOWED_ORIGIN=http://127.0.0.1:4317\nexec "$HERE/rust-tutor-service"\n',
  { mode: 0o755 },
);
console.log(output);
