import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../src/adapters/cli.js";
import { handleHttp, startHttpServer } from "../src/adapters/http-stub.js";
import { loadAgentDefinition, loadSchema, readJson } from "../src/load.js";
import { projectRoot } from "../src/root.js";
import { createRunId, runAgent } from "../src/runner.js";
import { validateSchema } from "../src/schema.js";
import { readFixtureUrl } from "../src/tools/mock-web-fetch.js";
import { notesStoreTool } from "../src/tools/notes-store.js";
import type { ToolContext } from "../src/tools/types.js";

const root = projectRoot();

describe("contracts and fixtures", () => {
  it("loads every JSON schema in contracts/", () => {
    const files = readdirSync(path.join(root, "contracts")).filter((name) => name.endsWith(".schema.json"));
    assert.ok(files.length >= 4);
    for (const name of files) {
      const schema = loadSchema(root, path.join("contracts", name));
      assert.equal(typeof schema.title, "string");
      assert.ok(schema.title && schema.title.length > 0);
      assert.ok(schema.type !== undefined);
    }
  });

  it("accepts the brief-a-company definition and rejects an extra field", () => {
    const definition = loadAgentDefinition(root, "brief-a-company");
    assert.equal(definition.id, "brief-a-company");
    assert.deepEqual(definition.tools, ["mock-web-fetch", "notes-store"]);
    const schema = loadSchema(root, "contracts/agent-identity.schema.json");
    const broken = { ...readJson(path.join(root, "agents/brief-a-company/agent.json")) as object, extra: true };
    const errors = validateSchema(schema, broken);
    assert.ok(errors.some((error) => error.includes("extra")));
  });

  it("validates each company fixture and its companion page", () => {
    const schema = loadSchema(root, "contracts/company-fixture.schema.json");
    const files = readdirSync(path.join(root, "fixtures/companies")).filter((name) => name.endsWith(".json")).sort();
    assert.deepEqual(files, ["helio-meter.json", "northline-freight.json", "paperlane-health.json"]);
    for (const name of files) {
      const fixture = readJson(path.join(root, "fixtures/companies", name));
      const errors = validateSchema(schema, fixture);
      assert.deepEqual(errors, [], name);
      const slug = name.replace(/\.json$/, "");
      const page = readFileSync(path.join(root, "fixtures/pages", `${slug}.md`), "utf8");
      assert.ok(page.length > 0);
      const text = `${JSON.stringify(fixture)}\n${page}`;
      assert.equal(/https?:\/\//.test(text), false, name);
    }
  });

  it("checks the runtime export manifest and the files it names", () => {
    const manifest = readJson(path.join(root, "contracts/runtime-export.json"));
    const errors = validateSchema(loadSchema(root, "contracts/runtime-export.schema.json"), manifest);
    assert.deepEqual(errors, []);
    assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest));
    const record = manifest as {
      definition: string;
      coreRunner: string;
      toolInterface: string;
      tools: Array<{ module: string }>;
      adapters: Array<{ id: string; module: string }>;
      limits: string[];
    };
    for (const relativePath of [
      record.definition,
      record.coreRunner,
      record.toolInterface,
      ...record.tools.map((tool) => tool.module),
      ...record.adapters.map((adapter) => adapter.module)
    ]) {
      readFileSync(path.join(root, relativePath));
    }
    assert.deepEqual(record.adapters.map((adapter) => adapter.id), ["cli", "http-stub"]);
    assert.match(record.limits.join(" "), /HiDevs verification gate was executed/);
  });
});

describe("tools", () => {
  it("returns fixture bodies and refuses live URLs", () => {
    const helio = readFixtureUrl("fixture://companies/helio-meter", root);
    assert.equal(helio.ok, true);
    assert.match(helio.body ?? "", /Helio Meter/);

    const blocked = readFixtureUrl("https://example.com/companies/helio-meter", root);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error?.code, "live_network_disabled");
    assert.equal(blocked.body, null);

    const escaped = readFixtureUrl("fixture://companies/../../package.json", root);
    assert.equal(escaped.ok, false);
    assert.equal(escaped.error?.code, "invalid_url");
  });

  it("stores notes only in the run map", async () => {
    const context: ToolContext = {
      root,
      agentId: "brief-a-company",
      runId: "run_test",
      notes: new Map()
    };
    const written = await notesStoreTool.execute(
      { op: "put", key: "brief:helio-meter", text: "Recorded a local-fixture brief for Helio Meter." },
      context
    );
    const listed = await notesStoreTool.execute({ op: "list" }, context);
    assert.equal(isOk(written), true);
    assert.equal(isOk(listed), true);
    assert.deepEqual(context.notes.get("brief:helio-meter"), "Recorded a local-fixture brief for Helio Meter.");
    const source = readFileSync(path.join(root, "src/tools/notes-store.ts"), "utf8");
    assert.equal(source.includes("node:fs"), false);
  });
});

