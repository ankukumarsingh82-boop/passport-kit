# Verification checklist

This is the local checklist for PassportKit. It maps the public HiDevs × Lyzr Agent Passport Challenge language onto files and commands in this repository.

Source for the checkpoint names: the public event “Win $500: Get an agent passport?” (HiDevs × Lyzr). That page describes live border gates as syntax parsing, prompt-behavior predictability tests, and runtime export validation, and it says submissions and points run on the HiDevs platform.

HiDevs platform gates were not run here. A passing `npm run check` is local evidence only. It does not award a visa, passport, score, or registry placement.

Registrants receive the official toolchain and verification docs from HiDevs. This file does not reproduce that private material.

## How to re-run the local evidence

```bash
npm install
npm run check
npm run demo
```

`npm run check` must exit 0. The demo must print `cli == core yes`, `http-stub == core yes`, and `Demo completed within the local contract.`

## Checkpoints

### 1. Syntax parsing

Public gate family: syntax parsing.

| | |
| --- | --- |
| Local checkpoint | Every contract schema parses, and the agent definition, company fixtures, export manifest, and a live brief result validate against those schemas. An extra field on the agent definition fails validation. |
| Evidence | `contracts/*.schema.json`, `agents/brief-a-company/agent.json`, `fixtures/companies/*.json`, `contracts/runtime-export.json` |
| Command | `npm run check` (tests under `contracts and fixtures` and the output-schema assertion in `brief-a-company`) |
| HiDevs platform | Not run |

The checker implements a JSON Schema subset: `type` (including unions used for null), `const`, `enum`, `required`, `properties`, `additionalProperties: false`, `items`, `minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`, and `pattern`. Keywords such as `$ref` and `if`/`then` are not implemented. Schemas in this repo stay inside that subset.

### 2. Behavior predictability

Public gate family: prompt-behavior predictability.

This agent has no model prompt. Predictability is the behavior contract: the same input yields the same result, and a missing company does not produce invented facts.

| | |
| --- | --- |
| Local checkpoint | Repeated calls with the same trimmed name are deep-equal, including `runId`. Facts on an `ok` brief equal the fixture facts. `not_found` uses `behavior.onUnknown`, sets `brief` to null, writes no notes, and still shows fixture reads in the trace. `invalid_input` runs no tools. A page that omits fixture text returns `fixture_mismatch`. A record that breaks the company schema returns `invalid_fixture`. |
| Evidence | `contracts/agent-identity.md`, `src/runner.ts`, `tests/check.test.ts` |
| Command | `npm run check` and `npm run demo` |
| HiDevs platform | Not run |

Run id: `run_` plus the first 16 hex characters of SHA-256 over `brief-a-company`, a newline, and the trimmed company name. No clock is included.

Name matching is exact after trim, case-folding, and collapsing internal whitespace. It matches `name`, `aliases`, or `slug`. Zero matches and multiple matches both return `not_found`.

### 3. Runtime export

Public gate family: runtime export validation.

| | |
| --- | --- |
| Local checkpoint | One runner, two adapters. CLI argv and `POST /v1/agents/brief-a-company/runs` both return the core object. The export manifest names real files. Adapter sources do not import tool modules. The runner does not read `process.argv` or `node:http`. Removing `notes-store` from the agent definition makes the runner refuse that call. |
| Evidence | `src/adapters/cli.ts`, `src/adapters/http-stub.ts`, `contracts/runtime-export.json`, `src/tools/types.ts` |
| Command | `npm run check` (adapter tests, including a spawned `node dist/src/adapters/cli.js` process and a localhost HTTP server on an ephemeral port) |
| HiDevs platform | Not run |

`contracts/runtime-export.json` is a local manifest. It is not an executed export to the OpenAI Agents SDK, CrewAI, Claude Code, or Lyzr. Those limits are written in the manifest's `limits` array so a downstream check can see them.

### 4. Identity is separate from runtime glue

Design goal from the public event: core identity and reasoning stay out of runtime glue.

| | |
| --- | --- |
| Local checkpoint | Name, role, objective, allowed actions, forbidden actions, and refusal strings are in `agents/brief-a-company/agent.json`. The human contract is `contracts/agent-identity.md`. Adapters only pass a company string into `runAgent`. |
| Evidence | `contracts/`, `agents/brief-a-company/agent.json`, `src/runner.ts` |
| Command | Read the contract, then `npm start -- brief "Helio"` |
| HiDevs platform | Not run |

### 5. Offline tool boundary

| | |
| --- | --- |
| Local checkpoint | `mock-web-fetch` reads `fixture://` URLs from `fixtures/` and returns `live_network_disabled` for `https://` without a socket call. Path segments outside the slug grammar are `invalid_url`. `notes-store` writes only to the in-memory run map and does not import `node:fs`. Successful briefs are written only after fixture agreement. Fixture files contain no `http://` or `https://` links. |
| Evidence | `src/tools/mock-web-fetch.ts`, `src/tools/notes-store.ts`, `fixtures/` |
| Command | `npm run check` (tool tests and fixture URL scan) |
| HiDevs platform | Not run |

### 6. Secret-free and public-repo ready

| | |
| --- | --- |
| Local checkpoint | No runtime service credentials. Tests scan project text for common private-key and API-token markers. `.env` files are gitignored. |
| Evidence | `package.json` (devDependencies only), `LICENSE`, `.gitignore`, hygiene test |
| Command | `npm run check` |
| HiDevs platform | Not run |

## What a passing local run does not show

- A HiDevs account submission, gate log, or leaderboard row.
- Compatibility with a vendor runtime that this repo does not execute.
- Live web research. Unknown companies stay unknown on purpose.

## Reviewer map

| Question | Where to look |
| --- | --- |
| Who is the agent? | `contracts/agent-identity.md` and `agents/brief-a-company/agent.json` |
| What may it call? | `tools` in the agent definition and `src/tools/types.ts` |
| What does a run return? | `contracts/brief-output.schema.json` |
| Where do facts come from? | `fixtures/companies/` and `fixtures/pages/` |
| How do two hosts call it? | `src/adapters/cli.ts` and `src/adapters/http-stub.ts` |
| What was checked locally? | This file and `npm run check` |