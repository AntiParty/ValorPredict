// Fold the built SPA into the server's output so `dist/` is a single,
// self-contained, deployable artifact (server + client served by one process).
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("web", "dist");
const destination = resolve("dist", "public");

if (!existsSync(source)) {
  console.error(
    `Web build not found at ${source}. Run "npm run build:web" first.`,
  );
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`Bundled web build: ${source} -> ${destination}`);
