import React, { useEffect, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { fetchSimulatorSettings, runSimulatorAction, saveSimulatorSettings } from "../../api.js";
import { POSITIONS } from "../../shared/constants.js";
import { positionClass } from "../../shared/helpers.js";
import { DraftResetPanel } from "../commissioner/CommissionerTools.jsx";

export function PickCell({ pick, isCurrent, teamColor }) {
  const player = pick.player;
  const isKeeper = pick.pickType === "keeper";
  const isTraded = pick.originalTeamId !== pick.currentOwnerTeamId;
  const tradeStyle = isTraded ? { "--trade-team-color": teamColor } : undefined;

  return (
    <div className={`pick-cell ${isCurrent ? "current" : ""} ${isKeeper ? "keeper" : ""} ${isTraded ? "traded" : ""} ${player ? positionClass(player.position) : ""}`} style={tradeStyle}>
      <div className="pick-meta">
        <span>{pick.pickNumber}</span>
        <span className="pick-badges">
          {isTraded && <span className="trade-chip">T</span>}
          {isKeeper && <span className="keeper-chip">K</span>}
        </span>
      </div>
      {isTraded && <span className="trade-owner-chip">{pick.team.name}</span>}
      {player ? (
        <>
          <strong>{player.name}</strong>
          <small>{player.position} - {player.nflTeam}</small>
        </>
      ) : (
        <>
          <strong>{isTraded ? pick.team.name : "Open pick"}</strong>
          {isTraded && <small>Traded pick</small>}
        </>
      )}
    </div>
  );
}

export function PlayerRow({ player, displayRank, disabled, onPick }) {
  return (
    <button className={`player-row ${positionClass(player.position)}`} disabled={disabled} onClick={() => onPick(player.id)}>
      <span className="rank">{displayRank}</span>
      <span className="player-main">
        <strong>{player.name}</strong>
        <small>{player.position} - {player.nflTeam} - Bye {player.byeWeek ?? "?"} - Rank {player.rank ?? "N/A"}</small>
      </span>
    </button>
  );
}

const STRATEGY_OPTIONS = [
  ["balanced", "Balanced"],
  ["best_available", "Best Available"],
  ["rb_heavy", "WR Heavy"],
  ["wr_heavy", "RB Heavy"],
  ["zero_rb", "Zero RB"],
  ["wait_on_qb", "Wait on QB"],
  ["team_needs", "Team Needs"]
];

const RANDOMNESS_OPTIONS = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"]
];

const SIMULATOR_ACTIONS = [
  ["autopick-next", "Auto-pick next"],
  ["autopick-until-user", "Auto-pick until my next pick"],
  ["autopick-round", "Auto-pick round"],
  ["autocomplete", "Auto-complete draft"],
  ["reset", "Reset simulation"]
];

