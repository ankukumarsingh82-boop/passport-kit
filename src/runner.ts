import { createHash } from "node:crypto";
import type { AgentDefinition } from "./load.js";
import { loadAgentDefinition, loadSchema } from "./load.js";
import { projectRoot } from "./root.js";
import { resolveCompany, slugify, type CompanyRef } from "./resolve.js";
import { validateSchema } from "./schema.js";
import type { FetchResult } from "./tools/mock-web-fetch.js";
import type { NotesResult } from "./tools/notes-store.js";
import { createToolRegistry } from "./tools/registry.js";
import type { Tool, ToolContext } from "./tools/types.js";

export interface AgentRunRequest {
  agentId: string;
  input: { company: string };
  root?: string;
}

export interface BriefFact {
  label: string;
  value: string;
}

export interface CompanyBrief {
  name: string;
  slug: string;
  sector: string;
  headquarters: string;
  founded: number;
  summary: string;
  products: string[];
  facts: BriefFact[];
  sources: string[];
  fictional: true;
}

export interface TraceStep {
  step: number;
  tool: string;
  ok: boolean;
  detail: string;
}

export type BriefStatus =
  | "ok"
  | "not_found"
  | "invalid_input"
  | "incomplete_fixture"
  | "invalid_fixture"
  | "fixture_mismatch";

export interface BriefResponse {
  spec: "passportkit.result/v1";
  status: BriefStatus;
  agentId: "brief-a-company";
  runId: string;
  input: { company: string };
  message: string;
  resolvedSlug: string | null;
  brief: CompanyBrief | null;
  notes: Array<{ key: string; text: string }>;
  trace: TraceStep[];
}

interface CompanyFixture {
  slug: string;
  name: string;
  aliases: string[];
  founded: number;
  headquarters: { city: string; country: string };
  sector: string;
  summary: string;
  products: string[];
  facts: BriefFact[];
  fictional: true;
}

export function createRunId(agentId: string, company: string): string {
  const digest = createHash("sha256").update(`${agentId}\n${company}`).digest("hex").slice(0, 16);
  return `run_${digest}`;
}

export function missingFixtureSnippets(page: string, fixture: CompanyFixture): string[] {
  const required = [
    fixture.name,
    fixture.sector,
    fixture.headquarters.city,
    fixture.headquarters.country,
    String(fixture.founded),
    fixture.summary,
    ...fixture.products,
    ...fixture.facts.flatMap((fact) => [fact.label, fact.value])
  ];
  return required.filter((snippet) => !page.includes(snippet));
}

export async function runAgent(request: AgentRunRequest): Promise<BriefResponse> {
  const root = request.root ?? projectRoot();
  const definition = loadAgentDefinition(root, request.agentId);
  if (definition.id !== "brief-a-company") {
    throw new Error(`Agent ${definition.id} has a contract but no runner plan.`);
  }
  return runBrief(root, definition, request.input.company);
}

