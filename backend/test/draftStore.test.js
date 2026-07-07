import test from "node:test";
import assert from "node:assert/strict";
import { getDraftState, makePick, resetDraftedPicks, undoLastPick } from "../src/draftStore.js";

test.beforeEach(() => {
  resetDraftedPicks();
});

test("draft pick mutation records a selected player and advances the current pick", () => {
  const before = getDraftState();
  const pick = before.currentPick;
  const player = before.availablePlayers[0];

  const after = makePick({
    pickId: pick.id,
    playerId: player.id,
    teamId: pick.currentOwnerTeamId
  });

  const updatedPick = after.picks.find((candidate) => candidate.id === pick.id);
  assert.equal(updatedPick.playerId, player.id);
  assert.equal(updatedPick.pickType, "drafted");
  assert.equal(after.availablePlayers.some((candidate) => candidate.id === player.id), false);
  assert.notEqual(after.currentPick.id, pick.id);
});

test("draft pick mutation enforces team ownership and duplicate player rules", () => {
  const state = getDraftState();
  const pick = state.currentPick;
  const player = state.availablePlayers[0];
  const wrongTeamId = state.teams.find((team) => team.id !== pick.currentOwnerTeamId).id;

  assert.throws(
    () => makePick({ pickId: pick.id, playerId: player.id, teamId: wrongTeamId }),
    /Only the team on the clock/
  );

  makePick({ pickId: pick.id, playerId: player.id, teamId: pick.currentOwnerTeamId });
  const nextPick = getDraftState().currentPick;
  assert.throws(
    () => makePick({ pickId: nextPick.id, playerId: player.id, teamId: nextPick.currentOwnerTeamId }),
    /already drafted or kept/
  );
});

test("undo and reset clear drafted picks but preserve keeper picks", () => {
  const initial = getDraftState();
  const keeperPick = initial.picks.find((pick) => pick.pickType === "keeper");
  const firstPick = initial.currentPick;
  const firstPlayer = initial.availablePlayers[0];

  makePick({ pickId: firstPick.id, playerId: firstPlayer.id, teamId: firstPick.currentOwnerTeamId });
  const undone = undoLastPick();
  assert.equal(undone.picks.find((pick) => pick.id === firstPick.id).playerId, null);
  assert.equal(undone.picks.find((pick) => pick.id === keeperPick.id).playerId, keeperPick.playerId);

  const secondPick = undone.currentPick;
  const secondPlayer = undone.availablePlayers[0];
  makePick({ pickId: secondPick.id, playerId: secondPlayer.id, teamId: secondPick.currentOwnerTeamId });
  const reset = resetDraftedPicks();
  assert.equal(reset.picks.find((pick) => pick.id === secondPick.id).playerId, null);
  assert.equal(reset.picks.find((pick) => pick.id === keeperPick.id).playerId, keeperPick.playerId);
});
