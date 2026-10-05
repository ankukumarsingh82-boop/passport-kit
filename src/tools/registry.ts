import { mockWebFetchTool } from "./mock-web-fetch.js";
import { notesStoreTool } from "./notes-store.js";
import type { Tool } from "./types.js";

export function createToolRegistry(): Map<string, Tool> {
  return new Map<string, Tool>([
    [mockWebFetchTool.name, mockWebFetchTool],
    [notesStoreTool.name, notesStoreTool]
  ]);
}