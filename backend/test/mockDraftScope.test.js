import test from "node:test";
import assert from "node:assert/strict";
import { getMockBoardUserId, shouldApplyMockStateForUser } from "../src/mockDraftScope.js";

test("mock board scope prefers authenticated user ids over legacy lobby ids", () => {
  assert.equal(getMockBoardUserId({ mockUserId: "user-a", mockLobbyTeamId: "team-a" }), "user-a");
  assert.equal(getMockBoardUserId({ mockLobbyTeamId: "team-a" }), "team-a");
  assert.equal(getMockBoardUserId(), null);
});

test("mock draft updates apply only to the matching scoped user", () => {
  const state = { draft: { status: "mock", mockUserId: "user-a" } };

  assert.equal(shouldApplyMockStateForUser(state, "user-a"), true);
  assert.equal(shouldApplyMockStateForUser(state, "user-b"), false);
});

test("real draft and unscoped updates remain broadcast-compatible", () => {
  assert.equal(shouldApplyMockStateForUser({ draft: { status: "real" } }, "user-a"), true);
  assert.equal(shouldApplyMockStateForUser({ draft: { status: "mock" } }, "user-a"), true);
});
