#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const buildScript = "npm";
function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runCommand(buildScript, ["--prefix", "agent-server", "run", "build"]);

const distEntry = path.join(
  repoRoot,
  "agent-server",
  "dist",
  "evaluation",
  "runPhase3Eval.js",
);

const { main } = require(distEntry);

main(process.argv.slice(2)).catch((error) => {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Phase 3 evaluation failed.";
  console.error(message);
  process.exit(1);
});
