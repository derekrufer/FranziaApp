import { buildKeeperOptions, validateKeeperSelections } from "./keeperEngine.js";
import { players, teams } from "./seedData.js";

const ROUND_COUNT = 19;

function buildDraftPicks() {
  const picks = [];
  let pickNumber = 1;

  for (let round = 1; round <= ROUND_COUNT; round += 1) {
    for (const team of teams) {
      picks.push({
        id: `${round}-${team.id}`,
        draftId: "2026-main",
        round,
        pickNumber,
        originalTeamId: team.id,
        currentOwnerTeamId: team.id,
        playerId: null,
        pickType: "open"
      });
      pickNumber += 1;
    }
  }

  return picks;
}

function getDefaultKeepers() {
  const options = buildKeeperOptions(players, teams);
  const keepers = [
    "devon-achane",
    "jalen-hurts",
    "chase-brown",
    "rashee-rice",
    "tucker-kraft",
    "amon-ra-st-brown",
    "nico-collins"
  ];

  return keepers
    .map((playerId) => options.find((option) => option.playerId === playerId))
    .filter((option) => option?.eligible)
    .map((option) => ({
      playerId: option.playerId,
      teamId: option.teamId,
      round: option.keeperCost
    }));
}

function placeKeepersOnBoard(picks, selectedKeepers) {
  for (const keeper of selectedKeepers) {
    const pick = picks.find(
      (candidate) =>
        candidate.round === keeper.round &&
        candidate.currentOwnerTeamId === keeper.teamId &&
        candidate.playerId == null
    );

    if (pick) {
      pick.playerId = keeper.playerId;
      pick.pickType = "keeper";
    }
  }
}

const draftPicks = buildDraftPicks();
const selectedKeepers = getDefaultKeepers();
placeKeepersOnBoard(draftPicks, selectedKeepers);

function hydratePick(pick) {
  const team = teams.find((candidate) => candidate.id === pick.currentOwnerTeamId);
  const player = players.find((candidate) => candidate.id === pick.playerId);

  return {
    ...pick,
    team,
    player
  };
}

export function getDraftState() {
  const draftedPlayerIds = new Set(draftPicks.filter((pick) => pick.playerId).map((pick) => pick.playerId));
  const keeperOptions = buildKeeperOptions(players, teams);

  return {
    draft: {
      id: "2026-main",
      name: "RotoBaller Keeper Draft",
      roundCount: ROUND_COUNT,
      status: "live"
    },
    teams,
    players,
    keeperOptions,
    selectedKeepers,
    keeperValidation: validateKeeperSelections(selectedKeepers, draftPicks),
    picks: draftPicks.map(hydratePick),
    availablePlayers: players
      .filter((player) => !draftedPlayerIds.has(player.id))
      .sort((a, b) => a.rank - b.rank),
    currentPick: draftPicks.find((pick) => pick.playerId == null) ?? null
  };
}

export function makePick({ pickId, playerId, teamId }) {
  const pick = draftPicks.find((candidate) => candidate.id === pickId);
  if (!pick) {
    throw new Error("Pick not found.");
  }

  if (pick.playerId) {
    throw new Error("This pick has already been used.");
  }

  if (pick.currentOwnerTeamId !== teamId) {
    throw new Error("Only the team on the clock can make this pick.");
  }

  const playerAlreadyDrafted = draftPicks.some((candidate) => candidate.playerId === playerId);
  if (playerAlreadyDrafted) {
    throw new Error("That player is already drafted or kept.");
  }

  const player = players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player not found.");
  }

  pick.playerId = playerId;
  pick.pickType = "drafted";

  return getDraftState();
}

export function undoLastPick() {
  const draftedPicks = draftPicks
    .filter((pick) => pick.pickType === "drafted" && pick.playerId)
    .sort((a, b) => b.pickNumber - a.pickNumber);

  const lastPick = draftedPicks[0];
  if (!lastPick) {
    throw new Error("There is no drafted pick to undo.");
  }

  lastPick.playerId = null;
  lastPick.pickType = "open";

  return getDraftState();
}

export function resetDraftedPicks() {
  for (const pick of draftPicks) {
    if (pick.pickType === "drafted") {
      pick.playerId = null;
      pick.pickType = "open";
    }
  }

  return getDraftState();
}
