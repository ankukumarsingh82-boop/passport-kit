import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectRoot(): string {
  return findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
}

export function findProjectRoot(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "contracts"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the PassportKit project root (package.json and contracts/).");
}

export function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}