describe("brief-a-company", () => {
  it("returns the same structured facts for the same company", async () => {
    const first = await runAgent({ agentId: "brief-a-company", input: { company: "  Helio  " } });
    const second = await runAgent({ agentId: "brief-a-company", input: { company: "Helio" } });
    assert.equal(first.status, "ok");
    assert.deepEqual(first, second);
    assert.equal(first.runId, createRunId("brief-a-company", "Helio"));
    assert.equal(first.brief?.slug, "helio-meter");
    assert.equal(first.brief?.fictional, true);
    assert.deepEqual(first.brief?.sources, [
      "fixture://companies/helio-meter",
      "fixture://pages/helio-meter"
    ]);
    const fixture = readJson(path.join(root, "fixtures/companies/helio-meter.json")) as { facts: unknown };
    assert.deepEqual(first.brief?.facts, fixture.facts);
    assert.deepEqual(first.notes, [
      { key: "brief:helio-meter", text: "Recorded a local-fixture brief for Helio Meter." }
    ]);
    assert.deepEqual(first.trace.map((step) => `${step.tool}:${step.ok}`), [
      "mock-web-fetch:true",
      "mock-web-fetch:true",
      "mock-web-fetch:true",
      "notes-store:true",
      "notes-store:true"
    ]);
    const outputErrors = validateSchema(loadSchema(root, "contracts/brief-output.schema.json"), first);
    assert.deepEqual(outputErrors, []);
  });

  it("resolves official names, aliases, and slugs", async () => {
    const bySlug = await runAgent({ agentId: "brief-a-company", input: { company: "helio-meter" } });
    const byAlias = await runAgent({ agentId: "brief-a-company", input: { company: "Helio Meter Inc." } });
    const spaced = await runAgent({ agentId: "brief-a-company", input: { company: "Northline   Freight" } });
    assert.equal(bySlug.brief?.name, "Helio Meter");
    assert.equal(byAlias.brief?.name, "Helio Meter");
    assert.equal(spaced.brief?.slug, "northline-freight");
  });

  it("refuses unknown companies and invalid input without inventing facts", async () => {
    const definition = loadAgentDefinition(root, "brief-a-company");
    const missing = await runAgent({ agentId: "brief-a-company", input: { company: "Unknown Widgets Inc" } });
    assert.equal(missing.status, "not_found");
    assert.equal(missing.brief, null);
    assert.deepEqual(missing.notes, []);
    assert.equal(missing.message, definition.behavior.onUnknown);
    assert.ok(missing.trace.every((step) => step.tool === "mock-web-fetch"));
    assert.equal(missing.trace[0]?.ok, true);
    assert.ok(missing.trace.slice(1).every((step) => step.ok === false));

    const empty = await runAgent({ agentId: "brief-a-company", input: { company: "   " } });
    assert.equal(empty.status, "invalid_input");
    assert.equal(empty.message, definition.behavior.onInvalidInput);
    assert.deepEqual(empty.trace, []);
    assert.equal(empty.brief, null);

    const tooLong = await runAgent({ agentId: "brief-a-company", input: { company: "A".repeat(121) } });
    assert.equal(tooLong.status, "invalid_input");
    assert.deepEqual(tooLong.trace, []);
  });

  it("stops when a fixture is incomplete, invalid, or out of agreement", async () => {
    const missingPage = cloneWorkspace();
    rmSync(path.join(missingPage, "fixtures/pages/helio-meter.md"));
    const incomplete = await runAgent({
      agentId: "brief-a-company",
      input: { company: "Helio" },
      root: missingPage
    });
    assert.equal(incomplete.status, "incomplete_fixture");
    assert.deepEqual(incomplete.notes, []);

    const invalid = cloneWorkspace();
    const invalidFile = path.join(invalid, "fixtures/companies/helio-meter.json");
    const broken = readJson(invalidFile) as { sector?: string };
    delete broken.sector;
    writeFileSync(invalidFile, JSON.stringify(broken));
    const rejected = await runAgent({
      agentId: "brief-a-company",
      input: { company: "Helio" },
      root: invalid
    });
    assert.equal(rejected.status, "invalid_fixture");
    assert.equal(rejected.brief, null);
    assert.deepEqual(rejected.notes, []);

    const mismatch = cloneWorkspace();
    writeFileSync(path.join(mismatch, "fixtures/pages/helio-meter.md"), "Helio Meter page without the structured facts.\n");
    const disagreed = await runAgent({
      agentId: "brief-a-company",
      input: { company: "Helio" },
      root: mismatch
    });
    assert.equal(disagreed.status, "fixture_mismatch");
    assert.equal(disagreed.brief, null);

    rmSync(missingPage, { recursive: true, force: true });
    rmSync(invalid, { recursive: true, force: true });
    rmSync(mismatch, { recursive: true, force: true });
  });

  it("refuses a tool that the agent contract does not name", async () => {
    const tmp = cloneWorkspace();
    const file = path.join(tmp, "agents/brief-a-company/agent.json");
    const definition = readJson(file) as { tools: string[] };
    definition.tools = ["mock-web-fetch"];
    writeFileSync(file, JSON.stringify(definition));
    await assert.rejects(
      () => runAgent({ agentId: "brief-a-company", input: { company: "Helio" }, root: tmp }),
      /notes-store is not declared/
    );
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("adapters", () => {
  it("returns the core result from the CLI and the HTTP handler", async () => {
    const core = await runAgent({ agentId: "brief-a-company", input: { company: "Paperlane" } });
    const cli = await runCli(["brief", "--company", "Paperlane"]);
    assert.equal(cli.exitCode, 0);
    assert.deepEqual(JSON.parse(cli.stdout), core);

    const http = await handleHttp({
      method: "POST",
      url: "/v1/agents/brief-a-company/runs",
      bodyText: JSON.stringify({ company: "Paperlane", ignored: true })
    });
    assert.equal(http.status, 200);
    assert.deepEqual(http.body, core);

    const help = await runCli([]);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /passportkit brief/);

    const missing = await handleHttp({ method: "POST", url: "/v1/agents/brief-a-company/runs", bodyText: "{}" });
    assert.equal(missing.status, 400);
    const unknown = await handleHttp({ method: "GET", url: "/v1/agents/other-agent" });
    assert.equal(unknown.status, 404);
  });

  it("serves the health check and the same brief over HTTP", async () => {
    const server = await startHttpServer(0);
    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      assert.equal(health.status, 200);
      const healthBody = await health.json() as { adapter: string };
      assert.equal(healthBody.adapter, "http-stub");

      const response = await fetch(`http://127.0.0.1:${server.port}/v1/agents/brief-a-company/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company: "Northline" })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      const core = await runAgent({ agentId: "brief-a-company", input: { company: "Northline" } });
      assert.deepEqual(body, core);
    } finally {
      await server.close();
    }
  });

  it("invokes the built CLI process", () => {
    const cliPath = path.join(root, "dist/src/adapters/cli.js");
    const child = spawnSync(process.execPath, [cliPath, "brief", "Paperlane Health"], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const parsed = JSON.parse(child.stdout) as { status: string; brief: { slug: string } };
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.brief.slug, "paperlane-health");
  });

  it("keeps transport code out of the runner and tool names out of the adapters", () => {
    const runner = readFileSync(path.join(root, "src/runner.ts"), "utf8");
    assert.equal(runner.includes("node:http"), false);
    assert.equal(runner.includes("process.argv"), false);
    const fetchSource = readFileSync(path.join(root, "src/tools/mock-web-fetch.ts"), "utf8");
    assert.equal(fetchSource.includes("node:http"), false);
    assert.equal(fetchSource.includes("node:https"), false);
    assert.equal(fetchSource.includes("fetch("), false);
    for (const relativePath of ["src/adapters/cli.ts", "src/adapters/http-stub.ts"]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.equal(source.includes("mock-web-fetch"), false, relativePath);
      assert.equal(source.includes("notes-store"), false, relativePath);
    }
  });
});

describe("repository hygiene", () => {
  it("does not contain obvious secrets in project sources", () => {
    const secret = /sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      assert.equal(secret.test(text), false, file);
    }
  });
});

function cloneWorkspace(): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "passportkit-"));
  for (const folder of ["contracts", "agents", "fixtures"]) {
    cpSync(path.join(root, folder), path.join(tmp, folder), { recursive: true });
  }
  return tmp;
}

function sourceFiles(dir: string): string[] {
  const skip = new Set([".git", "node_modules", "dist", "agent-tools"]);
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(md|json|ts|yml|yaml)$/.test(entry.name) || entry.name === "LICENSE") {
      found.push(full);
    }
  }
  return found;
}

function isOk(value: unknown): boolean {
  return !!value && typeof value === "object" && "ok" in value && value.ok === true;
}