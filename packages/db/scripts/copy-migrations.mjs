import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "dist", "migrations"), { recursive: true });
cpSync(resolve(root, "migrations"), resolve(root, "dist", "migrations"), { recursive: true });
