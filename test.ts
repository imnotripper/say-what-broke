// Black-box tests for main.ts: run it as a subprocess with controlled
// stdin and assert the gate invariants on /output/entry.txt.
// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const OUT = "/output/entry.txt";

function run(input: string | Buffer): { code: number; line: string } {
  execFileSync("node", ["main.ts"], {
    input,
    cwd: import.meta.dirname,
    stdio: ["pipe", "ignore", "pipe"],
  });
  const line = readFileSync(OUT, "utf8");
  return { code: 0, line };
}

function assertValid(line: string): void {
  const chars = [...line];
  assert.ok(chars.length >= 1, "line must not be empty");
  assert.ok(chars.length <= 200, `line is ${chars.length} chars, over 200`);
  assert.ok(line.trim().length > 0, "line must not be only whitespace");
  assert.ok(!line.includes("\n") && !line.includes("\r"), "must be one line");
}

test("empty stdin yields the default line, valid and stable", () => {
  const a = run("");
  const b = run("");
  assertValid(a.line);
  assert.equal(a.line, b.line, "empty stdin must be deterministic");
  assert.equal(
    a.line,
    "The server ran out of memory and died quietly, like a goldfish. Restart it and give it more RAM before it does it again.",
  );
});

test("same input twice yields the same line (determinism)", () => {
  const a = run("the database connection died");
  const b = run("the database connection died");
  assertValid(a.line);
  assert.equal(a.line, b.line);
});

test("varied inputs all produce valid single lines", () => {
  const inputs = [
    "the database is down",
    "payment declined at checkout",
    "upload failed halfway",
    "a",
    "x".repeat(500),
    "Ünïcödé tëxt with émojis 🤖 and punctuation!!!",
  ];
  for (const input of inputs) {
    assertValid(run(input).line);
  }
});

test("sweep: 60 varied inputs all produce valid single lines", () => {
  for (let i = 0; i < 60; i++) {
    assertValid(run(`the ${["database", "upload", "payment", "login", "server"][i % 5]} failed ${i} times today`).line);
  }
});

test("adversarial input does not crash and stays valid", () => {
  const shellish = "$(rm -rf /) && `reboot` | cat /etc/passwd; DROP TABLE users;";
  assertValid(run(shellish).line);
  const huge = "word ".repeat(200_000); // ~1 MB of stdin
  assertValid(run(huge).line);
  const binary = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a, 0x7f]);
  assertValid(run(binary).line);
});

test("output file has no trailing newline and no stdout noise", () => {
  const out = execFileSync("node", ["main.ts"], {
    input: "",
    cwd: import.meta.dirname,
    encoding: "utf8",
  });
  assert.equal(out, "", "main.ts must print nothing");
  const raw = readFileSync(OUT, "utf8");
  assert.ok(!raw.endsWith("\n"), "no trailing newline in entry.txt");
  assertValid(raw);
});

test("every corpus line is under the gate on its own", () => {
  // Probe the whole corpus: hash-picked lines across many inputs must
  // all stay within 200 chars, so no stdin can surface an over-long line.
  // The default line must never appear here: it is reserved for empty
  // stdin and is not a member of the hash-picked corpus.
  const defaultLine =
    "The server ran out of memory and died quietly, like a goldfish. Restart it and give it more RAM before it does it again.";
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const line = run(`failure case ${i} the server exploded`).line;
    assertValid(line);
    assert.notEqual(line, defaultLine, "non-empty stdin must not return the default line");
    seen.add(line);
  }
  assert.ok(seen.size > 10, `expected corpus variety, saw ${seen.size} distinct lines`);
});