function DraftSimulatorPanel({ teams, draftSeason, onStateChanged }) {
  const [settings, setSettings] = useState({
    enabled: false,
    controlledTeamIds: [],
    strategy: "balanced",
    teamStrategies: {},
    randomness: "medium"
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetchSimulatorSettings(draftSeason)
      .then((nextSettings) => {
        setSettings({
          enabled: Boolean(nextSettings.enabled),
          controlledTeamIds: nextSettings.controlledTeamIds ?? [],
          strategy: nextSettings.strategy ?? "balanced",
          teamStrategies: nextSettings.teamStrategies ?? {},
          randomness: nextSettings.randomness ?? "medium"
        });
      })
      .catch((caught) => setMessage(caught.response?.data?.error ?? caught.message));
  }, [draftSeason]);

  async function persistSettings(nextSettings) {
    setSettings(nextSettings);
    setMessage("");
    try {
      const saved = await saveSimulatorSettings(draftSeason, nextSettings);
      setSettings({
        enabled: Boolean(saved.enabled),
        controlledTeamIds: saved.controlledTeamIds ?? [],
        strategy: saved.strategy ?? "balanced",
        teamStrategies: saved.teamStrategies ?? {},
        randomness: saved.randomness ?? "medium"
      });
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    }
  }

  function toggleTeam(teamId) {
    const controlledTeamIds = settings.controlledTeamIds.includes(teamId)
      ? settings.controlledTeamIds.filter((id) => id !== teamId)
      : [...settings.controlledTeamIds, teamId];
    persistSettings({ ...settings, controlledTeamIds });
  }

  async function handleAction(action) {
    setBusy(action);
    setMessage("");
    try {
      const result = await runSimulatorAction(action, draftSeason);
      if (result.state) {
        onStateChanged(result.state);
      }
      if (result.settings) {
        setSettings({
          enabled: Boolean(result.settings.enabled),
          controlledTeamIds: result.settings.controlledTeamIds ?? [],
          strategy: result.settings.strategy ?? "balanced",
          teamStrategies: result.settings.teamStrategies ?? {},
          randomness: result.settings.randomness ?? "medium"
        });
      }
      setMessage(result.lastReason || `${result.pickedCount ?? 0} picks simulated.`);
    } catch (caught) {
      setMessage(caught.response?.data?.error ?? caught.message);
    } finally {
      setBusy("");
    }
  }

  const controlledTeamNames = teams
    .filter((team) => settings.controlledTeamIds.includes(team.id))
    .map((team) => team.name)
    .join(", ");
  const strategyLabel = STRATEGY_OPTIONS.find(([value]) => value === settings.strategy)?.[1] ?? "Balanced";

  function setTeamStrategy(teamId, strategy) {
    const teamStrategies = { ...settings.teamStrategies };
    if (!strategy) {
      delete teamStrategies[teamId];
    } else {
      teamStrategies[teamId] = strategy;
    }
    persistSettings({ ...settings, teamStrategies });
  }

  return (
    <section className="simulator-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Mock Draft</p>
          <h2>Draft Simulator</h2>
        </div>
      </div>
      <div className="simulator-grid">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => persistSettings({ ...settings, enabled: event.target.checked })}
          />
          Enable Simulator
        </label>
        <label>
          Strategy
          <select value={settings.strategy} onChange={(event) => persistSettings({ ...settings, strategy: event.target.value })}>
            {STRATEGY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Randomness
          <select value={settings.randomness} onChange={(event) => persistSettings({ ...settings, randomness: event.target.value })}>
            {RANDOMNESS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="controlled-teams">
        <span className="label">Controlled Teams</span>
        <div className="controlled-team-grid">
          {teams.map((team) => (
            <label className="team-toggle" key={team.id}>
              <input
                type="checkbox"
                checked={settings.controlledTeamIds.includes(team.id)}
                onChange={() => toggleTeam(team.id)}
              />
              {team.name}
            </label>
          ))}
        </div>
        <small>{controlledTeamNames || "No controlled teams selected."}</small>
      </div>
      <div className="team-strategies">
        <span className="label">Team Strategies</span>
        <div className="team-strategy-grid">
          {teams.map((team) => (
            <label className="team-strategy-row" key={team.id}>
              <span>{team.name}</span>
              <select
                value={settings.teamStrategies[team.id] ?? ""}
                onChange={(event) => setTeamStrategy(team.id, event.target.value)}
              >
                <option value="">Default: {strategyLabel}</option>
                {STRATEGY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <div className="simulator-actions">
        {SIMULATOR_ACTIONS.map(([action, label]) => (
          <button
            className={action === "reset" ? "secondary-action" : "primary-action"}
            disabled={busy !== "" || (!settings.enabled && action !== "reset")}
            key={action}
            onClick={() => handleAction(action)}
            type="button"
          >
            {busy === action ? "Working..." : label}
          </button>
        ))}
      </div>
      {message && <div className="import-message">{message}</div>}
    </section>
  );
}

export function DraftRoom({
  state,
  draftMode,
  selectedDraftSeason,
  currentPick,
  currentTeam,
  nextUpTeam,
  timerSeconds,
  timerDisplay,
  canManageDraft,
  selectedTeamCanPick,
  pendingPickId,
  query,
  position,
  filteredPlayers,
  picksByRound,
  boardGridStyle,
  boardScrollRef,
  teamsWithTradedPicks,
  teamColorById,
  mockLobbyTeamId,
  auditActor,
  onQueryChange,
  onPositionChange,
  onMakePick,
  onUndoPick,
  onDraftModeChange,
  onSimulatorStateChanged,
  onMockReset
}) {
  return (
    <>
      {draftMode === "mock" && (
        <section className="page-section">
          <DraftResetPanel
            database={state.database}
            draftSeason={selectedDraftSeason}
            picks={state.picks}
            draftMode={draftMode}
            mockLobbyTeamId={mockLobbyTeamId}
            canManageDraft={canManageDraft}
            auditActor={auditActor}
            onReset={onMockReset}
          />
        </section>
      )}

      {draftMode === "mock" && (
        <DraftSimulatorPanel
          teams={state.teams}
          draftSeason={selectedDraftSeason}
          onStateChanged={onSimulatorStateChanged}
        />
      )}

      <section className="status-band">
        <div>
          <span className="label">On the clock</span>
          <strong className="clock-line">
            <span>{currentTeam?.name ?? "Draft complete"}</span>
            {currentPick && <span className={`pick-timer ${timerSeconds === 0 ? "expired" : ""}`}>{timerDisplay}</span>}
          </strong>
        </div>
        <div>
          <span className="label">Pick</span>
          <strong>{currentPick ? `${currentPick.round}.${currentPick.pickNumber}` : "Done"}</strong>
        </div>
        <div>
          <span className="label">Next Up</span>
          <strong>{nextUpTeam?.name ?? "Done"}</strong>
        </div>
        <div>
          <span className="label">Draft Mode</span>
          <select
            className="mode-select"
            value={draftMode}
            disabled={!canManageDraft}
            onChange={(event) => onDraftModeChange(event.target.value)}
          >
            <option value="mock">Mock Draft</option>
            <option value="real">Real</option>
          </select>
        </div>
      </section>

      <div className="draft-action-bar">
        <button className="secondary-action" onClick={onUndoPick} type="button">
          Undo previous pick
        </button>
      </div>

      <section className="workspace">
        <aside className="players-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Available</p>
              <h2>Player Pool</h2>
            </div>
            <ShieldCheck size={20} />
          </div>

          <div className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search players or NFL team"
            />
          </div>

          <div className="position-tabs">
            {POSITIONS.map((item) => (
              <button
                key={item}
                className={position === item ? "active" : ""}
                onClick={() => onPositionChange(position === item ? "" : item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="players-list">
            {filteredPlayers.map((player, index) => (
              <PlayerRow
                key={player.id}
                player={player}
                displayRank={index + 1}
                disabled={!selectedTeamCanPick || Boolean(pendingPickId)}
                onPick={onMakePick}
              />
            ))}
          </div>
        </aside>

        <section className="draft-board">
          <div className="board-scroll" ref={boardScrollRef}>
            <div className="board-grid team-header" style={boardGridStyle}>
              <div className="round-header">Rd</div>
              {state.teams.map((team) => (
                <div
                  className={`team-name ${teamsWithTradedPicks.has(team.id) ? "has-traded-pick" : ""}`}
                  key={team.id}
                  style={teamsWithTradedPicks.has(team.id) ? { "--team-color": teamColorById[team.id] } : undefined}
                >
                  {team.name}
                </div>
              ))}
            </div>
            {Object.entries(picksByRound).map(([round, picks]) => (
              <div className="board-grid" key={round} style={boardGridStyle}>
                <div className="round-number">{round}</div>
                {picks.map((pick) => (
                  <PickCell
                    key={pick.id}
                    pick={pick}
                    isCurrent={pick.id === currentPick?.id}
                    teamColor={teamColorById[pick.currentOwnerTeamId]}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}
