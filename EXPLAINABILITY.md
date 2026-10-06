# Explainability: passportkit

This document explains how the `passportkit` agent (the `brief-a-company` worker defined in [`agent.yaml`](agent.yaml) and [`agents/brief-a-company/agent.json`](agents/brief-a-company/agent.json)) reaches a result, what data it reads, and where it stops being reliable. Every statement below can be checked against [`src/runner.ts`](src/runner.ts), [`src/resolve.ts`](src/resolve.ts), the two tools in [`src/tools/`](src/tools/), and the 16 tests in [`tests/check.test.ts`](tests/check.test.ts).

## Decision Reasoning: How It Decides

The agent decides by applying a fixed sequence of deterministic checks, and it answers only when every check passes. Its reasoning is visible in every result through the status, the resolved slug and the tool trace.

The reference runner does not call a language model. Each decision is a fixed rule in `src/runner.ts`, applied in this order:

1. **Input gate.** The company string is trimmed and checked against `contracts/brief-input.schema.json` (1 to 120 characters). A failure returns `invalid_input` with the definition's `onInvalidInput` message. No tool runs.
2. **Index read.** `mock-web-fetch` reads `fixture://companies/index`, which lists the slug, name, and aliases of every file in `fixtures/companies/`. If the index cannot be built, the run returns `incomplete_fixture` or `invalid_fixture`.
3. **Name resolution.** `resolveCompany()` lowercases the input, collapses whitespace, and looks for an exact match on the fixture `name`, any `aliases` entry, or the `slug`. There is no fuzzy matching, ranking, or scoring. If exactly one fixture matches, the run continues. If zero or several match, the runner reads the slugified guess (`fixture://companies/{guess}` and `fixture://pages/{guess}`) so the trace shows what was tried, then returns `not_found` with `brief: null` and the fixed `onUnknown` message.
4. **Evidence read.** `mock-web-fetch` reads the JSON record and the markdown companion page for the resolved slug. If either is missing, the result is `incomplete_fixture`.
5. **Evidence check.** The record is validated against `contracts/company-fixture.schema.json` (`invalid_fixture` on failure). The runner then requires the page text to contain the name, sector, city, country, founded year, summary, every product, and every fact label and value (`missingFixtureSnippets()`). If any one is absent, the result is `fixture_mismatch` and no brief.
6. **Answer.** Only after all checks pass does the runner build the brief by copying fields from the JSON record. It writes one run-scoped note (`brief:{slug}`) with `notes-store`, lists the notes, and returns `status: ok`.

Every result is validated against `contracts/brief-output.schema.json` before it is returned. A result that does not match the schema throws an error instead of reaching the caller.

**Why a given answer came out the way it did.** Each result carries:

- `status` and `message`: which rule ended the run.
- `resolvedSlug`: which fixture, if any, the name resolved to.
- `trace`: every tool call in order, with the URL or note operation and whether it succeeded.
- `brief.sources`: the two `fixture://` URLs the facts were copied from.
- `runId`: `run_` plus the first 16 hex characters of SHA-256 over `brief-a-company`, a newline, and the trimmed input. The run id contains no clock value, so the same input always yields the same run id and the same result.

The CLI (`src/adapters/cli.ts`) and the HTTP stub (`src/adapters/http-stub.ts`) pass the input to `runAgent()` and return its result unchanged. Tests assert that both are deep-equal to the core result.

## Inputs and Data Sources (Data Used)

The only input is a company name supplied by the caller, and the only data sources are local fictional fixtures bundled in this repository. The agent never reads the internet, credentials or user history, and nothing persists between runs.

| Data | Location | How it is used |
| --- | --- | --- |
| Company records | `fixtures/companies/*.json` (Northline Freight, Helio Meter, Paperlane Health) | The only source of facts in a brief. Fields are copied verbatim. |
| Companion pages | `fixtures/pages/*.md` | Used only to cross-check the record. No fact is taken from the page. |
| Agent definition | `agents/brief-a-company/agent.json` | Declared tools, refusal messages, and schema paths. A tool that is not declared there cannot be called. |
| Contracts | `contracts/*.schema.json` | Input, record, and output validation. |
| Caller input | `{ "company": "<name>" }` | Trimmed and matched. It is echoed back in `input.company`, and nothing else from it is stored. |

All three companies are fictional, and every record sets `fictional: true`. Each brief repeats that flag.

What it does **not** use: the public internet, search engines, environment variables, credentials, user history, or any model output. `mock-web-fetch` refuses `http:`, `https:`, and every other non-`fixture://` scheme with `live_network_disabled` and opens no socket. `notes-store` keeps notes in a `Map` that is discarded when the run returns, and it does not touch the filesystem. Nothing persists between runs.

## Limitations, Constraints and Known Issues

The agent is deliberately narrow, so its limitations are mostly constraints by design. The known issues below describe where its answers stop being useful or reliable.

- **Three companies only.** The agent can brief only the three bundled fictional companies. Any real company returns `not_found`. This is intentional, but it means the agent has no value for real research as shipped.
- **Exact matching only.** Typos, abbreviations that are not listed as aliases, and other spellings (for example `Northline Freight BV`) return `not_found`. A name that matches more than one fixture also returns `not_found`, without saying it was ambiguous.
- **Static data.** Fixtures change only when the repository changes. There are no dates or freshness checks on facts.
- **The page check is a substring check.** `fixture_mismatch` detects missing text. It does not detect contradictions: a page that contains every required string and also contradicts one of them would pass.
- **No model in the reference runner.** Behavior predictability comes from fixed code, not from prompt behavior. The `model` block in `agent.yaml` (`gpt-4o`, temperature 0) applies only when the definition is exported to an LLM-hosted runtime.
- **Exported runtimes are not equivalent to the reference runner.** OpenGAP exports for the OpenAI Agents SDK, CrewAI, Claude Code, and Lyzr turn `SOUL.md`, `RULES.md`, `skills/brief-a-company/SKILL.md`, and `tools/*.yaml` into instructions and tool declarations for a language model. In those hosts:
  - A model follows the plan instead of compiled code. It can deviate from it, paraphrase facts, or fail to refuse. None of the 16 tests run against an exported agent.
  - The OpenAI export generates Python stubs for `mock-web-fetch` and `notes-store` with no implementation. A host must wire them to the TypeScript tools, for example through the HTTP stub, before an exported agent can read fixtures.
  - Determinism, including the run id, is guaranteed only by `src/runner.ts`.
- **Local HTTP stub only.** `npm run serve` binds to `127.0.0.1` with no authentication. It is a demo adapter, not a production service.
- **Not a verification result.** Passing `npm run check` or `opengap validate` locally is not a HiDevs passport, visa, or score.
