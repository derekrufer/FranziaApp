import test from "node:test";
import assert from "node:assert/strict";
import { chooseSimulatorPlayer } from "../src/simulatorEngine.js";

const teamId = "team-a";

function player(id, rank, position) {
  return { id, name: id, rank, position, nflTeam: "FA" };
}

test("simulator delays DST and K when ranked players are available early", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("dst-1", 1, "DST"),
      player("k-1", 2, "K"),
      player("rb-1", 30, "RB")
    ],
    picks: [],
    teamId,
    round: 3,
    strategy: "balanced",
    randomness: "low"
  });

  assert.equal(recommendation.player.id, "rb-1");
});

test("team needs strategy fills missing starters from drafted players and keepers", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("qb-1", 20, "QB"),
      player("wr-1", 21, "WR"),
      player("rb-1", 28, "RB")
    ],
    picks: [
      { currentOwnerTeamId: teamId, player: player("keeper-rb", 80, "RB") },
      { currentOwnerTeamId: teamId, player: player("drafted-rb", 90, "RB") },
      { currentOwnerTeamId: teamId, player: player("drafted-wr-a", 91, "WR") },
      { currentOwnerTeamId: teamId, player: player("drafted-wr-b", 92, "WR") },
      { currentOwnerTeamId: teamId, player: player("drafted-te", 93, "TE") },
      { currentOwnerTeamId: teamId, player: player("drafted-flex-a", 94, "WR") },
      { currentOwnerTeamId: teamId, player: player("drafted-flex-b", 95, "RB") }
    ],
    teamId,
    round: 4,
    strategy: "team_needs",
    randomness: "low"
  });

  assert.equal(recommendation.player.position, "QB");
  assert.match(recommendation.reason, /QB/);
});

test("zero RB avoids early running backs but can take them later", () => {
  const early = chooseSimulatorPlayer({
    availablePlayers: [player("rb-1", 5, "RB"), player("wr-1", 18, "WR")],
    picks: [],
    teamId,
    round: 2,
    strategy: "zero_rb",
    randomness: "low"
  });
  const late = chooseSimulatorPlayer({
    availablePlayers: [player("rb-1", 40, "RB"), player("wr-1", 75, "WR")],
    picks: [],
    teamId,
    round: 8,
    strategy: "zero_rb",
    randomness: "low"
  });

  assert.equal(early.player.position, "WR");
  assert.equal(late.player.position, "RB");
});

test("team needs does not draft an early second QB when a keeper QB already fills the starter", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("qb-2", 12, "QB"),
      player("rb-1", 25, "RB"),
      player("wr-1", 28, "WR"),
      player("te-1", 35, "TE")
    ],
    picks: [
      { currentOwnerTeamId: teamId, player: player("keeper-qb", 4, "QB") }
    ],
    teamId,
    round: 3,
    strategy: "team_needs",
    randomness: "low"
  });

  assert.notEqual(recommendation.player.position, "QB");
  assert.ok(["RB", "WR", "TE"].includes(recommendation.player.position));
});

test("future QB keeper blocks a round two QB recommendation", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("josh-allen", 21, "QB"),
      player("malik-nabers", 22, "WR"),
      player("josh-jacobs", 32, "RB")
    ],
    picks: [
      {
        currentOwnerTeamId: teamId,
        pickType: "keeper",
        round: 5,
        pickNumber: 57,
        player: player("jayden-daniels", 57, "QB")
      }
    ],
    teamId,
    round: 2,
    strategy: "best_available",
    randomness: "low"
  });

  assert.notEqual(recommendation.player.position, "QB");
});

test("three QB keepers hard-cap any later QB recommendation", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("jaxson-dart", 180, "QB"),
      player("rashid-shaheed", 144, "WR")
    ],
    picks: [
      { team: { id: teamId }, pickType: "keeper", round: 7, player: player("drake-maye", 84, "QB") },
      { team: { id: teamId }, pickType: "keeper", round: 8, player: player("caleb-williams", 96, "QB") },
      { team: { id: teamId }, pickType: "keeper", round: 15, player: player("keeper-dart", 180, "QB") }
    ],
    teamId,
    round: 15,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(recommendation.player.position, "WR");
});

test("backup QB is allowed around round nine when flex starters are filled and value is reasonable", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("qb-2", 92, "QB"),
      player("wr-bench", 170, "WR")
    ],
    picks: [
      { currentOwnerTeamId: teamId, player: player("qb-1", 24, "QB") },
      { currentOwnerTeamId: teamId, player: player("rb-1", 31, "RB") },
      { currentOwnerTeamId: teamId, player: player("rb-2", 44, "RB") },
      { currentOwnerTeamId: teamId, player: player("wr-1", 38, "WR") },
      { currentOwnerTeamId: teamId, player: player("wr-2", 45, "WR") },
      { currentOwnerTeamId: teamId, player: player("te-1", 70, "TE") },
      { currentOwnerTeamId: teamId, player: player("flex-1", 81, "RB") },
      { currentOwnerTeamId: teamId, player: player("flex-2", 88, "WR") }
    ],
    teamId,
    round: 9,
    strategy: "team_needs",
    randomness: "low"
  });

  assert.equal(recommendation.player.position, "QB");
});

