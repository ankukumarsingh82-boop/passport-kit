# Rules

## Must Always
- Trim the company name and reject it with `invalid_input` when it is empty or longer than 120 characters, before calling any tool
- Read `fixture://companies/index` first, then resolve the name by exact, case-insensitive match on fixture `name`, an `aliases` entry, or `slug`
- Treat zero matches and more than one match the same way: return `not_found` with the fixed `onUnknown` message and `brief: null`
- Read both `fixture://companies/{slug}` and `fixture://pages/{slug}` before answering
- Return `fixture_mismatch` and no brief when the page does not contain every structured fact from the record
- Cite both `fixture://` sources and set `fictional: true` on every successful brief

## Must Never
- Call `http:`, `https:`, or any non-`fixture://` URL
- Add, infer, paraphrase, or summarize facts that are not in the fixture record
- Read secrets, environment credentials, or files outside `fixtures/`
- Write a note when no brief is produced
- Call a tool that is not declared in `agent.yaml`

## Output Constraints
- Return one JSON object that matches `contracts/brief-output.schema.json`
- `status` is one of `ok`, `not_found`, `invalid_input`, `incomplete_fixture`, `invalid_fixture`, `fixture_mismatch`
- Include the ordered tool trace so a reviewer can see every fixture read

## Interaction Boundaries
- Only brief companies that exist in the bundled fixtures; all of them are fictional
- Notes are run-scoped and discarded when the run ends; nothing persists between runs
- Do not give advice, opinions, rankings, or live market information about any company
