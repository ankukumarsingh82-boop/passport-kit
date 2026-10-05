import type { Tool, ToolContext } from "./types.js";

const KEY_PATTERN = /^[a-z0-9:_-]{1,80}$/;

export interface NoteRecord {
  key: string;
  text: string;
}

export interface NotesResult {
  ok: boolean;
  op: "put" | "get" | "list" | "invalid";
  key: string | null;
  text: string | null;
  notes: NoteRecord[];
  error: { code: "invalid_input" | "not_found"; message: string } | null;
}

export const notesStoreTool: Tool = {
  name: "notes-store",
  description: "Run-scoped notes. Values live in the run Map and are discarded when the run ends.",
  async execute(input: unknown, context: ToolContext): Promise<NotesResult> {
    const parsed = parseNotesInput(input);
    if (!parsed) {
      return {
        ok: false,
        op: "invalid",
        key: null,
        text: null,
        notes: listNotes(context),
        error: {
          code: "invalid_input",
          message: "notes-store expects op put, get, or list."
        }
      };
    }

    if (parsed.op === "list") {
      return {
        ok: true,
        op: "list",
        key: null,
        text: null,
        notes: listNotes(context),
        error: null
      };
    }

    if (!parsed.key || !KEY_PATTERN.test(parsed.key)) {
      return {
        ok: false,
        op: parsed.op,
        key: parsed.key ?? null,
        text: null,
        notes: listNotes(context),
        error: {
          code: "invalid_input",
          message: "Note keys must match ^[a-z0-9:_-]{1,80}$."
        }
      };
    }

    if (parsed.op === "get") {
      const text = context.notes.get(parsed.key);
      if (text === undefined) {
        return {
          ok: false,
          op: "get",
          key: parsed.key,
          text: null,
          notes: listNotes(context),
          error: { code: "not_found", message: `No note stored for ${parsed.key}.` }
        };
      }
      return {
        ok: true,
        op: "get",
        key: parsed.key,
        text,
        notes: listNotes(context),
        error: null
      };
    }

    if (!parsed.text || parsed.text.trim().length === 0) {
      return {
        ok: false,
        op: "put",
        key: parsed.key,
        text: null,
        notes: listNotes(context),
        error: { code: "invalid_input", message: "Note text must be a non-empty string." }
      };
    }

    context.notes.set(parsed.key, parsed.text);
    return {
      ok: true,
      op: "put",
      key: parsed.key,
      text: parsed.text,
      notes: listNotes(context),
      error: null
    };
  }
};

function listNotes(context: ToolContext): NoteRecord[] {
  return [...context.notes.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, text]) => ({ key, text }));
}

interface ParsedNotesInput {
  op: "put" | "get" | "list";
  key?: string;
  text?: string;
}

function parseNotesInput(input: unknown): ParsedNotesInput | null {
  if (!input || typeof input !== "object" || !("op" in input)) return null;
  const op = input.op;
  if (op !== "put" && op !== "get" && op !== "list") return null;
  const key = "key" in input ? input.key : undefined;
  const text = "text" in input ? input.text : undefined;
  if (key !== undefined && typeof key !== "string") return null;
  if (text !== undefined && typeof text !== "string") return null;
  if (typeof key === "string" && typeof text === "string") return { op, key, text };
  if (typeof key === "string") return { op, key };
  if (typeof text === "string") return { op, text };
  return { op };
}