async function runBrief(root: string, definition: AgentDefinition, company: string): Promise<BriefResponse> {
  const trimmed = typeof company === "string" ? company.trim().slice(0, 4000) : "";
  const runId = createRunId(definition.id, typeof company === "string" ? company.trim() : "");
  const trace: TraceStep[] = [];
  const notes = new Map<string, string>();
  const context: ToolContext = { root, agentId: definition.id, runId, notes };
  const registry = createToolRegistry();

  const finish = (response: BriefResponse): BriefResponse => {
    const outputSchema = loadSchema(root, definition.io.output);
    const errors = validateSchema(outputSchema, response);
    if (errors.length > 0) {
      throw new Error(`Runner result failed the output contract: ${errors.join("; ")}`);
    }
    return response;
  };

  const base = {
    spec: "passportkit.result/v1" as const,
    agentId: "brief-a-company" as const,
    runId,
    input: { company: trimmed }
  };

  if (typeof company !== "string") {
    return finish({
      ...base,
      status: "invalid_input",
      message: definition.behavior.onInvalidInput,
      resolvedSlug: null,
      brief: null,
      notes: [],
      trace
    });
  }

  const inputSchema = loadSchema(root, definition.io.input);
  const inputErrors = validateSchema(inputSchema, { company: company.trim() });
  if (inputErrors.length > 0) {
    return finish({
      ...base,
      status: "invalid_input",
      message: definition.behavior.onInvalidInput,
      resolvedSlug: null,
      brief: null,
      notes: [],
      trace
    });
  }

  const normalized = company.trim();
  const indexResult = asFetch(await callTool(definition, registry, context, trace, "mock-web-fetch", {
    url: "fixture://companies/index"
  }));
  if (!indexResult?.ok || !indexResult.body) {
    const status = indexResult?.error?.code === "invalid_fixture" ? "invalid_fixture" : "incomplete_fixture";
    return finish({
      ...base,
      status,
      message: indexResult?.error?.message ?? "The local company index could not be read.",
      resolvedSlug: null,
      brief: null,
      notes: [],
      trace
    });
  }

  let companies: CompanyRef[];
  try {
    companies = parseIndex(indexResult.body);
  } catch {
    return finish({
      ...base,
      status: "invalid_fixture",
      message: "The local company index could not be read.",
      resolvedSlug: null,
      brief: null,
      notes: [],
      trace
    });
  }

  const match = resolveCompany(companies, normalized);
  if (!match) {
    const guess = slugify(normalized);
    await callTool(definition, registry, context, trace, "mock-web-fetch", {
      url: `fixture://companies/${guess}`
    });
    await callTool(definition, registry, context, trace, "mock-web-fetch", {
      url: `fixture://pages/${guess}`
    });
    return finish({
      ...base,
      status: "not_found",
      message: definition.behavior.onUnknown,
      resolvedSlug: null,
      brief: null,
      notes: [],
      trace
    });
  }

  const record = asFetch(await callTool(definition, registry, context, trace, "mock-web-fetch", {
    url: `fixture://companies/${match.slug}`
  }));
  const page = asFetch(await callTool(definition, registry, context, trace, "mock-web-fetch", {
    url: `fixture://pages/${match.slug}`
  }));

  if (!record?.ok || !record.body || !page?.ok || !page.body) {
    return finish({
      ...base,
      status: "incomplete_fixture",
      message: `The local fixture set is incomplete for ${match.slug}.`,
      resolvedSlug: match.slug,
      brief: null,
      notes: [],
      trace
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(record.body) as unknown;
  } catch {
    return finish({
      ...base,
      status: "invalid_fixture",
      message: "The company fixture is not valid JSON.",
      resolvedSlug: match.slug,
      brief: null,
      notes: [],
      trace
    });
  }

  const companySchema = loadSchema(root, "contracts/company-fixture.schema.json");
  const fixtureErrors = validateSchema(companySchema, parsed);
  if (fixtureErrors.length > 0) {
    return finish({
      ...base,
      status: "invalid_fixture",
      message: `Company fixture failed schema validation: ${fixtureErrors[0]}`,
      resolvedSlug: match.slug,
      brief: null,
      notes: [],
      trace
    });
  }

  const fixture = parsed as CompanyFixture;
  const missing = missingFixtureSnippets(page.body, fixture);
  const firstMissing = missing[0];
  if (firstMissing) {
    const snippet = firstMissing.length > 80 ? `${firstMissing.slice(0, 77)}...` : firstMissing;
    return finish({
      ...base,
      status: "fixture_mismatch",
      message: `Companion page is missing "${snippet}".`,
      resolvedSlug: match.slug,
      brief: null,
      notes: [],
      trace
    });
  }

  const brief: CompanyBrief = {
    name: fixture.name,
    slug: fixture.slug,
    sector: fixture.sector,
    headquarters: `${fixture.headquarters.city}, ${fixture.headquarters.country}`,
    founded: fixture.founded,
    summary: fixture.summary,
    products: [...fixture.products],
    facts: fixture.facts.map((fact) => ({ label: fact.label, value: fact.value })),
    sources: [`fixture://companies/${fixture.slug}`, `fixture://pages/${fixture.slug}`],
    fictional: true
  };

  const noteKey = `brief:${fixture.slug}`;
  const noteText = `Recorded a local-fixture brief for ${fixture.name}.`;
  const written = asNotes(await callTool(definition, registry, context, trace, "notes-store", {
    op: "put",
    key: noteKey,
    text: noteText
  }));
  if (!written?.ok) {
    throw new Error("notes-store rejected the brief note.");
  }
  const listed = asNotes(await callTool(definition, registry, context, trace, "notes-store", { op: "list" }));
  if (!listed?.ok) {
    throw new Error("notes-store list failed after put.");
  }

  return finish({
    ...base,
    status: "ok",
    message: `Brief assembled from local fixtures for ${fixture.name}.`,
    resolvedSlug: fixture.slug,
    brief,
    notes: listed.notes,
    trace
  });
}

async function callTool(
  definition: AgentDefinition,
  registry: Map<string, Tool>,
  context: ToolContext,
  trace: TraceStep[],
  name: string,
  input: unknown
): Promise<unknown> {
  if (!definition.tools.includes(name)) {
    throw new Error(`Tool ${name} is not declared on agent ${definition.id}.`);
  }
  const tool = registry.get(name);
  if (!tool) {
    throw new Error(`Tool ${name} has no implementation.`);
  }
  const output = await tool.execute(input, context);
  trace.push({
    step: trace.length + 1,
    tool: name,
    ok: isOk(output),
    detail: traceDetail(name, input, output)
  });
  return output;
}

function traceDetail(name: string, input: unknown, output: unknown): string {
  if (name === "mock-web-fetch") {
    const url = output && typeof output === "object" && "url" in output && typeof output.url === "string"
      ? output.url
      : "fixture";
    const error = output && typeof output === "object" && "error" in output ? output.error : null;
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
    return code ? `${url} ${code}` : url || "fixture";
  }
  if (input && typeof input === "object" && "op" in input && typeof input.op === "string") {
    const key = "key" in input && typeof input.key === "string" ? ` ${input.key}` : "";
    return `${input.op}${key}`;
  }
  return name;
}

function isOk(output: unknown): boolean {
  return !!output && typeof output === "object" && "ok" in output && output.ok === true;
}

function asFetch(value: unknown): FetchResult | null {
  if (!value || typeof value !== "object") return null;
  if (!("ok" in value) || typeof value.ok !== "boolean") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("body" in value) || (value.body !== null && typeof value.body !== "string")) return null;
  if (!("error" in value)) return null;
  return value as FetchResult;
}

function asNotes(value: unknown): NotesResult | null {
  if (!value || typeof value !== "object") return null;
  if (!("ok" in value) || typeof value.ok !== "boolean") return null;
  if (!("notes" in value) || !Array.isArray(value.notes)) return null;
  return value as NotesResult;
}

function parseIndex(body: string): CompanyRef[] {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || !("companies" in parsed) || !Array.isArray(parsed.companies)) {
    throw new Error("Fixture index is malformed.");
  }
  return parsed.companies.map((entry) => {
    if (!isRecord(entry)) throw new Error("Fixture index entry is malformed.");
    if (typeof entry.slug !== "string") throw new Error("Fixture index entry is missing slug.");
    if (typeof entry.name !== "string") throw new Error("Fixture index entry is missing name.");
    if (!isStringArray(entry.aliases)) throw new Error("Fixture index entry is missing aliases.");
    return { slug: entry.slug, name: entry.name, aliases: entry.aliases };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
