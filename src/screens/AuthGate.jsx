import { useState } from 'react';
import * as db from '../lib/db/index.js';

/**
 * Sign-in, shown only when the app is pointed at a shared Supabase workspace.
 *
 * Email and password rather than a magic link: accounts are created in the
 * Supabase dashboard, so nothing here depends on an email arriving. On an
 * event build over course wifi that is the difference between signing in and
 * not.
 */
export default function AuthGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await db.auth.signIn(email.trim(), password);
      // The auth listener in App picks this up and loads the workspace.
    } catch (err) {
      setError(/invalid login credentials/i.test(err.message)
        ? 'That email and password do not match an account.'
        : err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg">
      <form className="card modal" onSubmit={submit}>
        <h2>Bolt6 Course Planner</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Sign in to reach the shared workspace — courses, plans and kits are the same for
          everyone on the team.
        </p>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required
                 placeholder="you@bolt6.com"
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <div className="banner bad">{error}</div>}

        <button className="btn primary" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
          No account? Whoever administers the Supabase project creates one for you.
        </p>
      </form>
    </div>
  );
}
