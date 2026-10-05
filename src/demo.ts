import { runCli } from "./adapters/cli.js";
import { handleHttp } from "./adapters/http-stub.js";
import { isDirectRun } from "./root.js";
import { runAgent, type BriefResponse } from "./runner.js";

const CASES = [
  { company: "Northline Freight", status: "ok" },
  { company: "Helio", status: "ok" },
  { company: "Paperlane Health", status: "ok" },
  { company: "Unknown Widgets Inc", status: "not_found" },
  { company: "   ", status: "invalid_input" }
] as const;

export async function runDemo(): Promise<number> {
  let failed = 0;
  console.log("PassportKit demo — brief-a-company");
  console.log("Facts come from fixtures/ only. No network and no model call.\n");

  for (const testCase of CASES) {
    const result = await runAgent({
      agentId: "brief-a-company",
      input: { company: testCase.company }
    });
    printCard(result);
    if (result.status !== testCase.status) {
      failed += 1;
      console.log(`  expected status ${testCase.status}\n`);
    }
  }

  const core = await runAgent({
    agentId: "brief-a-company",
    input: { company: "Northline Freight" }
  });
  const cli = await runCli(["brief", "Northline Freight"]);
  const http = await handleHttp({
    method: "POST",
    url: "/v1/agents/brief-a-company/runs",
    bodyText: JSON.stringify({ company: "Northline Freight" })
  });
  const cliMatch = cli.exitCode === 0 && cli.stdout.trim().length > 0 && JSON.stringify(JSON.parse(cli.stdout)) === JSON.stringify(core);
  const httpMatch = http.status === 200 && JSON.stringify(http.body) === JSON.stringify(core);

  console.log("Adapter parity for Northline Freight");
  console.log(`  cli == core       ${cliMatch ? "yes" : "no"}`);
  console.log(`  http-stub == core ${httpMatch ? "yes" : "no"}`);
  if (!cliMatch || !httpMatch) failed += 1;

  console.log(failed === 0
    ? "\nDemo completed within the local contract."
    : "\nDemo found a contract mismatch.");
  return failed === 0 ? 0 : 1;
}

function printCard(result: BriefResponse): void {
  const label = result.input.company.trim() || "(empty)";
  console.log(`── ${label}`);
  console.log(`   status: ${result.status}  run: ${result.runId}`);
  console.log(`   ${result.message}`);
  if (result.brief) {
    console.log(`   ${result.brief.name} — ${result.brief.sector}`);
    console.log(`   HQ: ${result.brief.headquarters}  founded ${result.brief.founded}`);
    console.log(`   ${result.brief.summary}`);
    for (const fact of result.brief.facts) {
      console.log(`   • ${fact.label}: ${fact.value}`);
    }
    console.log(`   sources: ${result.brief.sources.join(", ")}`);
  }
  if (result.trace.length > 0) {
    console.log(`   tools: ${result.trace.map((step) => step.tool).join(" -> ")}`);
  }
  console.log("");
}

if (isDirectRun(import.meta.url)) {
  runDemo()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}