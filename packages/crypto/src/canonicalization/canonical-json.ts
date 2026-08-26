export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`Non-finite number at ${path} is not valid canonical JSON`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => serialize(item, `${path}[${index}]`)).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`Unsupported object at ${path}; normalize it before hashing`);
      }
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(object[key], `${path}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`Unsupported ${typeof value} at ${path}`);
  }
}

/** RFC 8785-compatible serialization for already normalized JSON values. */
export function canonicalize(value: CanonicalJsonValue): string {
  return serialize(value, "$");
}
