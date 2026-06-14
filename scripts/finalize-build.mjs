// Marks the CommonJS output directory as CommonJS so Node treats the dual
// build's .js files correctly even though the root package.json is ESM.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cjsDir = join(root, "dist", "cjs");
if (!existsSync(cjsDir)) {
  mkdirSync(cjsDir, { recursive: true });
}
writeFileSync(join(cjsDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
console.log("Wrote dist/cjs/package.json ({ type: commonjs })");
