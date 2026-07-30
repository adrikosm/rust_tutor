#!/usr/bin/env node

import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["dev:service"], { stdio: "inherit" }),
  spawn("pnpm", ["dev:web"], { stdio: "inherit" }),
];
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(`Unable to start development process: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`Development process exited (${signal ?? code}).`);
      process.exitCode = code ?? 1;
    }
    stop();
  });
}

await Promise.all(children.map((child) => new Promise((resolve) => child.once("close", resolve))));
