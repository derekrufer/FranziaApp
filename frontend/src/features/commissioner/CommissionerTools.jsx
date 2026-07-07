import React, { useEffect, useMemo, useState } from "react";
import { Database, FileUp, RotateCcw } from "lucide-react";
import {
  approvePlayerMatch,
  createAccount,
  editPick,
  fetchAccounts,
  fetchAuditLog,
  fetchFleaflickerSyncStatus,
  fetchPlayerMatchingReview,
  finalizeDraft,
  importCsv,
  rejectPlayerMatch,
  resetAccountPassword,
  resetDraft,
  saveDraftOrder,
  saveKeeperDeadline,
  syncFleaflickerRosters,
  syncFleaflickerSetup,
  syncFleaflickerTradedPicks,
  updateAccount
} from "../../api.js";
import { ACCOUNT_PERMISSIONS, IMPORTS } from "../../shared/constants.js";

export function CommissionerImports({ database, draftSeason, canManageRankings, auditActor, onImported }) {
  const [busyType, setBusyType] = useState("");
  const [message, setMessage] = useState("");
  const [draftRoundPreview, setDraftRoundPreview] = useState([]);
  const [draftRoundWarnings, setDraftRoundWarnings] = useState([]);

  async function handleFile(type, file) {
    if (!file) {
      return;
    }

    setBusyType(type);
    setMessage("");
    try {
      const csv = await file.text();
      const result = await importCsv(type, csv, draftSeason, auditActor);
      if (type === "players") {
        setMessage(`Saved ${result.count} player rankings to PostgreSQL.`);
        setDraftRoundPreview([]);
        setDraftRoundWarnings([]);
      } else if (type === "last-year-draft-rounds") {
        setDraftRoundPreview(result.preview ?? []);
        setDraftRoundWarnings(result.warnings ?? []);
        setMessage(`Imported ${result.count} last-year draft round rows for keeper-cost calculations.`);
      } else {
        setMessage(`Imported ${result.count} rows into ${type}.`);
      }
      onImported(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyType("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Commissioner</p>
          <h2>Upload League Data</h2>
        </div>
        <Database size={20} />
      </div>

      <div className={`database-status ${database?.connected ? "connected" : "offline"}`}>
        <span>{database?.connected ? "PostgreSQL connected" : "Using demo memory data"}</span>
        {!database?.connected && <small>{database?.error ?? "Start Postgres to enable imports."}</small>}
      </div>

      <div className="import-grid">
        {IMPORTS.map((item) => (
          <label className="import-tile" key={item.type}>
            <span className="import-title">
              <FileUp size={17} />
              {item.label}
            </span>
            <small>{item.columns}</small>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!database?.connected || !canManageRankings || busyType === item.type}
              onChange={(event) => handleFile(item.type, event.target.files?.[0])}
            />
          </label>
        ))}
      </div>

      {!canManageRankings && <div className="import-message">Log in with Manage Rankings permission to update rankings or source data.</div>}
      {message && <div className="import-message">{message}</div>}
      {draftRoundWarnings.length > 0 && (
        <div className="import-message warning-message">
          <strong>Validation warnings</strong>
          {draftRoundWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}
      {draftRoundPreview.length > 0 && (
        <div className="import-preview">
          <div className="import-preview-heading">
            <strong>Last Year Draft Rounds Preview</strong>
            <span>Used only for keeper cost. Team ownership comes from end-of-season rosters.</span>
          </div>
          <div className="import-preview-table">
            <div className="import-preview-row header">
              <span>Round</span>
              <span>Player</span>
              <span>Pos</span>
              <span>NFL</span>
              <span>Bye</span>
            </div>
            {draftRoundPreview.map((row, index) => (
              <div className="import-preview-row" key={`${row.round}-${row.playerName}-${index}`}>
                <span>{row.round}</span>
                <span>{row.playerName}</span>
                <span>{row.position}</span>
                <span>{row.nflTeam}</span>
                <span>{row.byeWeek ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function DraftOrderEditor({ teams, database, draftSeason, canManageDraft, onSaved }) {
  const [orderedTeams, setOrderedTeams] = useState(teams);
  const [draggedTeamId, setDraggedTeamId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOrderedTeams(teams);
  }, [teams]);

  function moveTeam(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }

    setOrderedTeams((currentTeams) => {
      const nextTeams = currentTeams.slice();
      const [movedTeam] = nextTeams.splice(fromIndex, 1);
      nextTeams.splice(toIndex, 0, movedTeam);
      return nextTeams;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveDraftOrder(orderedTeams.map((team) => team.id), draftSeason);
      setMessage("Draft order saved.");
      onSaved(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Commissioner</p>
          <h2>Draft Order</h2>
        </div>
      </div>

      <div className="draft-order-list">
        {orderedTeams.map((team, index) => (
          <div
            className={`draft-order-row ${draggedTeamId === team.id ? "dragging" : ""}`}
            draggable={database?.connected && canManageDraft}
            key={team.id}
            onDragStart={() => setDraggedTeamId(team.id)}
            onDragEnd={() => setDraggedTeamId("")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const fromIndex = orderedTeams.findIndex((candidate) => candidate.id === draggedTeamId);
              moveTeam(fromIndex, index);
              setDraggedTeamId("");
            }}
          >
            <span className="draft-order-position">{index + 1}</span>
            <strong>{team.name}</strong>
          </div>
        ))}
      </div>

      <div className="commissioner-actions">
        <button className="primary-action" disabled={!database?.connected || !canManageDraft || saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save Draft Order"}
        </button>
      </div>

      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to adjust draft order.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function syncTypeLabel(syncType) {
  return syncType === "traded_picks" ? "Traded Picks" : "Rosters";
}

export function FleaflickerSetupSync({ database, draftSeason, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced, refreshKey }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [season, setSeason] = useState(String(draftSeason - 1));
  const [scoringPeriod, setScoringPeriod] = useState("18");
  const [pickSeason, setPickSeason] = useState(String(draftSeason));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState([]);

  useEffect(() => {
    setSeason(String(draftSeason - 1));
    setPickSeason(String(draftSeason));
  }, [draftSeason]);

  async function loadSyncStatus() {
    if (!database?.connected || !canSyncFleaflicker) {
      setSyncStatus([]);
      return;
    }

    try {
      setSyncStatus(await fetchFleaflickerSyncStatus(draftSeason));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    }
  }

  useEffect(() => {
    loadSyncStatus();
  }, [database?.connected, canSyncFleaflicker, draftSeason, refreshKey]);

  async function handleSyncAll() {
    setSyncing(true);
    setMessage("");
    try {
      const result = await syncFleaflickerSetup({
        leagueId: Number(leagueId),
        season: Number(season),
        scoringPeriod: Number(scoringPeriod),
        pickSeason: Number(pickSeason),
        draftSeason,
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      onSynced(result.state);
      await loadSyncStatus();
      const rosterText = result.rosters?.ok ? "rosters synced" : `rosters failed: ${result.rosters?.error}`;
      const picksText = result.tradedPicks?.ok ? "traded picks synced" : `traded picks failed: ${result.tradedPicks?.error}`;
      const seedText = result.seededDraftSource?.skipped
        ? "draft source seed skipped"
        : `${result.seededDraftSource?.count ?? 0} keeper-source picks seeded`;
      setMessage(`Setup sync complete: ${rosterText}; ${picksText}; ${seedText}.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>Setup Sync</h2>
        </div>
      </div>
      <div className="fleaflicker-setup-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Roster Season
          <input value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <label>
          Week
          <input value={scoringPeriod} onChange={(event) => setScoringPeriod(event.target.value)} />
        </label>
        <label>
          Pick Season
          <input value={pickSeason} onChange={(event) => setPickSeason(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSyncAll}>
          {syncing ? "Syncing..." : "Sync All Setup Data"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to run setup sync.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="sync-status-grid">
        {["rosters", "traded_picks"].map((syncType) => {
          const item = syncStatus.find((candidate) => candidate.syncType === syncType);
          return (
            <div className={`sync-status-card ${item?.status ?? ""}`} key={syncType}>
              <strong>{syncTypeLabel(syncType)}</strong>
              {item ? (
                <>
                  <span>{item.status === "success" ? "Success" : "Error"} at {new Date(item.finishedAt).toLocaleString()}</span>
                  <small>{item.status === "success" ? syncStatusSummary(item) : item.errorMessage}</small>
                </>
              ) : (
                <span>No sync recorded for {draftSeason}.</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function syncStatusSummary(item) {
  const result = item.result ?? {};
  if (item.syncType === "rosters") {
    return `${result.count ?? 0} players, ${result.teamCount ?? 0} teams`;
  }
  if (item.syncType === "traded_picks") {
    return `${result.count ?? 0} traded picks`;
  }
  return "";
}

export function FleaflickerRosterSync({ database, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [season, setSeason] = useState("2025");
  const [scoringPeriod, setScoringPeriod] = useState("18");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [rosterCounts, setRosterCounts] = useState([]);

  async function handleSync() {
    setSyncing(true);
    setMessage("");
    setRosterCounts([]);
    try {
      const result = await syncFleaflickerRosters({
        leagueId: Number(leagueId),
        season: Number(season),
        scoringPeriod: Number(scoringPeriod),
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      setMessage(`Synced ${result.count} roster players from Fleaflicker for the ${result.draftSeason} draft.`);
      setRosterCounts(result.rosterCounts ?? []);
      onSynced(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>End of Season Rosters</h2>
        </div>
      </div>

      <div className="fleaflicker-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Season
          <input value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <label>
          Week
          <input value={scoringPeriod} onChange={(event) => setScoringPeriod(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSync}>
          {syncing ? "Syncing..." : "Sync Rosters"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to sync rosters.</div>}
      {message && <div className="import-message">{message}</div>}
      {rosterCounts.length > 0 && (
        <div className="roster-count-grid">
          {rosterCounts.map((item) => (
            <div className={`roster-count-tile ${item.count === 19 ? "complete" : "incomplete"}`} key={item.teamName}>
              <strong>{item.teamName}</strong>
              <span>{item.count} of 19</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function FleaflickerPickSync({ database, canSyncFleaflicker, auditActor, onDraftSeasonChange, onSynced }) {
  const [leagueId, setLeagueId] = useState("164549");
  const [standingsSeason, setStandingsSeason] = useState("2025");
  const [pickSeason, setPickSeason] = useState("2026");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [tradedPicks, setTradedPicks] = useState([]);

  async function handleSync() {
    setSyncing(true);
    setMessage("");
    setTradedPicks([]);
    try {
      const result = await syncFleaflickerTradedPicks({
        leagueId: Number(leagueId),
        standingsSeason: Number(standingsSeason),
        pickSeason: Number(pickSeason),
        ...auditActor
      });
      onDraftSeasonChange(result.draftSeason);
      setMessage(`Synced ${result.count} traded picks from Fleaflicker.`);
      setTradedPicks(result.tradedPicks ?? []);
      onSynced(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fleaflicker</p>
          <h2>Traded Draft Picks</h2>
        </div>
      </div>

      <div className="fleaflicker-controls">
        <label>
          League ID
          <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} />
        </label>
        <label>
          Standings Season
          <input value={standingsSeason} onChange={(event) => setStandingsSeason(event.target.value)} />
        </label>
        <label>
          Pick Season
          <input value={pickSeason} onChange={(event) => setPickSeason(event.target.value)} />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canSyncFleaflicker || syncing} onClick={handleSync}>
          {syncing ? "Syncing..." : "Sync Traded Picks"}
        </button>
      </div>

      {!canSyncFleaflicker && <div className="import-message">Log in with Sync Fleaflicker permission to sync traded picks.</div>}
      {message && <div className="import-message">{message}</div>}
      {tradedPicks.length > 0 && (
        <div className="traded-pick-list">
          {tradedPicks.map((pick) => (
            <div className="traded-pick-row" key={`${pick.round}-${pick.originalOwner}-${pick.ownedBy}`}>
              <strong>Round {pick.round}</strong>
              <span>{`${pick.originalOwner} -> ${pick.ownedBy}`}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}


function chooseDefaultMatchTarget(players) {
  return players
    .slice()
    .sort((a, b) => {
      const rankCompare = (a.rank == null ? 1 : 0) - (b.rank == null ? 1 : 0);
      return rankCompare || (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name);
    })[0]?.id;
}

export function PlayerMatchingReview({ database, draftSeason, canManageRankings, auditActor, onStateChanged }) {
  const [conflicts, setConflicts] = useState([]);
  const [targetByConflict, setTargetByConflict] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");

  async function loadConflicts() {
    if (!database?.connected) {
      setConflicts([]);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const review = await fetchPlayerMatchingReview();
      setConflicts(review);
      setTargetByConflict(review.reduce((acc, conflict) => {
        acc[conflict.playerIdSet] = chooseDefaultMatchTarget(conflict.players);
        return acc;
      }, {}));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(conflict) {
    const targetPlayerId = targetByConflict[conflict.playerIdSet] ?? chooseDefaultMatchTarget(conflict.players);
    const sourcePlayerIds = conflict.players.map((player) => player.id).filter((playerId) => playerId !== targetPlayerId);
    setBusyKey(conflict.playerIdSet);
    setMessage("");
    try {
      const result = await approvePlayerMatch({
        normalizedName: conflict.normalizedName,
        targetPlayerId,
        sourcePlayerIds,
        draftSeason,
        ...auditActor
      });
      setConflicts(result.review ?? []);
      if (result.state) {
        onStateChanged(result.state);
      }
      setMessage(`Approved match and merged ${result.mergedCount} player record${result.mergedCount === 1 ? "" : "s"}.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyKey("");
    }
  }

  async function handleReject(conflict) {
    setBusyKey(conflict.playerIdSet);
    setMessage("");
    try {
      const result = await rejectPlayerMatch({
        normalizedName: conflict.normalizedName,
        playerIds: conflict.players.map((player) => player.id),
        draftSeason,
        ...auditActor
      });
      setConflicts(result.review ?? []);
      if (result.state) {
        onStateChanged(result.state);
      }
      setMessage("Rejected match. It will no longer appear in this review.");
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Player Matching</p>
          <h2>Name Review</h2>
        </div>
        <button className="primary-action compact-action" disabled={!database?.connected || !canManageRankings || loading} onClick={loadConflicts}>
          {loading ? "Checking..." : "Run Name Review"}
        </button>
      </div>
      <p className="panel-note">
        Reviews players whose names normalize to the same value after suffixes like Jr. or III are removed. Approving merges the records into the selected target.
      </p>
      {!canManageRankings && <div className="import-message">Log in with Manage Rankings permission to approve or reject player matches.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="matching-review-list">
        {conflicts.map((conflict) => (
          <div className="matching-review-row" key={conflict.normalizedName}>
            <strong>{conflict.normalizedName}</strong>
            <div>
              <div className="matching-player-options">
                {conflict.players.map((player) => (
                  <label key={player.id}>
                    <input
                      type="radio"
                      name={`match-target-${conflict.playerIdSet}`}
                      checked={(targetByConflict[conflict.playerIdSet] ?? chooseDefaultMatchTarget(conflict.players)) === player.id}
                      disabled={!canManageRankings || busyKey === conflict.playerIdSet}
                      onChange={() => setTargetByConflict((current) => ({ ...current, [conflict.playerIdSet]: player.id }))}
                    />
                    <span>{player.name} - {player.position} - {player.nflTeam} - Rank {player.rank ?? "N/A"}{player.externalId ? ` - ${player.externalId}` : ""}</span>
                  </label>
                ))}
              </div>
              <div className="matching-actions">
                <button className="primary-action compact-action" disabled={!canManageRankings || busyKey === conflict.playerIdSet} onClick={() => handleApprove(conflict)}>
                  {busyKey === conflict.playerIdSet ? "Working..." : "Approve Match"}
                </button>
                <button className="secondary-action compact-action" disabled={!canManageRankings || busyKey === conflict.playerIdSet} onClick={() => handleReject(conflict)}>
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
        {database?.connected && conflicts.length === 0 && !loading && message && (
          <div className="audit-empty">No suffix/name conflicts found.</div>
        )}
      </div>
    </section>
  );
}

export function DraftResetPanel({ database, draftSeason, picks, draftMode, mockLobbyTeamId, canManageDraft, auditActor, onReset }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const draftedCount = picks.filter((pick) => pick.pickType === "drafted").length;
  const canReset = draftMode === "mock" ? Boolean(mockLobbyTeamId) : canManageDraft;

  async function handleReset() {
    if (!confirming) {
      setConfirming(true);
      setMessage("");
      return;
    }

    setResetting(true);
    setMessage("");
    try {
      const nextState = await resetDraft(draftSeason, auditActor, { mockLobbyTeamId });
      setMessage("Draft reset. Keepers stayed on the board and drafted players returned to the available pool.");
      setConfirming(false);
      onReset(nextState);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Mock Draft</p>
          <h2>Reset Draft Board</h2>
        </div>
        <RotateCcw size={20} />
      </div>
      <p className="panel-note">
        Clears {draftedCount} drafted picks while keeping selected keepers, draft order, traded picks, and player data. In Mock Draft mode, any team account can reset its own lobby.
      </p>
      <div className="commissioner-actions">
        <button className={`secondary-action ${confirming ? "danger-action" : ""}`} disabled={!database?.connected || !canReset || resetting || draftedCount === 0} onClick={handleReset}>
          {resetting ? "Resetting..." : confirming ? "Confirm Reset Draft" : "Reset Mock Draft"}
        </button>
        {confirming && (
          <button className="secondary-action" disabled={resetting} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {!canReset && <div className="import-message">{draftMode === "mock" ? "Log in to reset your own mock lobby." : "Log in with Manage Draft permission to reset while Draft Mode is Real."}</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

export function PickEditorPanel({ database, draftSeason, picks, players, canManageDraft, auditActor, onSaved }) {
  const editablePicks = useMemo(() => picks.filter((pick) => pick.pickType !== "keeper"), [picks]);
  const [selectedPickId, setSelectedPickId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedPick = editablePicks.find((pick) => pick.id === selectedPickId) ?? editablePicks[0] ?? null;
  const usedPlayerIds = useMemo(() => new Set(
    picks
      .filter((pick) => pick.playerId && pick.id !== selectedPick?.id)
      .map((pick) => pick.playerId)
  ), [picks, selectedPick?.id]);
  const playerOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return players
      .filter((player) => !usedPlayerIds.has(player.id))
      .filter((player) => {
        if (!query) {
          return true;
        }
        return `${player.name} ${player.position} ${player.nflTeam}`.toLowerCase().includes(query);
      })
      .slice()
      .sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [players, search, usedPlayerIds]);

  useEffect(() => {
    if (!selectedPickId && editablePicks[0]) {
      setSelectedPickId(editablePicks[0].id);
    }
  }, [editablePicks, selectedPickId]);

  useEffect(() => {
    setSelectedPlayerId(selectedPick?.playerId ?? "");
  }, [selectedPick?.id, selectedPick?.playerId]);

  async function handleSave(nextPlayerId) {
    if (!selectedPick) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const nextState = await editPick(draftSeason, selectedPick.id, nextPlayerId || null, auditActor);
      onSaved(nextState);
      setMessage(nextPlayerId ? `Pick ${selectedPick.pickNumber} updated.` : `Pick ${selectedPick.pickNumber} cleared.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Correction</p>
          <h2>Edit Specific Pick</h2>
        </div>
      </div>
      <div className="pick-editor-grid">
        <label>
          Pick
          <select value={selectedPick?.id ?? ""} onChange={(event) => setSelectedPickId(event.target.value)}>
            {editablePicks.map((pick) => (
              <option key={pick.id} value={pick.id}>
                Pick {pick.pickNumber}, Round {pick.round} - {pick.team?.name ?? "Unknown"}{pick.player ? ` - ${pick.player.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search Player
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, position, or NFL team" />
        </label>
        <label>
          Player
          <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
            <option value="">Open pick</option>
            {playerOptions.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} - {player.position} - {player.nflTeam} - Rank {player.rank ?? "N/A"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="commissioner-actions pick-editor-actions">
        <button className="secondary-action" disabled={!database?.connected || !canManageDraft || !selectedPick || saving} onClick={() => handleSave("")}>
          Clear Pick
        </button>
        <button className="primary-action" disabled={!database?.connected || !canManageDraft || !selectedPick || !selectedPlayerId || saving} onClick={() => handleSave(selectedPlayerId)}>
          Save Pick
        </button>
      </div>
      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to edit a pick.</div>}
      {selectedPick?.pickType === "keeper" && <div className="import-message">Keeper picks should be changed from the Keepers page.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

export function DraftFinalizePanel({ database, draftSeason, picks, canManageDraft, auditActor, onFinalized }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const completedCount = picks.filter((pick) => pick.playerId).length;

  async function handleFinalize() {
    if (!confirming) {
      setConfirming(true);
      setMessage("");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await finalizeDraft(draftSeason, auditActor);
      setMessage(`Saved ${result.count} players from ${result.draftSeason} as the keeper source for ${result.nextDraftSeason}.`);
      setConfirming(false);
      onFinalized(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Final Draft</p>
          <h2>Save Keeper Source</h2>
        </div>
        <Database size={20} />
      </div>
      <p className="panel-note">
        Marks the {draftSeason} draft as final and saves its drafted/kept players as last year&apos;s draft data for {draftSeason + 1}.
      </p>
      <div className="commissioner-actions">
        <button className={`secondary-action ${confirming ? "danger-action" : ""}`} disabled={!database?.connected || !canManageDraft || saving || completedCount === 0} onClick={handleFinalize}>
          {saving ? "Saving..." : confirming ? "Confirm Save Source" : "Save as Next Year's Source"}
        </button>
        {confirming && (
          <button className="secondary-action" disabled={saving} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {!canManageDraft && <div className="import-message">Log in with Manage Draft permission to save the final draft source.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

export function KeeperDeadlinePanel({ database, draft, canManageKeepers, auditActor, onSaved }) {
  const [deadlineValue, setDeadlineValue] = useState(toDateTimeLocalValue(draft?.keeperLockDeadline));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDeadlineValue(toDateTimeLocalValue(draft?.keeperLockDeadline));
    setMessage("");
  }, [draft?.keeperLockDeadline, draft?.season]);

  async function handleSaveDeadline(nextValue = deadlineValue) {
    setSaving(true);
    setMessage("");
    try {
      const result = await saveKeeperDeadline(draft.season, fromDateTimeLocalValue(nextValue), auditActor);
      setMessage(result.keeperLockDeadline ? "Keeper deadline saved." : "Keeper deadline cleared.");
      onSaved(result.state);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setSaving(false);
    }
  }

  const lockText = draft?.keeperLockDeadline
    ? `${draft.keeperLocked ? "Locked since" : "Locks"} ${new Date(draft.keeperLockDeadline).toLocaleString()}`
    : "No keeper deadline set.";

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Keepers</p>
          <h2>Keeper Lock Deadline</h2>
        </div>
      </div>
      <p className="panel-note">{lockText} Commissioners can override after lock.</p>
      <div className="deadline-controls">
        <label>
          Deadline
          <input
            type="datetime-local"
            value={deadlineValue}
            disabled={!database?.connected || !canManageKeepers || saving}
            onChange={(event) => setDeadlineValue(event.target.value)}
          />
        </label>
        <button className="primary-action" disabled={!database?.connected || !canManageKeepers || saving} onClick={() => handleSaveDeadline()}>
          {saving ? "Saving..." : "Save Deadline"}
        </button>
        <button
          className="secondary-action"
          disabled={!database?.connected || !canManageKeepers || saving || !draft?.keeperLockDeadline}
          onClick={() => {
            setDeadlineValue("");
            handleSaveDeadline("");
          }}
        >
          Clear
        </button>
      </div>
      {!canManageKeepers && <div className="import-message">Log in with Manage Keepers permission to change the keeper deadline.</div>}
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

function auditEventTitle(eventType) {
  const titles = {
    account_created: "Account created",
    keepers_changed: "Keeper changed",
    rankings_uploaded: "Rankings uploaded",
    legacy_draft_uploaded: "Draft source seeded",
    fleaflicker_rosters_synced: "Fleaflicker rosters synced",
    fleaflicker_traded_picks_synced: "Fleaflicker picks synced",
    draft_finalized: "Draft finalized",
    keeper_deadline_updated: "Keeper deadline updated",
    pick_made: "Pick made",
    pick_undone: "Pick undone",
    pick_edited: "Pick edited",
    draft_mode_updated: "Draft mode updated",
    draft_reset: "Draft reset"
  };
  return titles[eventType] ?? eventType.replace(/_/g, " ");
}

function auditEventDetail(event) {
  const payload = event.payload ?? {};
  if (event.eventType === "keepers_changed") {
    return `${payload.count ?? 0} keeper${payload.count === 1 ? "" : "s"} saved`;
  }
  if (event.eventType === "account_created") {
    return `${payload.displayName ?? "Account"} created`;
  }
  if (event.eventType === "rankings_uploaded") {
    return `${payload.count ?? 0} player rankings`;
  }
  if (event.eventType === "legacy_draft_uploaded") {
    return `${payload.count ?? 0} draft picks saved as keeper source`;
  }
  if (event.eventType === "fleaflicker_rosters_synced") {
    return `${payload.count ?? 0} roster players, ${payload.teamCount ?? 0} teams`;
  }
  if (event.eventType === "fleaflicker_traded_picks_synced") {
    return `${payload.count ?? 0} traded picks`;
  }
  if (event.eventType === "draft_finalized") {
    return `${payload.savedPlayerCount ?? 0} players saved for ${payload.nextDraftSeason}`;
  }
  if (event.eventType === "keeper_deadline_updated") {
    return payload.keeperLockDeadline ? `Deadline set to ${new Date(payload.keeperLockDeadline).toLocaleString()}` : "Deadline cleared";
  }
  if (event.eventType === "draft_reset") {
    return `${payload.clearedPickCount ?? 0} drafted picks cleared`;
  }
  if (event.eventType === "pick_edited") {
    const previous = payload.previousPlayerName ?? "Open pick";
    const next = payload.nextPlayerName ?? "Open pick";
    return `Pick ${payload.pickNumber}: ${previous} -> ${next}`;
  }
  if (event.eventType === "draft_mode_updated") {
    return payload.mode === "mock" ? "Mock Draft enabled" : "Real draft enabled";
  }
  return "";
}

export function AuditLogPanel({ database, draftSeason, refreshKey }) {
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadEvents() {
    if (!database?.connected) {
      setEvents([]);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      setEvents(await fetchAuditLog(draftSeason));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, [database?.connected, draftSeason, refreshKey]);

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Audit Log</p>
          <h2>Recent Activity</h2>
        </div>
        <button className="secondary-action compact-action" disabled={!database?.connected || loading} onClick={loadEvents}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {!database?.connected && <div className="import-message">PostgreSQL is required for the audit log.</div>}
      {message && <div className="import-message">{message}</div>}
      <div className="audit-list">
        {events.map((event) => (
          <div className="audit-row" key={event.id}>
            <div>
              <strong>{auditEventTitle(event.eventType)}</strong>
              <span>{auditEventDetail(event)}</span>
            </div>
            <div className="audit-meta">
              <span>{event.actorName}</span>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          </div>
        ))}
        {database?.connected && events.length === 0 && !loading && (
          <div className="audit-empty">No audited activity yet for {draftSeason}.</div>
        )}
      </div>
    </section>
  );
}

export function AccountAdminPanel({ database, teams, currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [draftsById, setDraftsById] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: "",
    email: "",
    password: "",
    teamId: "",
    active: true,
    permissions: []
  });

  async function loadAccounts() {
    if (!database?.connected) {
      setAccounts([]);
      setDraftsById({});
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const nextAccounts = await fetchAccounts();
      setAccounts(nextAccounts);
      setDraftsById(nextAccounts.reduce((acc, account) => {
        acc[account.id] = {
          email: account.email ?? "",
          displayName: account.displayName ?? "",
          teamId: account.teamId ?? "",
          isActive: Boolean(account.isActive),
          permissions: account.permissions ?? []
        };
        return acc;
      }, {}));
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, [database?.connected]);

  function updateDraft(accountId, patch) {
    setDraftsById((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? {}),
        ...patch
      }
    }));
  }

  function togglePermission(accountId, permission) {
    const draft = draftsById[accountId] ?? {};
    const permissions = new Set(draft.permissions ?? []);
    if (permissions.has(permission)) {
      permissions.delete(permission);
    } else {
      permissions.add(permission);
    }
    updateDraft(accountId, { permissions: Array.from(permissions) });
  }

  function updateNewAccount(patch) {
    setNewAccount((current) => ({
      ...current,
      ...patch
    }));
  }

  function toggleNewAccountPermission(permission) {
    setNewAccount((current) => {
      const permissions = new Set(current.permissions ?? []);
      if (permissions.has(permission)) {
        permissions.delete(permission);
      } else {
        permissions.add(permission);
      }

      return {
        ...current,
        permissions: Array.from(permissions)
      };
    });
  }

  async function handleCreateAccount() {
    const name = newAccount.name.trim();
    const email = newAccount.email.trim();
    if (!name || !email || !newAccount.password) {
      setMessage("Name, email, and temporary password are required.");
      return;
    }
    if (newAccount.password.length < 8) {
      setMessage("Temporary password must be at least 8 characters.");
      return;
    }

    setCreatingAccount(true);
    setMessage("");
    try {
      const created = await createAccount({
        name,
        email,
        password: newAccount.password,
        teamId: newAccount.teamId || null,
        active: newAccount.active,
        permissions: newAccount.permissions ?? []
      });
      const nextAccounts = await fetchAccounts();
      setAccounts(nextAccounts);
      setDraftsById(nextAccounts.reduce((acc, account) => {
        acc[account.id] = {
          email: account.email ?? "",
          displayName: account.displayName ?? "",
          teamId: account.teamId ?? "",
          isActive: Boolean(account.isActive),
          permissions: account.permissions ?? []
        };
        return acc;
      }, {}));
      setNewAccount({
        name: "",
        email: "",
        password: "",
        teamId: "",
        active: true,
        permissions: []
      });
      setShowCreateForm(false);
      setMessage(`${created.displayName} created.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleSave(account) {
    setBusyAccountId(account.id);
    setMessage("");
    try {
      const updated = await updateAccount(account.id, draftsById[account.id]);
      setAccounts((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
      updateDraft(updated.id, {
        email: updated.email ?? "",
        displayName: updated.displayName ?? "",
        teamId: updated.teamId ?? "",
        isActive: Boolean(updated.isActive),
        permissions: updated.permissions ?? []
      });
      setMessage(`${updated.displayName} saved.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAccountId("");
    }
  }

  async function handleResetPassword(account) {
    setBusyAccountId(account.id);
    setMessage("");
    try {
      const result = await resetAccountPassword(account.id);
      setAccounts((current) => current.map((candidate) => (candidate.id === result.user.id ? result.user : candidate)));
      setMessage(`${result.user.displayName}'s password was reset. They can set a new password from Login.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusyAccountId("");
    }
  }

  return (
    <section className="commissioner-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Accounts</p>
          <h2>Account Admin</h2>
        </div>
        <div className="account-heading-actions">
          <button className="secondary-action compact-action" disabled={!database?.connected || loading || creatingAccount} onClick={() => setShowCreateForm((current) => !current)}>
            {showCreateForm ? "Cancel Add" : "Add Account"}
          </button>
          <button className="secondary-action compact-action" disabled={!database?.connected || loading} onClick={loadAccounts}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {!database?.connected && <div className="import-message">PostgreSQL is required for accounts.</div>}
      {message && <div className="import-message">{message}</div>}
      {showCreateForm && (
        <div className="account-create-panel">
          <div className="account-admin-main">
            <label>
              Name
              <input value={newAccount.name} disabled={creatingAccount} onChange={(event) => updateNewAccount({ name: event.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={newAccount.email} disabled={creatingAccount} onChange={(event) => updateNewAccount({ email: event.target.value })} />
            </label>
            <label>
              Temporary Password
              <input type="password" value={newAccount.password} disabled={creatingAccount} onChange={(event) => updateNewAccount({ password: event.target.value })} />
            </label>
            <label>
              Fantasy Team
              <select value={newAccount.teamId} disabled={creatingAccount} onChange={(event) => updateNewAccount({ teamId: event.target.value })}>
                <option value="">No team linked</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label className="account-active-toggle">
              <input
                type="checkbox"
                checked={Boolean(newAccount.active)}
                disabled={creatingAccount}
                onChange={(event) => updateNewAccount({ active: event.target.checked })}
              />
              Active
            </label>
          </div>

          <div className="permission-grid">
            {ACCOUNT_PERMISSIONS.map((permission) => (
              <label key={permission} className="permission-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(newAccount.permissions?.includes(permission))}
                  disabled={creatingAccount}
                  onChange={() => toggleNewAccountPermission(permission)}
                />
                {permission.replace(/_/g, " ")}
              </label>
            ))}
          </div>

          <div className="account-create-actions">
            <button className="primary-action compact-action" disabled={creatingAccount || !database?.connected} onClick={handleCreateAccount}>
              {creatingAccount ? "Creating..." : "Create Account"}
            </button>
          </div>
        </div>
      )}
      <div className="account-list">
        {accounts.map((account) => {
          const draft = draftsById[account.id] ?? {};
          const busy = busyAccountId === account.id;
          return (
            <div className="account-admin-row" key={account.id}>
              <div className="account-admin-main">
                <label>
                  Name
                  <input value={draft.displayName ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { displayName: event.target.value })} />
                </label>
                <label>
                  Email
                  <input value={draft.email ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { email: event.target.value })} />
                </label>
                <label>
                  Fantasy Team
                  <select value={draft.teamId ?? ""} disabled={busy} onChange={(event) => updateDraft(account.id, { teamId: event.target.value })}>
                    <option value="">No team linked</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
                <label className="account-active-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.isActive)}
                    disabled={busy}
                    onChange={(event) => updateDraft(account.id, { isActive: event.target.checked })}
                  />
                  Active
                </label>
              </div>

              <div className="permission-grid">
                {ACCOUNT_PERMISSIONS.map((permission) => (
                  <label key={permission} className="permission-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.permissions?.includes(permission))}
                      disabled={busy}
                      onChange={() => togglePermission(account.id, permission)}
                    />
                    {permission.replace(/_/g, " ")}
                  </label>
                ))}
              </div>

              <div className="account-admin-footer">
                <div>
                  <span>{account.hasPassword ? "Password set" : "No password set"}</span>
                  {account.id === currentUser?.id && <small>Current user</small>}
                </div>
                <div className="account-admin-actions">
                  <button className="secondary-action compact-action" disabled={busy} onClick={() => handleResetPassword(account)}>
                    Reset Password
                  </button>
                  <button className="primary-action compact-action" disabled={busy} onClick={() => handleSave(account)}>
                    {busy ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {database?.connected && accounts.length === 0 && !loading && (
          <div className="audit-empty">No accounts found.</div>
        )}
      </div>
    </section>
  );
}
