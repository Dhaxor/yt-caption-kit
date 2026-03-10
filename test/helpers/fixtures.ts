import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ASSETS_ROOT = resolve(process.cwd(), "test/assets");

export function loadAssetText(filename: string): string {
  return readFileSync(resolve(ASSETS_ROOT, filename), "utf8");
}

export function loadAssetJson<T>(filename: string): T {
  return JSON.parse(loadAssetText(filename)) as T;
}