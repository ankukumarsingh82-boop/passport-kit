---
name: brief-a-company
description: "Brief one company from local fictional fixtures. Resolves a company name against the fixture index, reads the structured record and its companion page through mock-web-fetch, checks that they agree, and returns a source-cited brief or a fixed refusal status. Use when asked for a brief on Northline Freight, Helio Meter, Paperlane Health, or any company name that should be checked against the fixtures."
license: MIT
allowed-tools: mock-web-fetch notes-store
metadata:
  author: Anku Kumar
  version: "0.1.0"
  category: company-research
  reference_implementation: src/runner.ts
---

# Brief a Company

## Instructions
Follow this plan in order. Do not reorder or skip steps.

1. Trim the input `company`. If it is empty or longer than 120 characters, return `invalid_input` with the message "Company name must be a non-empty string of at most 120 characters." Call no tools.
2. Call `mock-web-fetch` with `fixture://companies/index`.
3. Resolve the name by exact match, after lowercasing and collapsing whitespace, on the fixture `name`, any `aliases` entry, or the `slug`. If zero or several fixtures match, call `mock-web-fetch` once for `fixture://companies/{guess}` and once for `fixture://pages/{guess}`, where `{guess}` is the slugified input, then return `not_found` with the message "No local fixture matches that company. PassportKit will not invent a brief." and `brief: null`.
4. Call `mock-web-fetch` for `fixture://companies/{slug}` and `fixture://pages/{slug}`. If either is missing, return `incomplete_fixture`.
5. Validate the record against `contracts/company-fixture.schema.json` (`invalid_fixture` on failure). Check that the page text contains the name, sector, city, country, founded year, summary, every product, and every fact label and value. If anything is missing, return `fixture_mismatch`.
6. On success only, call `notes-store` with `{ "op": "put", "key": "brief:{slug}", "text": "Recorded a local-fixture brief for {name}." }`, then `{ "op": "list" }`, and return `status: ok` with the brief.

## Output Format
```json
{
  "status": "ok",
  "resolvedSlug": "helio-meter",
  "brief": {
    "name": "Helio Meter",
    "slug": "helio-meter",
    "sector": "Climate instrumentation",
    "headquarters": "Boulder, United States",
    "founded": 2018,
    "summary": "...",
    "products": ["..."],
    "facts": [{ "label": "...", "value": "..." }],
    "sources": ["fixture://companies/helio-meter", "fixture://pages/helio-meter"],
    "fictional": true
  }
}
```

The full result shape, including `runId`, `message`, `notes`, and `trace`, is defined in `contracts/brief-output.schema.json`.
