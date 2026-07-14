import { randomUUID } from "node:crypto";

const STARTER_TARGETS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  DST: 1,
  K: 1
};

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const STRATEGIES = new Set(["balanced", "best_available", "rb_heavy", "wr_heavy", "zero_rb", "wait_on_qb", "team_needs"]);
const RANDOMNESS = new Set(["low", "medium", "high"]);
const STARTER_FLEX_TARGET = STARTER_TARGETS.RB + STARTER_TARGETS.WR + STARTER_TARGETS.TE + 2;

function normalizeStrategy(strategy) {
  return STRATEGIES.has(strategy) ? strategy : "balanced";
}

function normalizeRandomness(randomness) {
  return RANDOMNESS.has(randomness) ? randomness : "medium";
}

function seededNoise(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

export function createSimulationSeed() {
  return `${Date.now()}-${randomUUID()}`;
}

export function createTeamPreferences(teamIds = [], seed = createSimulationSeed()) {
  return teamIds.reduce((acc, teamId) => {
    const rbTilt = seededNoise(`${seed}-${teamId}-rb-tilt`) - 0.5;
    const wrTilt = seededNoise(`${seed}-${teamId}-wr-tilt`) - 0.5;
    const qbTiming = seededNoise(`${seed}-${teamId}-qb-timing`) - 0.5;
    const teTiming = seededNoise(`${seed}-${teamId}-te-timing`) - 0.5;
    const riskTolerance = seededNoise(`${seed}-${teamId}-risk`);

    acc[teamId] = {
      positionBias: {
        RB: Math.round(rbTilt * 18),
        WR: Math.round(wrTilt * 18),
        TE: Math.round(teTiming * 10),
        QB: Math.round(qbTiming * 10)
      },
      qbRoundAdjustment: Math.round(qbTiming * 3),
      teRoundAdjustment: Math.round(teTiming * 2),
      riskTolerance
    };
    return acc;
  }, {});
}

function pickBelongsToTeam(pick, teamId) {
  return pick.currentOwnerTeamId === teamId || pick.team?.id === teamId;
}

function draftedForTeam(picks, teamId) {
  return picks
    .filter((pick) => pickBelongsToTeam(pick, teamId) && pick.player)
    .map((pick) => pick.player);
}

function rosterCounts(players) {
  return players.reduce((acc, player) => {
    acc[player.position] = (acc[player.position] ?? 0) + 1;
    return acc;
  }, {});
}

function positionNeed(position, counts) {
  if (position === "DST" || position === "K") {
    return Math.max(0, STARTER_TARGETS[position] - (counts[position] ?? 0));
  }

  if (position === "QB") {
    return Math.max(0, STARTER_TARGETS.QB - (counts.QB ?? 0));
  }

  if (FLEX_POSITIONS.has(position)) {
    const baseNeed = Math.max(0, (STARTER_TARGETS[position] ?? 0) - (counts[position] ?? 0));
    const flexEligibleCount = (counts.RB ?? 0) + (counts.WR ?? 0) + (counts.TE ?? 0);
    const flexNeed = Math.max(0, STARTER_FLEX_TARGET - flexEligibleCount);
    return baseNeed + Math.min(2, flexNeed) * 0.55;
  }

  return 0;
}

function expectedPickRank(round) {
  return Math.max(1, (Number(round) - 1) * 12 + 6);
}

function flexNeedsBadlyUnmet(counts) {
  const rbWrTeCount = (counts.RB ?? 0) + (counts.WR ?? 0) + (counts.TE ?? 0);
  return rbWrTeCount < STARTER_FLEX_TARGET - 1;
}

function isExtremeValue(player, round, counts) {
  const rank = Number(player.rank ?? 9999);
  return rank <= expectedPickRank(round) - 36 && !flexNeedsBadlyUnmet(counts);
}

function shouldSkipCandidate(player, round, counts, strategy, preference = {}) {
  const position = player.position;
  const count = counts[position] ?? 0;
  const qbRoundAdjustment = Number(preference.qbRoundAdjustment ?? 0);
  const teRoundAdjustment = Number(preference.teRoundAdjustment ?? 0);

  if (position === "K" || position === "DST") {
    return count >= 1 || round < 16;
  }
  if (position === "QB") {
    if (count >= 3) {
      return true;
    }
    if (count >= 2 && round < Math.max(14, 14 + qbRoundAdjustment)) {
      return true;
    }
    if (count >= 1 && round < Math.max(9, 9 + qbRoundAdjustment)) {
      return true;
    }
  }
  if (position === "TE") {
    if (count >= 3) {
      return true;
    }
    if (count >= 1 && round < Math.max(8, 8 + teRoundAdjustment)) {
      return true;
    }
  }

  return false;
}

function onesiePenalty(player, round, counts, strategy) {
  const position = player.position;
  const count = counts[position] ?? 0;

  if (position === "QB" && count >= 1) {
    const extreme = isExtremeValue(player, round, counts);
    if (count >= 2) {
      return extreme && round >= 14 ? 45 : 160;
    }
    if (round < 9) {
      return 180;
    }
    if (strategy === "team_needs") {
      return flexNeedsBadlyUnmet(counts) ? (extreme ? 20 : 110) : (extreme ? 8 : 45);
    }
    return extreme ? 8 : 70;
  }

  if (position === "TE" && count >= 1) {
    return isExtremeValue(player, round, counts) ? 12 : 70;
  }

  return 0;
}

function strategyBoost(position, round, strategy, need) {
  const early = round <= 5;
  const mid = round <= 10;

  if (strategy === "best_available") {
    return need * 4;
  }
  if (strategy === "team_needs") {
    return need * 28;
  }
  if (strategy === "rb_heavy" && position === "RB" && mid) {
    return early ? 24 : 14;
  }
  if (strategy === "wr_heavy" && position === "WR" && mid) {
    return early ? 24 : 14;
  }
  if (strategy === "zero_rb") {
    if (position === "RB" && round <= 6) {
      return -35;
    }
    if (position === "RB" && round >= 7) {
      return 42;
    }
    if ((position === "WR" || position === "TE" || position === "QB") && early) {
      return 16;
    }
  }
  if (strategy === "wait_on_qb" && position === "QB" && round <= 8) {
    return need >= 1 && round >= 6 ? -10 : -32;
  }

  return need * 16;
}

function latePositionPenalty(position, round) {
  if (position === "DST" || position === "K") {
    return round >= 15 ? 0 : round >= 12 ? 35 : 120;
  }
  return 0;
}

function randomnessProfile(randomness) {
  return {
    low: { rankVariance: 3, windowSize: 5, temperature: 7, scoreNoise: 2 },
    medium: { rankVariance: 10, windowSize: 10, temperature: 15, scoreNoise: 5 },
    high: { rankVariance: 20, windowSize: 18, temperature: 28, scoreNoise: 10 }
  }[randomness] ?? { rankVariance: 10, windowSize: 10, temperature: 15, scoreNoise: 5 };
}

function weightedPick(candidates, seed, temperature) {
  if (candidates.length <= 1) {
    return candidates[0] ?? null;
  }

  const maxScore = Math.max(...candidates.map((candidate) => candidate.score));
  const weighted = candidates.map((candidate) => ({
    ...candidate,
    weight: Math.exp((candidate.score - maxScore) / temperature)
  }));
  const totalWeight = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  let cursor = seededNoise(seed) * totalWeight;

  for (const candidate of weighted) {
    cursor -= candidate.weight;
    if (cursor <= 0) {
      return candidate;
    }
  }

  return weighted[weighted.length - 1] ?? null;
}

function reasonForPick(player, strategy, need) {
  if (strategy === "zero_rb") {
    return "Strategy: Zero RB";
  }
  if (strategy === "rb_heavy" && player.position === "RB") {
    return "Strategy: RB Heavy";
  }
  if (strategy === "wr_heavy" && player.position === "WR") {
    return "Strategy: WR Heavy";
  }
  if (need > 0.75) {
    return `Best ${player.position} need`;
  }
  return `Top ranked ${player.position}`;
}

export function chooseSimulatorPlayer({
  availablePlayers = [],
  picks = [],
  teamId,
  round = 1,
  pickNumber = 0,
  strategy = "balanced",
  randomness = "medium",
  simulationSeed = createSimulationSeed(),
  teamPreference = {}
}) {
  const normalizedStrategy = normalizeStrategy(strategy);
  const normalizedRandomness = normalizeRandomness(randomness);
  const counts = rosterCounts(draftedForTeam(picks, teamId));
  const profile = randomnessProfile(normalizedRandomness);
  const positionBias = teamPreference.positionBias ?? {};
  const riskWindowBonus = Math.round(Number(teamPreference.riskTolerance ?? 0.5) * 3);

  const scored = availablePlayers
    .filter((player) => player.id && player.rank != null)
    .filter((player) => !shouldSkipCandidate(player, round, counts, normalizedStrategy, teamPreference))
    .map((player) => {
      const baseRank = Number(player.rank ?? 320);
      const rankNoise = (seededNoise(`${simulationSeed}-${teamId}-${pickNumber}-${player.id}-rank`) - 0.5) * profile.rankVariance * 2;
      const effectiveRank = Math.max(1, baseRank + rankNoise);
      const rankScore = Math.max(0, 320 - effectiveRank);
      const need = positionNeed(player.position, counts);
      const randomScore = (seededNoise(`${simulationSeed}-${teamId}-${pickNumber}-${player.id}-score`) - 0.5) * profile.scoreNoise * 2;
      const preferenceBoost = Number(positionBias[player.position] ?? 0);
      const score =
        rankScore
        + strategyBoost(player.position, round, normalizedStrategy, need)
        + preferenceBoost
        - latePositionPenalty(player.position, round)
        - onesiePenalty(player, round, counts, normalizedStrategy)
        + randomScore;

      return {
        player,
        score,
        baseRank,
        effectiveRank,
        randomScore,
        preferenceBoost,
        reason: reasonForPick(player, normalizedStrategy, need)
      };
    })
    .sort((a, b) => b.score - a.score || (a.player.rank ?? 9999) - (b.player.rank ?? 9999));

  const candidateWindow = scored.slice(0, Math.min(scored.length, profile.windowSize + riskWindowBonus));
  return weightedPick(candidateWindow, `${simulationSeed}-${teamId}-${pickNumber}-choice`, profile.temperature);
}
