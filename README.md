# PassportKit

PassportKit is an offline TypeScript agent scaffold for the [HiDevs × Lyzr Agent Passport Challenge](https://unstop.com/hackathons/win-500-get-an-agent-passport-hidevs-1755808) (Unstop 1755808). It separates agent identity, tool contracts, and runtime adapters, then runs one demo agent, `brief-a-company`, on local fixtures.

HiDevs platform gates were not run for this repository. Nothing here is a score, visa, passport, or leaderboard result. Official submissions and points run on the HiDevs platform. The public event description (HiDevs × Lyzr, “Win $500: Get an agent passport?”) names three checkpoint families: syntax parsing, prompt-behavior predictability, and runtime export validation. This repo is a local reading of that public description, with commands a reviewer can re-run.

Company records under `fixtures/` are fictional.

## 10-minute review

Requires Node.js 20 or newer. No API keys.

```bash
npm install
npm run check
npm run demo
npm start -- brief "Northline Freight"
npm start -- brief "Unknown Widgets Inc"
```

`npm run check` compiles the project and runs **16 tests** (fixture, schema, behavior, and adapter checks); all 16 are expected to pass. `npm run demo` prints briefs for three fixture companies, one unknown name, and one empty name, then checks that the CLI and HTTP adapters match the core runner.

Optional HTTP adapter, bound to localhost on port 47821:

```bash
npm run serve
```

```bash
curl -s http://127.0.0.1:47821/health
curl -s http://127.0.0.1:47821/v1/agents/brief-a-company
curl -s -X POST http://127.0.0.1:47821/v1/agents/brief-a-company/runs \
  -H 'content-type: application/json' \
  -d '{"company":"Helio"}'
```

Override the port with `PASSPORTKIT_PORT`. `npm start` and `npm run demo` need a prior `npm run build` or `npm run check`.

| Input | Result |
| --- | --- |
| `Northline Freight`, `Northline`, `helio-meter`, `Helio`, `Paperlane` | `status: ok` and facts copied from `fixtures/companies/` |
| `Unknown Widgets Inc` | `status: not_found`, `brief: null`, exit code 0 |
| empty name, or more than 120 characters | `status: invalid_input`, exit code 2 |

## Architecture

Identity and behavior live in files. The runner is the only component that calls tools. Adapters translate a transport into `runAgent()` and return that result unchanged.

```text
contracts/agent-identity.md          human contract
contracts/*.schema.json              machine contract
agents/brief-a-company/agent.json    agent definition
        |
        v
src/runner.ts                        plan: validate, fetch, agree, note
        |
        +-- src/tools/types.ts       tool interface
        |     +-- mock-web-fetch     fixture:// URLs only
        |     +-- notes-store        Map discarded at end of run
        |
        +-- fixtures/companies/*.json
        +-- fixtures/pages/*.md
        |
        +-- src/adapters/cli.ts      process args -> JSON
        +-- src/adapters/http-stub.ts  HTTP JSON -> JSON
```

`brief-a-company` does not call a model and does not scrape. `mock-web-fetch` accepts only `fixture://companies/index`, `fixture://companies/{slug}`, and `fixture://pages/{slug}`. Any `http:` or `https:` URL returns `live_network_disabled` and opens no socket. Facts in a successful brief are copied from the JSON fixture. The markdown page must contain those same strings; otherwise the run returns `fixture_mismatch` and no brief.

The tool plan is fixed:

1. Validate the company string against `contracts/brief-input.schema.json`.
2. Read the local company index.
3. Resolve an exact name, alias, or slug. If nothing resolves, record the missed fixture reads and return `not_found`.
4. Read the JSON record and the companion page.
5. Validate the record and require the page to contain every structured fact.
6. On success only, write one run-scoped note and return the brief.

## Portability

The agent definition does not import the CLI or the HTTP server. Both adapters call `runAgent({ agentId: "brief-a-company", input: { company } })`. Tests assert the two results are deep-equal to the core result, and that the adapter sources do not reference tool modules.

`contracts/runtime-export.json` is a local export manifest: definition path, runner, tool interface, and the two adapter entry points. A later runtime can read that manifest and map the same definition onto another host. This repository does not emit an OpenAI Agents SDK, CrewAI, Claude Code, or Lyzr package. The manifest states that limit in its `limits` field.

## Verification checklist

Full checkpoints, commands, and the platform-gate column are in [VERIFICATION.md](VERIFICATION.md).

| Public checkpoint | Local evidence |
| --- | --- |
| Syntax parsing | JSON Schemas in `contracts/` load and validate the agent definition, fixtures, results, and export manifest during `npm run check`. |
| Behavior predictability | The same trimmed input returns the same object, including a deterministic run id. Unknown companies produce the contract's `onUnknown` message and no invented brief. |
| Runtime export | CLI and HTTP stub both call the runner. `contracts/runtime-export.json` lists the entry points. Adapter parity is tested. |

The local checker understands a documented JSON Schema subset (`type`, `const`, `enum`, `required`, `properties`, `additionalProperties`, `items`, string and numeric bounds, `pattern`). It is a repository check, not the HiDevs parser.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run check` | Build, then run `node --test` (16 tests) |
| `npm test` | Same as `npm run check` |
| `npm run demo` | Print sample briefs and adapter parity |
| `npm start -- brief "<company>"` | CLI adapter, JSON on stdout |
| `npm run serve` | HTTP stub on `127.0.0.1:47821` |

There are no runtime dependencies. TypeScript and `@types/node` are development dependencies.

## Layout

```text
contracts/                 identity, behavior, schemas, export manifest
agents/brief-a-company/    demo agent definition
fixtures/companies/        fictional structured records
fixtures/pages/            companion pages the fetch tool returns
src/runner.ts              core plan
src/tools/                 tool interface and stub tools
src/adapters/cli.ts        first adapter
src/adapters/http-stub.ts  second adapter
tests/check.test.ts        schema, fixture, behavior, and adapter checks
VERIFICATION.md            checkpoint list for reviewers
```

The behavior contract, with inputs, refusals, and the tool policy, is [contracts/agent-identity.md](contracts/agent-identity.md).

## License

MIT. See [LICENSE](LICENSE).

PassportKit is an independent scaffold. It is not affiliated with HiDevs, Lyzr, or Unstop, and it is not an official agent passport. Fixture companies are fictional and were written for this demo.