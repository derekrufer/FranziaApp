export function getKeeperCost(player) {
  if (player.lastYearDraftRound == null) {
    return 10;
  }

  if (player.lastYearDraftRound <= 2) {
    return null;
  }

  return Math.max(1, player.lastYearDraftRound - 2);
}

export function getConsensusAdpRound(player) {
  if (player.consensusAdpRound != null) {
    return player.consensusAdpRound;
  }

  if (player.rank == null) {
    return null;
  }

  return Math.ceil(Number(player.rank) / 12);
}

export function getKeeperRating(value) {
  if (value == null) {
    return {
      keeperRating: "Unrated",
      keeperRatingStars: "Unrated"
    };
  }

  if (value >= 8) {
    return {
      keeperRating: "5",
      keeperRatingStars: "★★★★★"
    };
  }

  if (value >= 5) {
    return {
      keeperRating: "4",
      keeperRatingStars: "★★★★☆"
    };
  }

  if (value >= 2) {
    return {
      keeperRating: "3",
      keeperRatingStars: "★★★☆☆"
    };
  }

  if (value >= 0) {
    return {
      keeperRating: "2",
      keeperRatingStars: "★★☆☆☆"
    };
  }

  return {
    keeperRating: "1",
    keeperRatingStars: "★☆☆☆☆"
  };
}

export function getKeeperOptimizerFields(player, keeperCost = getKeeperCost(player)) {
  const consensusAdpRound = getConsensusAdpRound(player);
  const keeperValue = keeperCost != null && consensusAdpRound != null
    ? keeperCost - consensusAdpRound
    : null;
  const rating = getKeeperRating(keeperValue);

  return {
    consensusAdpRound,
    keeperValue,
    ...rating
  };
}

export function isKeeperEligible(player) {
  return getKeeperCost(player) != null;
}

export function buildKeeperOptions(players, teams) {
  const teamById = new Map(teams.map((team) => [team.id, team]));

  return players
    .filter((player) => player.endOfSeasonTeamId)
    .map((player) => {
      const keeperCost = getKeeperCost(player);
      const team = teamById.get(player.endOfSeasonTeamId);
      const optimizerFields = getKeeperOptimizerFields(player, keeperCost);

      return {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        rank: player.rank,
        teamId: team?.id,
        teamName: team?.name,
        lastYearDraftRound: player.lastYearDraftRound,
        originalDraftTeamId: player.originalDraftTeamId,
        keeperCost,
        ...optimizerFields,
        eligible: keeperCost != null
      };
    });
}

export function validateKeeperSelections(selectedKeepers, picks) {
  const ownedPicksByTeamRound = picks.reduce((acc, pick) => {
    const key = `${pick.currentOwnerTeamId}:${pick.round}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  const selectedByTeamRound = selectedKeepers.reduce((acc, keeper) => {
    const key = `${keeper.teamId}:${keeper.round}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  const conflicts = [];
  for (const [key, selectedCount] of selectedByTeamRound.entries()) {
    const availableCount = ownedPicksByTeamRound.get(key) ?? 0;
    if (selectedCount > availableCount) {
      const [teamId, round] = key.split(":");
      conflicts.push({
        teamId,
        round: Number(round),
        selectedCount,
        availableCount
      });
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts
  };
}
