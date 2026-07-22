import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  API_BASE_URL,
  fetchCurrentUser,
  fetchDraftState,
  saveDraftMode,
  submitPick,
  undoPick
} from "./api.js";
import {
  AccountAdminPanel,
  AuditLogPanel,
  CommissionerImports,
  DraftFinalizePanel,
  DraftOrderEditor,
  DraftResetPanel,
  FleaflickerPickSync,
  FleaflickerRosterSync,
  FleaflickerSetupSync,
  KeeperDeadlinePanel,
  PickEditorPanel,
  PlayerMatchingReview
} from "./features/commissioner/CommissionerTools.jsx";
import { DraftRoom } from "./features/draftBoard/DraftBoard.jsx";
import { ExportBackupPanel, FleaflickerEntryExport } from "./features/exports/ExportTools.jsx";
import { KeepersPage } from "./features/keepers/KeepersPage.jsx";
import { LoginPage } from "./features/auth/Auth.jsx";
import { AUTH_TOKEN_STORAGE_KEY, EARLY_ROUND_PICK_TIMER_SECONDS, LATE_ROUND_PICK_TIMER_SECONDS, PICK_TIMER_ROUND_CUTOFF, PAGES, TEAM_COLORS } from "./shared/constants.js";
import { CommissionerTabs, TopNavigation } from "./shared/Layout.jsx";
import { groupPicksByRound, mockLobbyUserIdFor, positionClass, userHasPermission } from "./shared/helpers.js";