test("backup QB is blocked before round nine even when value is tempting", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("qb-2", 1, "QB"),
      player("wr-bench", 150, "WR")
    ],
    picks: [
      { currentOwnerTeamId: teamId, player: player("qb-1", 24, "QB") },
      { currentOwnerTeamId: teamId, player: player("rb-1", 31, "RB") },
      { currentOwnerTeamId: teamId, player: player("rb-2", 44, "RB") },
      { currentOwnerTeamId: teamId, player: player("wr-1", 38, "WR") },
      { currentOwnerTeamId: teamId, player: player("wr-2", 45, "WR") },
      { currentOwnerTeamId: teamId, player: player("te-1", 70, "TE") },
      { currentOwnerTeamId: teamId, player: player("flex-1", 81, "RB") },
      { currentOwnerTeamId: teamId, player: player("flex-2", 88, "WR") }
    ],
    teamId,
    round: 8,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(recommendation.player.position, "WR");
});

test("backup TE is allowed around round eight but blocked before then", () => {
  const picks = [
    { currentOwnerTeamId: teamId, player: player("te-1", 30, "TE") },
    { currentOwnerTeamId: teamId, player: player("rb-1", 31, "RB") },
    { currentOwnerTeamId: teamId, player: player("rb-2", 44, "RB") },
    { currentOwnerTeamId: teamId, player: player("wr-1", 38, "WR") },
    { currentOwnerTeamId: teamId, player: player("wr-2", 45, "WR") },
    { currentOwnerTeamId: teamId, player: player("flex-1", 81, "RB") },
    { currentOwnerTeamId: teamId, player: player("flex-2", 88, "WR") }
  ];

  const round7 = chooseSimulatorPlayer({
    availablePlayers: [player("te-2", 1, "TE"), player("wr-bench", 120, "WR")],
    picks,
    teamId,
    round: 7,
    strategy: "best_available",
    randomness: "low"
  });
  const round8 = chooseSimulatorPlayer({
    availablePlayers: [player("te-2", 70, "TE"), player("wr-bench", 170, "WR")],
    picks,
    teamId,
    round: 8,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(round7.player.position, "WR");
  assert.equal(round8.player.position, "TE");
});

test("simulator never recommends a fourth QB", () => {
  const recommendation = chooseSimulatorPlayer({
    availablePlayers: [
      player("qb-4", 1, "QB"),
      player("wr-1", 190, "WR")
    ],
    picks: [
      { currentOwnerTeamId: teamId, player: player("qb-1", 10, "QB") },
      { currentOwnerTeamId: teamId, player: player("qb-2", 50, "QB") },
      { currentOwnerTeamId: teamId, player: player("qb-3", 90, "QB") }
    ],
    teamId,
    round: 16,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(recommendation.player.position, "WR");
});

test("third QB is blocked through round 13 and only allowed from round 14", () => {
  const picks = [
    { currentOwnerTeamId: teamId, player: player("qb-1", 10, "QB") },
    { currentOwnerTeamId: teamId, player: player("qb-2", 70, "QB") },
    { currentOwnerTeamId: teamId, player: player("rb-1", 31, "RB") },
    { currentOwnerTeamId: teamId, player: player("rb-2", 44, "RB") },
    { currentOwnerTeamId: teamId, player: player("wr-1", 38, "WR") },
    { currentOwnerTeamId: teamId, player: player("wr-2", 45, "WR") },
    { currentOwnerTeamId: teamId, player: player("te-1", 70, "TE") },
    { currentOwnerTeamId: teamId, player: player("flex-1", 81, "RB") },
    { currentOwnerTeamId: teamId, player: player("flex-2", 88, "WR") }
  ];

  const round13 = chooseSimulatorPlayer({
    availablePlayers: [player("qb-3", 1, "QB"), player("wr-bench", 180, "WR")],
    picks,
    teamId,
    round: 13,
    strategy: "best_available",
    randomness: "low"
  });
  const round14 = chooseSimulatorPlayer({
    availablePlayers: [player("qb-3", 90, "QB"), player("wr-bench", 180, "WR")],
    picks,
    teamId,
    round: 14,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(round13.player.position, "WR");
  assert.equal(round14.player.position, "QB");
});

test("best available can take a first QB value but respects early second-QB cap", () => {
  const firstQuarterback = chooseSimulatorPlayer({
    availablePlayers: [player("qb-1", 1, "QB"), player("wr-1", 20, "WR")],
    picks: [],
    teamId,
    round: 2,
    strategy: "best_available",
    randomness: "low"
  });
  const secondQuarterback = chooseSimulatorPlayer({
    availablePlayers: [player("qb-2", 8, "QB"), player("wr-1", 30, "WR")],
    picks: [{ currentOwnerTeamId: teamId, player: player("qb-1", 1, "QB") }],
    teamId,
    round: 4,
    strategy: "best_available",
    randomness: "low"
  });

  assert.equal(firstQuarterback.player.position, "QB");
  assert.notEqual(secondQuarterback.player.position, "QB");
});

test("zero RB and WR heavy respect QB caps", () => {
  for (const strategy of ["zero_rb", "wr_heavy"]) {
    const recommendation = chooseSimulatorPlayer({
      availablePlayers: [player("qb-2", 3, "QB"), player("wr-1", 40, "WR")],
      picks: [{ currentOwnerTeamId: teamId, player: player("keeper-qb", 2, "QB") }],
      teamId,
      round: 5,
      strategy,
      randomness: "low"
    });

    assert.notEqual(recommendation.player.position, "QB");
  }
});
