import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readJson } from "../load.js";
import type { Tool, ToolContext } from "./types.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface FetchResult {
  ok: boolean;
  url: string;
  mediaType: "application/json" | "text/markdown" | null;
  body: string | null;
  error: { code: "live_network_disabled" | "invalid_url" | "not_found" | "invalid_fixture"; message: string } | null;
}

export const mockWebFetchTool: Tool = {
  name: "mock-web-fetch",
  description: "Return packaged fixture bodies for fixture:// URLs. Live network URLs are refused.",
  async execute(input: unknown, context: ToolContext): Promise<FetchResult> {
    const url = readUrl(input);
    if (url === null) {
      return failure("", "invalid_url", "mock-web-fetch requires an input object with a string url.");
    }
    return readFixtureUrl(url, context.root);
  }
};

export function readFixtureUrl(url: string, root: string): FetchResult {
  const parsed = parseFixtureUrl(url);
  if (parsed.kind === "reject") {
    return failure(url, parsed.code, parsed.message);
  }

  if (parsed.kind === "index") {
    try {
      const body = JSON.stringify({ companies: listCompanies(root) });
      return { ok: true, url, mediaType: "application/json", body, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the company index.";
      return failure(url, "invalid_fixture", message);
    }
  }

  const relative = parsed.kind === "company"
    ? path.join("companies", `${parsed.slug}.json`)
    : path.join("pages", `${parsed.slug}.md`);
  const file = containedFixturePath(root, relative);
  if (!file) {
    return failure(url, "invalid_url", "Fixture path escaped the fixtures directory.");
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return failure(url, "not_found", `No local fixture for ${url}.`);
  }

  return {
    ok: true,
    url,
    mediaType: parsed.kind === "company" ? "application/json" : "text/markdown",
    body: text,
    error: null
  };
}

function listCompanies(root: string): Array<{ slug: string; name: string; aliases: string[] }> {
  const dir = path.join(root, "fixtures", "companies");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => {
    const parsed = readJson(path.join(dir, name));
    if (!isRecord(parsed)) {
      throw new Error(`${name} is not a company object`);
    }
    const slug = parsed.slug;
    const companyName = parsed.name;
    const aliases = parsed.aliases;
    if (typeof slug !== "string" || typeof companyName !== "string" || !isStringArray(aliases)) {
      throw new Error(`${name} is missing slug, name, or aliases`);
    }
    return { slug, name: companyName, aliases };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function containedFixturePath(root: string, relativePath: string): string | null {
  const base = path.resolve(root, "fixtures");
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

type ParsedUrl =
  | { kind: "index" }
  | { kind: "company" | "page"; slug: string }
  | { kind: "reject"; code: "live_network_disabled" | "invalid_url"; message: string };

function parseFixtureUrl(url: string): ParsedUrl {
  if (!url.startsWith("fixture://")) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return {
        kind: "reject",
        code: "live_network_disabled",
        message: "mock-web-fetch refuses non-fixture URLs. No network request was made."
      };
    }
    return { kind: "reject", code: "invalid_url", message: "URL must start with fixture://." };
  }

  const rest = url.slice("fixture://".length);
  if (rest === "companies/index") return { kind: "index" };

  const company = /^companies\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(rest);
  const companySlug = company?.[1];
  if (companySlug && SLUG.test(companySlug)) return { kind: "company", slug: companySlug };

  const page = /^pages\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(rest);
  const pageSlug = page?.[1];
  if (pageSlug && SLUG.test(pageSlug)) return { kind: "page", slug: pageSlug };

  return {
    kind: "reject",
    code: "invalid_url",
    message: "Allowed URLs are fixture://companies/index, fixture://companies/{slug}, and fixture://pages/{slug}."
  };
}

function readUrl(input: unknown): string | null {
  if (!input || typeof input !== "object" || !("url" in input)) return null;
  return typeof input.url === "string" ? input.url : null;
}

function failure(url: string, code: NonNullable<FetchResult["error"]>["code"], message: string): FetchResult {
  return { ok: false, url, mediaType: null, body: null, error: { code, message } };
}