// Removes the build output directory so stale files (e.g. files tsc no longer
// emits) never leak into a publish.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
rmSync(dist, { recursive: true, force: true });
console.log("Cleaned dist/");
