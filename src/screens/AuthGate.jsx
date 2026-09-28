import { useState } from 'react';
import * as db from '../lib/db/index.js';

/**
 * Sign-in, shown only when the app is pointed at a shared Supabase workspace.
 * Magic link rather than passwords — one less thing to manage, and nobody has
 * to invent a password for an internal tool.
 */
export default function AuthGate() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await db.auth.signIn(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="modal-bg">
        <div className="card modal">
          <h2>Check your email</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
            A sign-in link is on its way to <b>{email}</b>. Open it on this device and you
            will land back here, signed in.
          </p>
          <button className="btn" onClick={() => setSent(false)}>Use a different address</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-bg">
      <form className="card modal" onSubmit={send}>
        <h2>Bolt6 Course Planner</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Sign in to reach the shared workspace — courses, plans and kits are the same for
          everyone on the team.
        </p>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" required
                 placeholder="you@bolt6.com"
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <div className="banner bad">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
    </div>
  );
}
