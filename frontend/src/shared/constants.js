export const POSITIONS = ["QB", "RB", "WR", "TE", "DST", "K"];
export const EARLY_ROUND_PICK_TIMER_SECONDS = 90;
export const LATE_ROUND_PICK_TIMER_SECONDS = 120;
export const PICK_TIMER_ROUND_CUTOFF = 10;
export const COMMISSIONER_ID = "commissioner";
export const AUTH_TOKEN_STORAGE_KEY = "fantasy-draft-auth-token";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TEAM_COLORS = [
  "#2662d9",
  "#1f8a4c",
  "#c2410c",
  "#7c3aed",
  "#b91c1c",
  "#0f766e",
  "#a16207",
  "#be185d",
  "#4f46e5",
  "#15803d",
  "#0369a1",
  "#9333ea"
];
export const PAGES = [
  { id: "draft", label: "Draft Room" },
  { id: "login", label: "Login" },
  { id: "keepers", label: "Keepers" },
  { id: "commissioner", label: "Commissioner" }
];

export const IMPORTS = [
  {
    type: "players",
    label: "Player Pool",
    columns: "rank,name,position,nflTeam,byeWeek"
  },
  {
    type: "last-year-draft-rounds",
    label: "Last Year Draft Rounds CSV",
    columns: "Headerless CSV. Row 1 = Round 1. Used only to determine keeper cost."
  }
];
export const ACCOUNT_PERMISSIONS = [
  "commissioner_admin",
  "sync_fleaflicker",
  "manage_rankings",
  "manage_keepers",
  "manage_draft",
  "view_audit_log"
];
