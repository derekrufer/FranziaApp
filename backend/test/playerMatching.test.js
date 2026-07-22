import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlayerName } from "../src/postgresStore.js";

test("player matching canonicalizes Kenneth and Kenny as the same first name", () => {
  assert.equal(normalizePlayerName("Kenneth Gainwell"), "kenny gainwell");
  assert.equal(normalizePlayerName("Kenny Gainwell"), "kenny gainwell");
});

test("player matching still removes suffixes and normalizes punctuation", () => {
  assert.equal(normalizePlayerName("  Marvin Harrison, Jr. "), "marvin harrison");
});
