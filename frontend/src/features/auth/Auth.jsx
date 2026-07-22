import React, { useState } from "react";
import { LockKeyhole, Mail, UserRound } from "lucide-react";
import { loginAccount, logoutAccount, registerAccount } from "../../api.js";

export function AccountAccessPanel({ database, currentUser, authToken, draftSeason, onAuthenticated, onLoggedOut }) {
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(null);
  const [busyAction, setBusyAction] = useState("");

  async function handleAuth(event) {
    event.preventDefault();
    const action = authMode === "register" ? "register" : "login";
    setBusyAction(action);
    setNotice(null);
    try {
      const result = action === "register"
        ? await registerAccount(name, email, password)
        : await loginAccount(email, password);
      onAuthenticated(result);
      setName("");
      setPassword("");
      setNotice({ type: "success", text: action === "register" ? "Account created and logged in." : "Logged in." });
    } catch (caught) {
      setNotice({ type: "error", text: caught.response?.data?.error ?? caught.message });
    } finally {
      setBusyAction("");
    }
  }

  async function handleLogout() {
    setBusyAction("logout");
    setNotice(null);
    try {
      await logoutAccount(authToken);
      onLoggedOut();
    } catch (caught) {
      setNotice({ type: "error", text: caught.response?.data?.error ?? caught.message });
    } finally {
      setBusyAction("");
    }
  }

  function switchMode(mode) {
    setAuthMode(mode);
    setNotice(null);
    setPassword("");
  }

  if (currentUser) {
    return (
      <section className="commissioner-panel auth-session-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Account</p>
            <h2>Signed in</h2>
          </div>
        </div>
        <div className="account-session">
          <div>
            <strong>{currentUser.displayName}</strong>
            <span>{currentUser.email}</span>
            <small>{currentUser.permissions?.length ? currentUser.permissions.join(", ") : "normal user"}</small>
          </div>
          <button type="button" className="secondary-action" disabled={busyAction === "logout"} onClick={handleLogout}>
            {busyAction === "logout" ? "Logging out..." : "Log Out"}
          </button>
        </div>
        {notice?.type === "error" && <div className="error-banner auth-alert" role="alert">{notice.text}</div>}
      </section>
    );
  }

  const databaseUnavailable = !database?.connected;
  const submitting = Boolean(busyAction);
  const formIncomplete = !email || !password || (authMode === "register" && !name);

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card-accent" />
      <header className="auth-card-header">
        <div className="auth-season">{draftSeason} Draft Season</div>
        <p className="eyebrow">RotoBaller Keeper League</p>
        <h2 id="auth-title">{authMode === "register" ? "Create your account" : "Welcome back"}</h2>
        <p>
          {authMode === "register"
            ? "Create an account to join the Franzia Keeper Draft."
            : "Sign in to manage your keepers and enter the draft room."}
        </p>
      </header>

      <form className="auth-form" onSubmit={handleAuth}>
        {authMode === "register" && (
          <label className="auth-field">
            <span>Name</span>
            <span className="auth-input-wrap">
              <UserRound size={20} aria-hidden="true" />
              <input
                autoComplete="name"
                value={name}
                disabled={databaseUnavailable || submitting}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                required
              />
            </span>
          </label>
        )}

        <label className="auth-field">
          <span>Email</span>
          <span className="auth-input-wrap">
            <Mail size={20} aria-hidden="true" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={databaseUnavailable || submitting}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoFocus
              required
            />
          </span>
        </label>

        <label className="auth-field">
          <span>Password</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={20} aria-hidden="true" />
            <input
              type="password"
              autoComplete={authMode === "register" ? "new-password" : "current-password"}
              value={password}
              disabled={databaseUnavailable || submitting}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </span>
        </label>

        {databaseUnavailable && <div className="import-message auth-alert" role="status">PostgreSQL is required for account access.</div>}
        {notice?.type === "error" && <div className="error-banner auth-alert" role="alert">{notice.text}</div>}
        {notice?.type === "success" && <div className="import-message auth-alert" role="status">{notice.text}</div>}

        <button className="primary-action auth-submit" disabled={databaseUnavailable || submitting || formIncomplete} type="submit">
          {busyAction === "register" ? "Creating account..." : busyAction === "login" ? "Signing in..." : authMode === "register" ? "Create Account" : "Log In"}
        </button>
      </form>

      <div className="auth-secondary-action">
        <span>{authMode === "register" ? "Already have an account?" : "New to the league?"}</span>
        <button type="button" className="secondary-action" disabled={submitting} onClick={() => switchMode(authMode === "register" ? "login" : "register")}>
          {authMode === "register" ? "Back to Login" : "Create Account"}
        </button>
      </div>
    </section>
  );
}

export function LoginPage({ database, currentUser, authToken, draftSeason, onAuthenticated, onLoggedOut }) {
  return (
    <section className="login-page">
      <AccountAccessPanel
        database={database}
        currentUser={currentUser}
        authToken={authToken}
        draftSeason={draftSeason}
        onAuthenticated={onAuthenticated}
        onLoggedOut={onLoggedOut}
      />
    </section>
  );
}
