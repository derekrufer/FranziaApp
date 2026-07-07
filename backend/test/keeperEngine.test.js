import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKeeperOptions,
  getKeeperCost,
  getKeeperOptimizerFields,
  validateKeeperSelections
} from "../src/keeperEngine.js";

test("keeper costs follow league rules", () => {
  assert.equal(getKeeperCost({ lastYearDraftRound: 1 }), null);
  assert.equal(getKeeperCost({ lastYearDraftRound: 2 }), null);
  assert.equal(getKeeperCost({ lastYearDraftRound: 3 }), 1);
  assert.equal(getKeeperCost({ lastYearDraftRound: 12 }), 10);
  assert.equal(getKeeperCost({ lastYearDraftRound: null }), 10);
});

test("keeper optimizer fields compare cost to consensus ADP round", () => {
  assert.deepEqual(getKeeperOptimizerFields({ rank: 24 }, 10), {
    consensusAdpRound: 2,
    keeperValue: 8,
    keeperRating: "5",
    keeperRatingStars: "★★★★★"
  });
});

test("keeper options use end-of-season team ownership and eligibility", () => {
  const teams = [{ id: "team-a", name: "Team A" }];
  const players = [
    { id: "round-one", name: "Round One", position: "RB", nflTeam: "ATL", rank: 1, lastYearDraftRound: 1, endOfSeasonTeamId: "team-a" },
    { id: "round-three", name: "Round Three", position: "WR", nflTeam: "CIN", rank: 25, lastYearDraftRound: 3, endOfSeasonTeamId: "team-a" },
    { id: "not-rostered", name: "Not Rostered", position: "QB", nflTeam: "BUF", rank: 12, lastYearDraftRound: 4 }
  ];

  const options = buildKeeperOptions(players, teams);

  assert.equal(options.length, 2);
  assert.equal(options.find((option) => option.playerId === "round-one").eligible, false);
  assert.equal(options.find((option) => option.playerId === "round-three").keeperCost, 1);
  assert.equal(options.find((option) => option.playerId === "round-three").teamName, "Team A");
});

test("keeper validation reports round conflicts against owned picks", () => {
  const selectedKeepers = [
    { teamId: "team-a", round: 10, playerId: "one" },
    { teamId: "team-a", round: 10, playerId: "two" }
  ];
  const picks = [
    { currentOwnerTeamId: "team-a", round: 10 },
    { currentOwnerTeamId: "team-a", round: 11 }
  ];

  assert.deepEqual(validateKeeperSelections(selectedKeepers, picks), {
    valid: false,
    conflicts: [
      {
        teamId: "team-a",
        round: 10,
        selectedCount: 2,
        availableCount: 1
      }
    ]
  });
});
