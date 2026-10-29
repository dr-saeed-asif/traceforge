import { sha256 } from "../../annotation/lib.mjs";

/** Git may change text-source line endings on checkout; evidence stays byte-exact. */
export function sourceDigest(path, bytes) {
  return sha256(/\.(?:ts|json)$/u.test(path) ? bytes.toString("utf8").replace(/\r\n?/gu,"\n") : bytes);
}
