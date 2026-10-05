import { readFileSync } from "node:fs";
import path from "node:path";
import { validateSchema, type JsonSchema } from "./schema.js";

export interface AgentDefinition {
  spec: "passportkit.agent/v1";
  id: string;
  version: string;
  identity: {
    name: string;
    summary: string;
    role: string;
    domain: string;
    voice: string;
  };
  behavior: {
    objective: string;
    determinism: "fixture-deterministic";
    allowedActions: string[];
    forbiddenActions: string[];
    onUnknown: string;
    onInvalidInput: string;
  };
  tools: string[];
  io: {
    input: string;
    output: string;
  };
}

export function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "parse error";
    throw new Error(`Invalid JSON in ${file}: ${message}`);
  }
}

export function loadSchema(root: string, relativePath: string): JsonSchema {
  const file = path.join(root, relativePath);
  const parsed = readJson(file);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Schema ${relativePath} must be a JSON object`);
  }
  return parsed as JsonSchema;
}

export function loadAgentDefinition(root: string, agentId: string): AgentDefinition {
  const relativePath = path.join("agents", agentId, "agent.json");
  const file = path.join(root, relativePath);
  let parsed: unknown;
  try {
    parsed = readJson(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable agent definition";
    throw new Error(message);
  }
  const schema = loadSchema(root, "contracts/agent-identity.schema.json");
  const errors = validateSchema(schema, parsed);
  if (errors.length > 0) {
    throw new Error(`Agent definition ${relativePath} failed schema validation: ${errors.join("; ")}`);
  }
  const definition = parsed as AgentDefinition;
  if (definition.id !== agentId) {
    throw new Error(`Agent id ${definition.id} does not match path ${agentId}`);
  }
  return definition;
}