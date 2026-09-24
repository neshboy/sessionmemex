import { createHash } from "node:crypto";

/** Stable content hash used to detect whether a transcript file actually changed. */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
