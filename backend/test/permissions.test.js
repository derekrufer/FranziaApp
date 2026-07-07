import test from "node:test";
import assert from "node:assert/strict";
import { actorForUser, hasPermission } from "../src/permissions.js";

test("commissioner_admin grants all permission checks", () => {
  assert.equal(hasPermission({ permissions: ["commissioner_admin"] }, "manage_draft"), true);
});

test("specific permissions grant only matching actions", () => {
  const user = { permissions: ["manage_keepers"] };

  assert.equal(hasPermission(user, "manage_keepers"), true);
  assert.equal(hasPermission(user, "manage_draft"), false);
  assert.equal(hasPermission(null, "manage_draft"), false);
});

test("actor payload preserves user identity and commissioner elevation", () => {
  const user = {
    id: "user-1",
    teamId: "team-1",
    displayName: "Derek",
    permissions: ["manage_draft"]
  };

  assert.deepEqual(actorForUser(user), {
    actorUserId: "user-1",
    actorTeamId: "team-1",
    actorLabel: "Derek",
    isCommissioner: false
  });
  assert.equal(actorForUser(user, true).isCommissioner, true);
  assert.equal(actorForUser({ ...user, permissions: ["commissioner_admin"] }).isCommissioner, true);
});
