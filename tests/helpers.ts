import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const FIXTURES_DIR = path.join(__dirname, "fixtures");

export function copyFixtures(names: string[], destDir: string): void {
  for (const name of names) {
    fs.copyFileSync(path.join(FIXTURES_DIR, name), path.join(destDir, name));
  }
}

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}
