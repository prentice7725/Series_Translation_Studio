import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distMigrations = resolve(root, "dist", "migrations");
rmSync(distMigrations, { recursive: true, force: true });
mkdirSync(distMigrations, { recursive: true });
cpSync(resolve(root, "migrations"), distMigrations, { recursive: true });