export default function App() {
  const [state, setState] = useState(null);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [selectedPage, setSelectedPage] = useState("draft");
  const [selectedCommissionerTab, setSelectedCommissionerTab] = useState("setup");
  const [selectedDraftSeason, setSelectedDraftSeason] = useState(2026);
  const [error, setError] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(EARLY_ROUND_PICK_TIMER_SECONDS);
  const [pendingPickId, setPendingPickId] = useState("");
  const [pickAnnouncement, setPickAnnouncement] = useState(null);
  const [exportAnnouncement, setExportAnnouncement] = useState(null);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "");
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(() => !window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY));
  const boardScrollRef = useRef(null);
  const selectedDraftSeasonRef = useRef(selectedDraftSeason);
  const stateRef = useRef(null);
  const announcedPickRef = useRef("");
  const announcementTimerRef = useRef(null);
  const exportAnnouncementTimerRef = useRef(null);

  useEffect(() => {
    selectedDraftSeasonRef.current = selectedDraftSeason;
  }, [selectedDraftSeason]);

  useEffect(() => {
    if (state) {
      stateRef.current = state;
    }
  }, [state]);

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      setAuthChecked(true);
      return;
    }

    setAuthChecked(false);
    fetchCurrentUser(authToken).then((user) => {
      if (!user) {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        setAuthToken("");
        setCurrentUser(null);
        setAuthChecked(true);
        return;
      }
      setCurrentUser(user);
      setAuthChecked(true);
    }).catch(() => {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      setAuthToken("");
      setCurrentUser(null);
      setAuthChecked(true);
    });
  }, [authToken]);

  useEffect(() => {
    const accountMockUserId = mockLobbyUserIdFor(currentUser?.id);
    const mockLobbyTeamId = state?.draft?.status === "mock" ? accountMockUserId : null;
    fetchDraftState(selectedDraftSeason, { mockLobbyTeamId }).then((nextState) => {
      setState(nextState);
    }).catch((caught) => setError(caught.message));
  }, [currentUser, selectedDraftSeason, state?.draft?.status]);

  useEffect(() => {
    return () => {
      if (announcementTimerRef.current) {
        window.clearTimeout(announcementTimerRef.current);
      }
      if (exportAnnouncementTimerRef.current) {
        window.clearTimeout(exportAnnouncementTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {

    const socket = io(API_BASE_URL, {
      auth: authToken ? { token: authToken } : undefined
    });
    socket.on("draft:updated", (nextState) => {
      if (!nextState?.draft?.season || Number(nextState.draft.season) === Number(selectedDraftSeasonRef.current)) {
        const activeMockUserId = mockLobbyUserIdFor(currentUser?.id);
        if (nextState.draft?.status === "mock" && nextState.draft?.mockUserId && nextState.draft.mockUserId !== activeMockUserId) {
          return;
        }
        applyDraftState(nextState);
      }
    });

    return () => socket.disconnect();
  }, [authToken, currentUser?.id]);

  function findNewDraftedPick(previousState, nextState) {
    if (!previousState?.picks || !nextState?.picks) {
      return null;
    }

    const previousById = new Map(previousState.picks.map((pick) => [pick.id, pick]));
    return nextState.picks.find((pick) => {
      const previousPick = previousById.get(pick.id);
      return pick.pickType === "drafted" && pick.player && !previousPick?.playerId;
    }) ?? null;
  }

  function announcePick(pick) {
    if (!pick?.player || announcedPickRef.current === pick.id) {
      return;
    }

    announcedPickRef.current = pick.id;
    setPickAnnouncement({
      id: `${pick.id}-${Date.now()}`,
      pickNumber: pick.pickNumber,
      playerName: pick.player.name,
      position: pick.player.position,
      nflTeam: pick.player.nflTeam,
      positionClassName: positionClass(pick.player.position)
    });

    if (announcementTimerRef.current) {
      window.clearTimeout(announcementTimerRef.current);
    }
    announcementTimerRef.current = window.setTimeout(() => {
      setPickAnnouncement(null);
    }, 11000);
  }

  function announceExport(filename) {
    setExportAnnouncement({
      id: `${filename}-${Date.now()}`,
      filename,
      location: "Downloads folder, usually C:\\Users\\derek\\Downloads"
    });

    if (exportAnnouncementTimerRef.current) {
      window.clearTimeout(exportAnnouncementTimerRef.current);
    }
    exportAnnouncementTimerRef.current = window.setTimeout(() => {
      setExportAnnouncement(null);
    }, 11000);
  }

  function applyDraftState(nextState) {
    const newDraftedPick = findNewDraftedPick(stateRef.current, nextState);
    stateRef.current = nextState;
    setState(nextState);
    if (newDraftedPick) {
      announcePick(newDraftedPick);
    }
  }

  function buildOptimisticPickState(currentState, pickId, playerId) {
    if (!currentState?.picks?.length) {
      return null;
    }

    const player = (currentState.availablePlayers ?? []).find((item) => item.id === playerId)
      ?? (currentState.players ?? []).find((item) => item.id === playerId);
    if (!player) {
      return null;
    }

    let optimisticPick = null;
    const picks = currentState.picks.map((pick) => {
      if (pick.id !== pickId || pick.playerId) {
        return pick;
      }

      optimisticPick = {
        ...pick,
        playerId,
        player,
        pickType: "drafted"
      };
      return optimisticPick;
    });

    if (!optimisticPick) {
      return null;
    }

    return {
      ...currentState,
      picks,
      currentPick: picks
        .slice()
        .sort((a, b) => a.pickNumber - b.pickNumber)
        .find((pick) => pick.playerId == null) ?? null,
      availablePlayers: (currentState.availablePlayers ?? []).filter((item) => item.id !== playerId)
    };
  }

  const picksByRound = useMemo(() => groupPicksByRound(state?.picks ?? []), [state]);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (state?.availablePlayers ?? [])
      .slice()
      .sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999) || a.name.localeCompare(b.name))
      .filter((player) => {
      const matchesPosition = !position || player.position === position;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        player.name.toLowerCase().includes(normalizedQuery) ||
        player.nflTeam.toLowerCase().includes(normalizedQuery);

      return matchesPosition && matchesQuery;
    });
  }, [position, query, state]);

  const currentPick = state?.currentPick;
  const currentTeam = state?.teams.find((team) => team.id === currentPick?.currentOwnerTeamId);
  const nextUpPick = useMemo(() => {
    if (!currentPick || !state?.picks?.length) {
      return null;
    }

    return state.picks
      .slice()
      .sort((a, b) => a.pickNumber - b.pickNumber)
      .find((pick) => pick.pickNumber > currentPick.pickNumber && pick.playerId == null) ?? null;
  }, [currentPick, state?.picks]);
  const nextUpTeam = state?.teams.find((team) => team.id === nextUpPick?.currentOwnerTeamId);
  const canManageDraft = userHasPermission(currentUser, "manage_draft");
  const canManageKeepers = userHasPermission(currentUser, "manage_keepers");
  const canManageRankings = userHasPermission(currentUser, "manage_rankings");
  const canSyncFleaflicker = userHasPermission(currentUser, "sync_fleaflicker");
  const canViewAuditLog = userHasPermission(currentUser, "view_audit_log");
  const canAdminAccounts = userHasPermission(currentUser, "commissioner_admin");
  const canAccessCommissioner = canManageDraft || canManageKeepers || canManageRankings || canSyncFleaflicker || canViewAuditLog;
  const draftMode = state?.draft?.status === "mock" ? "mock" : "real";
  const accountMockUserId = mockLobbyUserIdFor(currentUser?.id);
  const mockLobbyTeamId = draftMode === "mock" ? accountMockUserId : null;
  const visiblePages = useMemo(
    () => PAGES.filter((page) => {
      if (page.id === "login") {
        return false;
      }
      if (page.id === "commissioner") {
        return canAccessCommissioner;
      }
      return true;
    }),
    [canAccessCommissioner]
  );
  const auditActor = {
    actorTeamId: currentUser?.teamId ?? null,
    actorLabel: currentUser?.displayName ?? "Unknown"
  };
  const commissionerTabs = useMemo(() => [
    (canSyncFleaflicker || canManageRankings) && {
      id: "setup",
      label: "Setup & Imports",
      content: (
        <>
          <CommissionerImports database={state?.database} draftSeason={selectedDraftSeason} canManageRankings={canManageRankings} auditActor={auditActor} onImported={applyAuditedState} />
          <FleaflickerSetupSync
            database={state?.database}
            draftSeason={selectedDraftSeason}
            canSyncFleaflicker={canSyncFleaflicker}
            auditActor={auditActor}
            onDraftSeasonChange={setSelectedDraftSeason}
            onSynced={applyAuditedState}
            refreshKey={auditRefreshKey}
          />
          <FleaflickerRosterSync
            database={state?.database}
            canSyncFleaflicker={canSyncFleaflicker}
            auditActor={auditActor}
            onDraftSeasonChange={setSelectedDraftSeason}
            onSynced={applyAuditedState}
          />
          <FleaflickerPickSync
            database={state?.database}
            canSyncFleaflicker={canSyncFleaflicker}
            auditActor={auditActor}
            onDraftSeasonChange={setSelectedDraftSeason}
            onSynced={applyAuditedState}
          />
        </>
      )
    },
    canAdminAccounts && {
      id: "accounts",
      label: "Accounts",
      content: <AccountAdminPanel database={state?.database} teams={state?.teams ?? []} currentUser={currentUser} />
    },
    canManageDraft && {
      id: "draft-management",
      label: "Draft Management",
      content: (
        <>
          <PickEditorPanel
            database={state?.database}
            draftSeason={selectedDraftSeason}
            picks={state?.picks ?? []}
            players={state?.players ?? []}
            canManageDraft={canManageDraft}
            auditActor={auditActor}
            onSaved={applyAuditedState}
          />
          <DraftResetPanel
            database={state?.database}
            draftSeason={selectedDraftSeason}
            picks={state?.picks ?? []}
            draftMode={draftMode}
            mockLobbyTeamId={mockLobbyTeamId}
            canManageDraft={canManageDraft}
            auditActor={auditActor}
            onReset={setState}
          />
          <DraftFinalizePanel database={state?.database} draftSeason={selectedDraftSeason} picks={state?.picks ?? []} canManageDraft={canManageDraft} auditActor={auditActor} onFinalized={applyAuditedState} />
          <DraftOrderEditor teams={state?.teams ?? []} database={state?.database} draftSeason={selectedDraftSeason} canManageDraft={canManageDraft} onSaved={setState} />
        </>
      )
    },
    canManageKeepers && {
      id: "keepers",
      label: "Keeper Deadline",
      content: <KeeperDeadlinePanel database={state?.database} draft={state?.draft} canManageKeepers={canManageKeepers} auditActor={auditActor} onSaved={applyAuditedState} />
    },
    canManageRankings && {
      id: "player-matching",
      label: "Player Matching",
      content: (
        <PlayerMatchingReview
          database={state?.database}
          draftSeason={selectedDraftSeason}
          canManageRankings={canManageRankings}
          auditActor={auditActor}
          onStateChanged={applyAuditedState}
        />
      )
    },
    canAccessCommissioner && {
      id: "exports",
      label: "Exports",
      content: (
        <>
          <ExportBackupPanel state={state} draftSeason={selectedDraftSeason} onDownloaded={announceExport} />
          <FleaflickerEntryExport draftSeason={selectedDraftSeason} onDownloaded={announceExport} />
        </>
      )
    },
    canViewAuditLog && {
      id: "audit-log",
      label: "Audit Log",
      content: <AuditLogPanel database={state?.database} draftSeason={selectedDraftSeason} refreshKey={auditRefreshKey} />
    }
  ].filter(Boolean), [
    auditActor,
    auditRefreshKey,
    canAccessCommissioner,
    canAdminAccounts,
    canManageDraft,
    canManageKeepers,
    canManageRankings,
    canSyncFleaflicker,
    canViewAuditLog,
    currentUser,
    draftMode,
    mockLobbyTeamId,
    selectedDraftSeason,
    state,
    applyAuditedState,
    announceExport
  ]);

  useEffect(() => {
    if (!commissionerTabs.length) {
      return;
    }

    if (!commissionerTabs.some((tab) => tab.id === selectedCommissionerTab)) {
      setSelectedCommissionerTab(commissionerTabs[0].id);
    }
  }, [commissionerTabs, selectedCommissionerTab]);

  const selectedTeamCanPick = draftMode === "mock"
    ? Boolean(currentUser)
    : canManageDraft || (currentUser?.teamId && currentPick?.currentOwnerTeamId === currentUser.teamId);
  const timerMinutes = Math.floor(timerSeconds / 60);
  const timerRemainder = String(timerSeconds % 60).padStart(2, "0");
  const timerDisplay = `${timerMinutes}:${timerRemainder}`;
  const boardGridStyle = {
    gridTemplateColumns: `34px repeat(${state?.teams.length ?? 0}, minmax(78px, 1fr))`
  };
  const teamColorById = useMemo(() => {
    return (state?.teams ?? []).reduce((acc, team, index) => {
      acc[team.id] = TEAM_COLORS[index % TEAM_COLORS.length];
      return acc;
    }, {});
  }, [state?.teams]);
  const teamsWithTradedPicks = useMemo(() => {
    return new Set(
      (state?.picks ?? [])
        .filter((pick) => pick.originalTeamId !== pick.currentOwnerTeamId)
        .map((pick) => pick.currentOwnerTeamId)
    );
  }, [state?.picks]);

  function syncScroll(source, target) {
    if (!source.current || !target.current) {
      return;
    }

    target.current.scrollLeft = source.current.scrollLeft;
  }

  function pickTimerSecondsForRound(round) {
    return Number(round) <= PICK_TIMER_ROUND_CUTOFF
      ? EARLY_ROUND_PICK_TIMER_SECONDS
      : LATE_ROUND_PICK_TIMER_SECONDS;
  }

  useEffect(() => {
    setTimerSeconds(currentPick ? pickTimerSecondsForRound(currentPick.round) : EARLY_ROUND_PICK_TIMER_SECONDS);
  }, [currentPick?.id, currentPick?.round]);

  useEffect(() => {
    if (!currentPick) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setTimerSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [currentPick?.id]);

  useEffect(() => {
    if (selectedPage === "commissioner" && !canAccessCommissioner) {
      setSelectedPage("draft");
    }
  }, [canAccessCommissioner, selectedPage]);

  async function handleMakePick(playerId) {
    if (!currentPick) {
      return;
    }

    setError("");
    const previousState = stateRef.current;
    const optimisticState = buildOptimisticPickState(previousState, currentPick.id, playerId);
    if (optimisticState) {
      const optimisticPick = optimisticState.picks.find((pick) => pick.id === currentPick.id);
      stateRef.current = optimisticState;
      setState(optimisticState);
      announcePick(optimisticPick);
    }

    setPendingPickId(currentPick.id);
    try {
      const nextState = await submitPick({
        pickId: currentPick.id,
        playerId,
        draftSeason: selectedDraftSeason,
        mockLobbyTeamId,
        teamId: draftMode === "mock" || canManageDraft ? currentPick.currentOwnerTeamId : currentUser?.teamId,
        ...auditActor
      });
      applyDraftState(nextState);
    } catch (caught) {
      const message = caught.response?.data?.error ?? caught.message;
      setError(message);
      if (previousState) {
        stateRef.current = previousState;
        setState(previousState);
      }
      if (optimisticState && announcedPickRef.current === currentPick.id) {
        announcedPickRef.current = "";
        setPickAnnouncement(null);
      }
      if (message === "Draft state refreshed; try again." || message === "Pick already taken.") {
        fetchDraftState(selectedDraftSeason, { mockLobbyTeamId }).then((nextState) => {
          stateRef.current = nextState;
          setState(nextState);
        }).catch(() => {});
      }
    } finally {
      setPendingPickId("");
    }
  }

  async function handleUndoPick() {
    setError("");
    try {
      const nextState = await undoPick(selectedDraftSeason, auditActor, { mockLobbyTeamId });
      stateRef.current = nextState;
      setState(nextState);
    } catch (caught) {
      setError(caught.response?.data?.error ?? caught.message);
    }
  }

  async function handleDraftModeChange(mode) {
    setError("");
    try {
      const result = await saveDraftMode(selectedDraftSeason, mode, auditActor);
      applyAuditedState(result.state);
    } catch (caught) {
      setError(caught.response?.data?.error ?? caught.message);
    }
  }

  function stepDraftSeason(delta) {
    setSelectedDraftSeason((season) => Math.min(2100, Math.max(2000, Number(season) + delta)));
  }

  function applyAuditedState(nextState) {
    setState(nextState);
    setAuditRefreshKey((currentKey) => currentKey + 1);
  }

  function handleAuthenticated(result) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
    setAuthToken(result.token);
    setCurrentUser(result.user);
    setAuthChecked(true);
  }

  function handleLoggedOut() {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setAuthToken("");
    setCurrentUser(null);
  }

  if (!state || !authChecked) {
    return <main className="loading">Loading draft room...</main>;
  }

  if (!currentUser) {
    return (
      <main className="app-shell login-shell">
        <header className="login-brand">
          <div className="login-brand-mark">F</div>
          <div>
            <p className="eyebrow">RotoBaller Keeper League</p>
            <h1>Franzia Keeper Draft</h1>
          </div>
        </header>
        <LoginPage
          database={state.database}
          currentUser={currentUser}
          authToken={authToken}
          draftSeason={state.draft?.season ?? selectedDraftSeason}
          onAuthenticated={handleAuthenticated}
          onLoggedOut={handleLoggedOut}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RotoBaller Keeper League</p>
          <h1>Franzia Keeper Draft</h1>
          <TopNavigation pages={visiblePages} selectedPage={selectedPage} onSelectPage={setSelectedPage} />
        </div>
        <div className="topbar-actions">
          <label>
            Draft Season
              <span className="season-stepper">
                <button type="button" aria-label="Previous draft season" onClick={() => stepDraftSeason(-1)} disabled={selectedDraftSeason <= 2000}>
                  <ChevronDown size={16} />
                </button>
                <input
                  type="text"
                inputMode="none"
                readOnly
                value={selectedDraftSeason}
                aria-label="Draft Season"
                />
                <button type="button" aria-label="Next draft season" onClick={() => stepDraftSeason(1)} disabled={selectedDraftSeason >= 2100}>
                  <ChevronUp size={16} />
                </button>
              </span>
          </label>
          <button className="secondary-action compact-action" onClick={handleLoggedOut}>
            Log Out
          </button>
        </div>
      </header>

      {pickAnnouncement && (
        <div className={`pick-announcement ${pickAnnouncement.positionClassName}`} key={pickAnnouncement.id}>
          <span className="label">Drafted</span>
          <strong>
            {pickAnnouncement.playerName} - {pickAnnouncement.position} - {pickAnnouncement.nflTeam} - Pick {pickAnnouncement.pickNumber}
          </strong>
        </div>
      )}

      {exportAnnouncement && (
        <div className="pick-announcement export-announcement" key={exportAnnouncement.id}>
          <span className="label">Backup Downloaded</span>
          <strong>{exportAnnouncement.filename}</strong>
          <small>{exportAnnouncement.location}</small>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="app-content">
          {selectedPage === "commissioner" && canAccessCommissioner ? (
            <section className="page-section">
              <CommissionerTabs tabs={commissionerTabs} activeTabId={selectedCommissionerTab} onSelectTab={setSelectedCommissionerTab} />
            </section>
          ) : selectedPage === "login" ? (
            <LoginPage
              database={state.database}
              currentUser={currentUser}
              authToken={authToken}
              draftSeason={state.draft?.season ?? selectedDraftSeason}
              onAuthenticated={handleAuthenticated}
              onLoggedOut={handleLoggedOut}
            />
          ) : selectedPage === "keepers" ? (
            <section className="page-section">
              <KeepersPage
                teams={state.teams}
                keeperOptions={state.keeperOptions ?? []}
                selectedKeepers={state.selectedKeepers ?? []}
                players={state.players ?? []}
                picks={state.picks ?? []}
                draft={state.draft}
                draftSeason={selectedDraftSeason}
                canManageKeepers={canManageKeepers}
                currentUserTeamId={currentUser?.teamId ?? null}
                auditActor={auditActor}
                onSaved={applyAuditedState}
              />
            </section>
          ) : (
            <DraftRoom
              state={state}
              draftMode={draftMode}
              selectedDraftSeason={selectedDraftSeason}
              currentPick={currentPick}
              currentTeam={currentTeam}
              nextUpTeam={nextUpTeam}
              timerSeconds={timerSeconds}
              timerDisplay={timerDisplay}
              canManageDraft={canManageDraft}
              selectedTeamCanPick={selectedTeamCanPick}
              pendingPickId={pendingPickId}
              query={query}
              position={position}
              filteredPlayers={filteredPlayers}
              picksByRound={picksByRound}
              boardGridStyle={boardGridStyle}
              boardScrollRef={boardScrollRef}
              teamsWithTradedPicks={teamsWithTradedPicks}
              teamColorById={teamColorById}
              mockLobbyTeamId={mockLobbyTeamId}
              auditActor={auditActor}
              onQueryChange={setQuery}
              onPositionChange={setPosition}
              onMakePick={handleMakePick}
              onUndoPick={handleUndoPick}
              onDraftModeChange={handleDraftModeChange}
              onSimulatorStateChanged={applyDraftState}
              onMockReset={applyDraftState}
            />
          )}
      </div>
    </main>
  );
}
