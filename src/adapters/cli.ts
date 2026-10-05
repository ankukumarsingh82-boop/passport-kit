#!/usr/bin/env node
import { runAgent } from "../runner.js";
import { isDirectRun, projectRoot } from "../root.js";

const HELP = `PassportKit

Usage:
  passportkit brief <company name>
  passportkit brief --company <company name>
  passportkit help

The brief uses local fixtures only. A resolved company and an unknown
company both exit 0. Invalid input exits 2.

Examples:
  passportkit brief "Northline Freight"
  passportkit brief Helio
  passportkit brief --company "Paperlane Health"`;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], root?: string): Promise<CliResult> {
  const command = argv[0];
  if (argv.length === 0 || command === "help" || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: `${HELP}\n`, stderr: "" };
  }
  if (command !== "brief") {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Unknown command "${command ?? ""}".\n\n${HELP}\n`
    };
  }

  const company = companyFromArgs(argv.slice(1));
  if (company === undefined) {
    return { exitCode: 2, stdout: "", stderr: `Missing company name.\n\n${HELP}\n` };
  }

  try {
    const result = await runAgent({
      agentId: "brief-a-company",
      input: { company },
      root: root ?? projectRoot()
    });
    const exitCode = result.status === "invalid_input" ? 2 : result.status === "ok" || result.status === "not_found" ? 0 : 1;
    return { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner failed.";
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

function companyFromArgs(args: string[]): string | undefined {
  const flag = args.indexOf("--company");
  if (flag !== -1) return args[flag + 1];
  if (args.length === 0) return undefined;
  return args.join(" ");
}

if (isDirectRun(import.meta.url)) {
  runCli(process.argv.slice(2))
    .then((result) => {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exit(result.exitCode);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Runner failed."}\n`);
      process.exit(1);
    });
}