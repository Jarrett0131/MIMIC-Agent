#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const buildCommand = "npm";
const distEvalEntry = path.join(
  repoRoot,
  "agent-server",
  "dist",
  "evaluation",
  "runPhase3Eval.js",
);
const distCompareEntry = path.join(
  repoRoot,
  "agent-server",
  "dist",
  "evaluation",
  "llmCompare.js",
);

function runCommand(command, args, envOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...envOverrides,
    },
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

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) {
    return fallback;
  }

  return process.argv[index + 1];
}

const mode = readArg("--mode", "offline");
const agentServerUrl = readArg("--agent-server-url", "http://127.0.0.1:3001");
const quiet = process.argv.includes("--quiet");

const llmOnJson = path.join(repoRoot, "evaluation", "reports", "llm_on_eval_report.json");
const llmOnMd = path.join(repoRoot, "evaluation", "reports", "llm_on_eval_report.md");
const llmOffJson = path.join(repoRoot, "evaluation", "reports", "llm_off_eval_report.json");
const llmOffMd = path.join(repoRoot, "evaluation", "reports", "llm_off_eval_report.md");
const compareMd = path.join(repoRoot, "evaluation", "reports", "llm_compare_report.md");

runCommand(buildCommand, ["--prefix", "agent-server", "run", "build"]);

const evalArgsBase = [
  distEvalEntry,
  "--mode",
  mode,
  "--agent-server-url",
  agentServerUrl,
];

if (quiet) {
  evalArgsBase.push("--quiet");
}

runCommand(
  "node",
  [...evalArgsBase, "--report", llmOffJson, "--markdown", llmOffMd],
  {
    LLM_ENABLED: "false",
    QUERY_REWRITE_ENABLED: process.env.QUERY_REWRITE_ENABLED ?? "true",
    ANSWER_ENHANCEMENT_ENABLED: process.env.ANSWER_ENHANCEMENT_ENABLED ?? "true",
  },
);

runCommand(
  "node",
  [...evalArgsBase, "--report", llmOnJson, "--markdown", llmOnMd],
  {
    LLM_ENABLED: process.env.LLM_ENABLED ?? "true",
    QUERY_REWRITE_ENABLED: process.env.QUERY_REWRITE_ENABLED ?? "true",
    ANSWER_ENHANCEMENT_ENABLED: process.env.ANSWER_ENHANCEMENT_ENABLED ?? "true",
  },
);

runCommand("node", [
  distCompareEntry,
  "--llm-on-report",
  llmOnJson,
  "--llm-off-report",
  llmOffJson,
  "--output",
  compareMd,
]);
