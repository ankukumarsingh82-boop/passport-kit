# Agent identity and behavior contract

Agent: `brief-a-company`  
Spec: `passportkit.agent/v1`  
Machine-readable copy: [`agents/brief-a-company/agent.json`](../agents/brief-a-company/agent.json)  
Schema: [`agent-identity.schema.json`](agent-identity.schema.json)

This document is the human contract for the demo agent. The runner loads the JSON definition and rejects it when it fails the schema. Adapters do not restate this contract.

This is a PassportKit-local contract. It is not an OpenGAP passport, a Lyzr agent export, or a credential issued by HiDevs.

## Identity

| Field | Value |
| --- | --- |
| Name | Brief a Company |
| Role | Company briefing clerk |
| Domain | Fictional company research fixtures |
| Voice | Plain, specific, and source-cited |

The agent introduces a company using only the fields in that company's fixture. It cites `fixture://` sources. It labels every successful brief as fictional because every fixture sets `fictional: true`.

## Objective

Given a company name, return a structured brief copied from the matching local fixture.

The same trimmed input always produces the same result. The run id is the first 16 hex characters of SHA-256 over `brief-a-company`, a newline, and the trimmed company name. There is no model call, no clock in the output, and no network fetch.

## Input

Schema: [`brief-input.schema.json`](brief-input.schema.json)

```json
{ "company": "Helio" }
```

The runner trims the string, then validates it. A valid name has 1 to 120 characters.

A name resolves when one fixture matches any of these, compared case-insensitively with collapsed internal whitespace:

- the fixture `name`
- one entry in `aliases`
- the fixture `slug` (hyphenated, lowercase)

`Helio`, `HELIO`, and `helio-meter` all resolve to Helio Meter. Zero matches and more than one match both end as `not_found`.

## Output

Schema: [`brief-output.schema.json`](brief-output.schema.json)

On success, `status` is `ok` and `brief` contains name, slug, sector, headquarters, founded year, summary, products, facts, two `fixture://` sources, and `fictional: true`. Facts are copied from the JSON fixture. They are not parsed out of the markdown page by a model.

The companion page must contain the company name, sector, city, country, founded year, summary, each product, and each fact label and value. If it does not, the run returns `fixture_mismatch` and no brief.

Other statuses:

| Status | When | Brief | Notes |
| --- | --- | --- | --- |
| `ok` | One fixture matches and the page agrees | Present | One run-scoped note |
| `not_found` | No single fixture matches | `null` | None |
| `invalid_input` | Empty or longer than 120 characters | `null` | None |
| `incomplete_fixture` | The record or the page file is missing | `null` | None |
| `invalid_fixture` | The record fails the company schema | `null` | None |
| `fixture_mismatch` | The page omits a structured fact | `null` | None |

`not_found` uses `behavior.onUnknown` from the agent definition. `invalid_input` uses `behavior.onInvalidInput`.

## Tools

The definition names the only tools this agent may call.

### `mock-web-fetch`

Reads packaged fixtures. Allowed URLs:

- `fixture://companies/index`
- `fixture://companies/{slug}`
- `fixture://pages/{slug}`

Any `http:`, `https:`, or other non-fixture scheme returns `live_network_disabled` and does not open a socket. Slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Path segments such as `..` are rejected before a filesystem join.

### `notes-store`

Run-scoped key/value memory held in a `Map` for that run. The runner writes `brief:{slug}` only after a valid, agreeing brief. The map is discarded when the run returns. The tool does not read or write the filesystem.

## Plan

The runner in [`src/runner.ts`](../src/runner.ts) executes this plan. Adapters cannot reorder it.

1. Validate input against the input schema. Stop on failure. No tools run.
2. `mock-web-fetch` `fixture://companies/index`.
3. Resolve the name. If it does not resolve, fetch the slugified guess for the record and the page, then return `not_found`.
4. Fetch `fixture://companies/{slug}` and `fixture://pages/{slug}`.
5. Validate the JSON record. Compare it with the page text.
6. On success, `notes-store` `put` then `list`, and return the brief.

## Portability

Identity, allowed tools, refusal text, and schemas live under `contracts/` and `agents/`. [`src/tools/types.ts`](../src/tools/types.ts) is the tool boundary. [`src/adapters/cli.ts`](../src/adapters/cli.ts) and [`src/adapters/http-stub.ts`](../src/adapters/http-stub.ts) only translate a company name into `runAgent()` and return the same result object.

[`runtime-export.json`](runtime-export.json) lists those entry points for a second runtime. It does not generate an OpenAI Agents SDK, CrewAI, Claude Code, or Lyzr package.

## Predictability examples

Input `Northline Freight` returns the Rotterdam freight-forwarding brief and a note `brief:northline-freight`.

Input `Unknown Widgets Inc` returns `not_found`, `brief: null`, no notes, and the `onUnknown` message.

Input `""` returns `invalid_input` and an empty tool trace.