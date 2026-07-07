import React, { useEffect, useMemo, useState } from "react";
import { saveKeeperSelections } from "../../api.js";
import { positionClass } from "../../shared/helpers.js";

function projectKeeperPicks(selectedPlayerIds, keepers, ownedPicksByRound) {
  const projectedPicks = new Map();

  for (const playerId of selectedPlayerIds) {
    const keeper = keepers.find((candidate) => candidate.playerId === playerId);
    if (!keeper?.keeperCost) {
      continue;
    }

    for (let round = keeper.keeperCost; round >= 1; round -= 1) {
      const availablePicks = ownedPicksByRound.get(round) ?? [];
      const projectedPick = availablePicks.shift();
      if (projectedPick) {
        projectedPicks.set(playerId, projectedPick);
        break;
      }
    }

    if (!projectedPicks.has(playerId)) {
      projectedPicks.set(playerId, null);
    }
  }

  return projectedPicks;
}

export function KeepersPage({ teams, keeperOptions, selectedKeepers, players, picks, draft, draftSeason, canManageKeepers, currentUserTeamId, auditActor, onSaved }) {
  const [selectedKeeperTeamId, setSelectedKeeperTeamId] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
  const [pendingKeeperTeamId, setPendingKeeperTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!teams.length) {
      return;
    }

    const selectedTeamExists = teams.some((team) => team.id === selectedKeeperTeamId);
    if (!selectedTeamExists) {
      setSelectedKeeperTeamId(teams[0].id);
    }
  }, [selectedKeeperTeamId, teams]);

  const keepers = useMemo(() => {
    return keeperOptions
      .filter((keeper) => keeper.teamId === selectedKeeperTeamId)
      .slice()
      .sort((a, b) => {
        const aCost = a.keeperCost ?? 999;
        const bCost = b.keeperCost ?? 999;
        return aCost - bCost || a.playerName.localeCompare(b.playerName);
      });
  }, [keeperOptions, selectedKeeperTeamId]);
  const positionalRanks = useMemo(() => {
    const ranks = {};
    for (const player of players.slice().sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))) {
      if (!player.position || player.rank == null) {
        continue;
      }
      ranks[player.position] = (ranks[player.position] ?? 0) + 1;
      ranks[player.id] = `${player.position}${ranks[player.position]}`;
    }
    return ranks;
  }, [players]);
  const playerById = useMemo(() => {
    return players.reduce((acc, player) => {
      acc[player.id] = player;
      return acc;
    }, {});
  }, [players]);
  const hasFullRoster = keepers.length === 19;
  const selectedTeamKeepers = useMemo(
    () => selectedKeepers.filter((keeper) => keeper.teamId === selectedKeeperTeamId).map((keeper) => keeper.playerId),
    [selectedKeeperTeamId, selectedKeepers]
  );
  const ownedPicksByRound = useMemo(() => {
    return picks.reduce((acc, pick) => {
      if (pick.currentOwnerTeamId !== selectedKeeperTeamId || pick.pickType === "drafted") {
        return acc;
      }

      if (!acc.has(pick.round)) {
        acc.set(pick.round, []);
      }
      acc.get(pick.round).push({
        round: pick.round,
        pickNumber: pick.pickNumber
      });
      return acc;
    }, new Map());
  }, [picks, selectedKeeperTeamId]);
  for (const roundPicks of ownedPicksByRound.values()) {
    roundPicks.sort((a, b) => b.pickNumber - a.pickNumber);
  }
  const hasUnsavedKeeperChanges =
    selectedPlayerIds.length !== selectedTeamKeepers.length ||
    selectedPlayerIds.some((playerId, index) => playerId !== selectedTeamKeepers[index]);
  const projectedKeeperPicks = useMemo(
    () => projectKeeperPicks(selectedPlayerIds, keepers, new Map(Array.from(ownedPicksByRound, ([round, roundPicks]) => [round, roundPicks.slice()]))),
    [selectedPlayerIds, keepers, ownedPicksByRound]
  );
  const hasInvalidProjection = Array.from(projectedKeeperPicks.values()).some((pick) => !pick);
  const keeperLocked = Boolean(draft?.keeperLocked);
  const ownsSelectedKeeperTeam = currentUserTeamId && currentUserTeamId === selectedKeeperTeamId;
  const canEditSelectedTeam = canManageKeepers || ownsSelectedKeeperTeam;
  const canOverrideKeeperLock = canManageKeepers;
  const canEditKeepers = canEditSelectedTeam && (!keeperLocked || canOverrideKeeperLock);

  useEffect(() => {
    setSelectedPlayerIds(selectedTeamKeepers);
    setMessage("");
  }, [selectedTeamKeepers]);

  function toggleKeeper(playerId) {
    if (!canEditKeepers) {
      return;
    }

    setSelectedPlayerIds((currentIds) =>
      currentIds.includes(playerId)
        ? currentIds.filter((currentId) => currentId !== playerId)
        : [...currentIds, playerId]
    );
  }

  function handleKeeperTeamChange(nextTeamId) {
    if (nextTeamId === selectedKeeperTeamId) {
      return;
    }

    if (hasUnsavedKeeperChanges) {
      setPendingKeeperTeamId(nextTeamId);
      setMessage("");
      return;
    }

    setPendingKeeperTeamId("");
    setSelectedKeeperTeamId(nextTeamId);
  }

  function discardKeeperChanges() {
    if (pendingKeeperTeamId) {
      setSelectedKeeperTeamId(pendingKeeperTeamId);
      setPendingKeeperTeamId("");
      return;
    }

    setSelectedPlayerIds(selectedTeamKeepers);
  }

  async function handleSaveKeepers(nextTeamId = "") {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveKeeperSelections(selectedKeeperTeamId, selectedPlayerIds, draftSeason, auditActor, {
        commissionerOverride: keeperLocked && canOverrideKeeperLock
      });
      setMessage(`Saved ${result.count} keeper selections.`);
      onSaved(result.state);
      if (nextTeamId) {
        setSelectedKeeperTeamId(nextTeamId);
        setPendingKeeperTeamId("");
      }
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="keepers-page">
      <div className="keeper-toolbar">
        <div>
          <p className="eyebrow">End of Season Roster</p>
          <h2>Potential Keepers</h2>
          <small className={hasFullRoster ? "keeper-count complete" : "keeper-count incomplete"}>
            {keepers.length} of 19 players listed
          </small>
          <small className="keeper-selection-count">
            {selectedPlayerIds.length} selected
          </small>
          {draft?.keeperLockDeadline && (
            <small className={`keeper-selection-count ${keeperLocked ? "locked" : ""}`}>
              {keeperLocked ? "Locked" : "Locks"} {new Date(draft.keeperLockDeadline).toLocaleString()}
            </small>
          )}
        </div>
        <div className="keeper-actions">
          <label>
            Fantasy Team
            <select value={selectedKeeperTeamId} onChange={(event) => handleKeeperTeamChange(event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <button className="primary-action" disabled={saving || !selectedKeeperTeamId || hasInvalidProjection || !canEditKeepers} onClick={() => handleSaveKeepers()}>
            {saving ? "Saving..." : keeperLocked && canOverrideKeeperLock ? "Override Lock and Save" : "Save Keepers"}
          </button>
        </div>
      </div>

      {keeperLocked && !canOverrideKeeperLock && (
        <div className="keeper-warning">
          Keeper selections are locked for this draft season. Ask a commissioner to make an override change.
        </div>
      )}
      {!canEditSelectedTeam && (
        <div className="keeper-warning">
          Viewing only. You can review other teams&apos; keepers, but only accounts with Manage Keepers permission can edit any team.
        </div>
      )}
      {keeperLocked && canOverrideKeeperLock && (
        <div className="keeper-warning">
          Keeper selections are locked. Saving with Manage Keepers permission will be recorded as an override.
        </div>
      )}

      {pendingKeeperTeamId && (
        <div className="keeper-warning keeper-unsaved-warning">
          <span>Save keeper changes before switching teams?</span>
          <div className="keeper-warning-actions">
            <button className="primary-action" disabled={saving || hasInvalidProjection || !canEditKeepers} onClick={() => handleSaveKeepers(pendingKeeperTeamId)}>
              Save and Switch
            </button>
            <button className="secondary-action" disabled={saving} onClick={discardKeeperChanges}>
              Discard Changes
            </button>
          </div>
        </div>
      )}

      {hasInvalidProjection && (
        <div className="keeper-warning">
          One or more selected keepers cannot be assigned because this team has no available pick in that round or an earlier round.
        </div>
      )}
      {message && <div className="import-message">{message}</div>}

      <div className="keeper-list">
        <div className="keeper-list-header">
          <span>Keep</span>
          <span>Player</span>
          <span>Rank</span>
          <span>Pos</span>
          <span>NFL</span>
          <span>Drafted</span>
          <span>Cost</span>
          <span>Status</span>
        </div>
        {keepers.map((keeper) => (
          <div className={`keeper-row ${positionClass(keeper.position)} ${keeper.eligible ? "" : "ineligible"}`} key={keeper.playerId}>
            <label className="keeper-check">
              <input
                type="checkbox"
                checked={selectedPlayerIds.includes(keeper.playerId)}
                disabled={!keeper.eligible || !canEditKeepers}
                onChange={() => toggleKeeper(keeper.playerId)}
              />
            </label>
            <strong>{keeper.playerName}</strong>
            <span>
              {(keeper.rank ?? playerById[keeper.playerId]?.rank)
                ? `OVR ${keeper.rank ?? playerById[keeper.playerId]?.rank}, ${positionalRanks[keeper.playerId] ?? keeper.position}`
                : "N/A"}
            </span>
            <span>{keeper.position}</span>
            <span>{keeper.nflTeam}</span>
            <span>{keeper.lastYearDraftRound ? `Round ${keeper.lastYearDraftRound}` : "Waiver"}</span>
            <span>
              {projectedKeeperPicks.has(keeper.playerId)
                ? projectedKeeperPicks.get(keeper.playerId)
                  ? `Round ${projectedKeeperPicks.get(keeper.playerId).round}, Pick ${projectedKeeperPicks.get(keeper.playerId).pickNumber}${projectedKeeperPicks.get(keeper.playerId).round !== keeper.keeperCost ? ` (from ${keeper.keeperCost})` : ""}`
                  : "No pick"
                : keeper.keeperCost ? `Round ${keeper.keeperCost}` : "N/A"}
            </span>
            <span>{selectedPlayerIds.includes(keeper.playerId) ? "Selected" : keeper.eligible ? "Available" : "Not eligible"}</span>
          </div>
        ))}
        {keepers.length === 0 && (
          <div className="keeper-empty">
            No end-of-season roster players found for this team.
          </div>
        )}
      </div>
    </section>
  );
}
