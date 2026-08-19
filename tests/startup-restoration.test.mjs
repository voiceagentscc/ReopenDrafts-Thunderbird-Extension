import assert from "node:assert/strict";
import test from "node:test";
import { restoreDisposition } from "../session-state.js";

async function restore(entries, openDurableDraft) {
  const results = [];
  for (const entry of entries) results.push(await openDurableDraft(entry));
  return results;
}

test("startup waits for the native resolver and opens each entry once", async () => {
  const calls = [];
  const result = await restore([{ key: "a" }, { key: "b" }], async entry => {
    calls.push(entry.key);
    return { status: "opened" };
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(result, [{ status: "opened" }, { status: "opened" }]);
});

test("a missing result is distinguishable from a temporary unavailable folder", async () => {
  const result = await restore([{ key: "missing" }, { key: "unavailable" }], async entry =>
    entry.key === "missing" ? { status: "missing" } : { status: "unavailable", reason: "folder-timeout" }
  );
  assert.deepEqual(result, [
    { status: "missing" },
    { status: "unavailable", reason: "folder-timeout" },
  ]);
  assert.equal(restoreDisposition(result[0]), "prune");
  assert.equal(restoreDisposition(result[1]), "retain");
});

test("only native opened or focused results count as restored", () => {
  assert.equal(restoreDisposition({ status: "opened" }), "restored");
  assert.equal(restoreDisposition({ status: "focused" }), "restored");
  assert.equal(restoreDisposition({ status: "unexpected" }), "retain");
});
