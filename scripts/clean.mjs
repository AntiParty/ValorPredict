// Remove stale compiled output so each production build is pristine
// (tsc does not clean its outDir between runs).
import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve("dist"), { recursive: true, force: true });
console.log("Cleaned dist/");
