export function getMockBoardUserId({ mockUserId = null, mockLobbyTeamId = null } = {}) {
  return mockUserId ?? mockLobbyTeamId ?? null;
}

export function shouldApplyMockStateForUser(nextState, currentUserId) {
  if (nextState?.draft?.status !== "mock" || !nextState?.draft?.mockUserId) {
    return true;
  }

  return nextState.draft.mockUserId === getMockBoardUserId({ mockUserId: currentUserId });
}
