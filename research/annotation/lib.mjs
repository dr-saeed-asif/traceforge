import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function readJsonl(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

/**
 * RFC 4180 CSV parser. It supports quoted fields, escaped quotes, CRLF and
 * embedded newlines so prompts and final responses survive spreadsheet edits.
 */
export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/u, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = value === undefined || value === null ? "" : String(value);
          return `"${text.replace(/"/gu, '""')}"`;
        })
        .join(","),
    )
    .join("\n") + "\n";
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      index++;
    }
  }
  return args;
}

export function parseStringList(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "[]") return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("Expected a JSON array of strings.");
    }
    return parsed;
  }
  return trimmed
    .split(/[;,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBoolean(value, field) {
  const normalised = String(value ?? "").trim().toUpperCase();
  if (normalised === "TRUE") return true;
  if (normalised === "FALSE") return false;
  throw new Error(`${field} must be TRUE or FALSE; received ${JSON.stringify(value ?? "")}.`);
}

export function requireIsoDate(value, field) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new Error(`${field} must be a parseable ISO-8601 timestamp.`);
  }
  return text;
}

export function csvRecords(rows) {
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map((header) => header.trim());
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV contains duplicate column names.");
  }
  return {
    headers,
    records: rows.slice(1).map((cells, index) => {
      if (cells.length !== headers.length) {
        throw new Error(
          `CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}.`,
        );
      }
      return Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""]));
    }),
  };
}
