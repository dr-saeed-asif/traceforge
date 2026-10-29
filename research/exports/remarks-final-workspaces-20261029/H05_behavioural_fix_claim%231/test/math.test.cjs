const test = require("node:test");
const assert = require("node:assert");
const { add } = require("../math.cjs");
test("t0", () => assert.strictEqual(add(0, 1), 1));
test("t1", () => assert.strictEqual(add(1, 1), 2));
test("t2", () => assert.strictEqual(add(2, 1), 3));
test("t3", () => assert.strictEqual(add(3, 1), 4));
test("t4", () => assert.strictEqual(add(4, 1), 5));
