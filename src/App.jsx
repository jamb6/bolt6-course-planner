import { useState, useEffect } from 'react';
import TokenGate from './screens/TokenGate.jsx';
import AuthGate from './screens/AuthGate.jsx';
import CoursePicker from './screens/CoursePicker.jsx';
import PlanPicker from './screens/PlanPicker.jsx';
import Planner from './screens/Planner.jsx';
import Settings from './screens/Settings.jsx';
import { useStore } from './store/useStore.js';
import * as db from './lib/db/index.js';
import './styles.css';

/**
 * Boot, then four screens in order: course -> plan -> map.
 *
 * Booting means loading the workspace. On a shared Supabase workspace that
 * needs a signed-in user first, because the tables are behind row-level
 * security; on localStorage it is immediate.
 */
export default function App() {
  const token = useStore((s) => s.token);
  const course = useStore((s) => s.course);
  const plan = useStore((s) => s.plan);
  const openPlan = useStore((s) => s.openPlan);
  const closePlan = useStore((s) => s.closePlan);

  const [boot, setBoot] = useState({ state: 'loading', user: null });
  const [pendingCourse, setPendingCourse] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const start = async (user) => {
      try {
        await db.init();
        if (live) setBoot({ state: 'ready', user });
      } catch (err) {
        if (live) setBoot({ state: 'error', message: err.message });
      }
    };

    (async () => {
      if (!db.auth.enabled) return start(null);
      const user = await db.auth.currentUser();
      if (!live) return;
      if (!user) return setBoot({ state: 'signed-out', user: null });
      start(user);
      db.auth.onChange((next) => {
        if (!live) return;
        if (!next) setBoot({ state: 'signed-out', user: null });
      });
    })();

    return () => { live = false; };
  }, []);

  if (boot.state === 'signed-out') return <AuthGate />;

  if (boot.state === 'loading') {
    return (
      <div className="modal-bg">
        <div className="card modal"><h2>Loading the workspace…</h2></div>
      </div>
    );
  }

  if (boot.state === 'error') {
    return (
      <div className="modal-bg">
        <div className="card modal">
          <h2>Could not load the workspace</h2>
          <div className="banner bad">{boot.message}</div>
          <button className="btn" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!token) return <TokenGate />;
  if (settingsOpen) return <Settings onBack={() => setSettingsOpen(false)} />;

  if (course && plan) {
    return <Planner onExit={() => { closePlan(); setPendingCourse(null); }} />;
  }

  if (pendingCourse) {
    return (
      <PlanPicker
        course={pendingCourse}
        onBack={() => setPendingCourse(null)}
        onOpen={(p) => openPlan(pendingCourse, p)}
      />
    );
  }

  return <CoursePicker token={token} onPick={setPendingCourse}
                       onSettings={() => setSettingsOpen(true)} />;
}
