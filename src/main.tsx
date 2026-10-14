import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Task } from './db';
import { deleteTask, saveTask, simulateNextFailure, SyncEngine, type SyncSnapshot } from './sync';
import './styles.css';

const engine = new SyncEngine();

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({ state: navigator.onLine ? 'idle' : 'offline', pending: 0 });
  const [title, setTitle] = useState('');

  const reload = async () => setTasks(await db.tasks.orderBy('updatedAt').reverse().toArray());

  useEffect(() => {
    void engine.start();
    const unsubscribe = engine.subscribe(setSnapshot);
    const interval = window.setInterval(() => void reload(), 500);
    void reload();
    return () => { unsubscribe(); engine.stop(); window.clearInterval(interval); };
  }, []);

  const addTask = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    await saveTask({ id: crypto.randomUUID(), title: cleanTitle, completed: false, updatedAt: Date.now() });
    setTitle('');
    await reload();
    void engine.flush();
  };

  const toggleTask = async (task: Task) => {
    await saveTask({ ...task, completed: !task.completed, updatedAt: Date.now() });
    await reload();
    void engine.flush();
  };

  const removeTask = async (task: Task) => {
    await deleteTask(task);
    await reload();
    void engine.flush();
  };

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">OFFLINE-FIRST REFERENCE IMPLEMENTATION</p>
          <h1>Field notes</h1>
          <p className="lede">A small, resilient task list powered by Dexie, an outbox, retry backoff, and a service worker.</p>
        </div>
        <div className={`status ${snapshot.state}`}><span className="dot" />{snapshot.state}</div>
      </header>

      <section className="panel demo-panel">
        <div className="panel-heading"><div><span className="label">LIVE DEMO</span><h2>Capture work anywhere</h2></div><span className="pending">{snapshot.pending} pending</span></div>
        <form onSubmit={(event) => { event.preventDefault(); void addTask(); }} className="composer">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task while offline…" aria-label="Task title" />
          <button type="submit">Add task</button>
        </form>
        <div className="task-list">
          {tasks.length === 0 ? <p className="empty">No local tasks yet. Add one, then turn off your connection.</p> : tasks.map((task) => (
            <div className="task" key={task.id}>
              <button className={`check ${task.completed ? 'checked' : ''}`} onClick={() => void toggleTask(task)} aria-label={`Mark ${task.title} complete`}>{task.completed ? '✓' : ''}</button>
              <span className={task.completed ? 'done' : ''}>{task.title}</span>
              <button className="delete" onClick={() => void removeTask(task)} aria-label={`Delete ${task.title}`}>×</button>
            </div>
          ))}
        </div>
        <div className="controls"><button className="secondary" onClick={() => { simulateNextFailure(); void engine.flush(); }}>Simulate one failure</button><button className="secondary" onClick={() => void engine.flush()}>Sync now</button></div>
      </section>

      <section className="grid">
        <article className="panel"><span className="label">LOCAL-FIRST</span><h3>Write locally first</h3><p>Every mutation is committed to IndexedDB and the outbox in one Dexie transaction. The UI never waits for the network.</p></article>
        <article className="panel"><span className="label">RELIABILITY</span><h3>Retry with intent</h3><p>Pending operations use exponential backoff. Changes for one entity are coalesced to avoid replaying stale intermediate states.</p></article>
        <article className="panel"><span className="label">DELIVERY</span><h3>Background-ready</h3><p>The service worker caches the shell. The sync engine listens for connectivity changes and is ready to connect to a real API.</p></article>
      </section>
      <footer><span>offline-first-sync-dexie</span><span>Last sync: {snapshot.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toLocaleTimeString() : 'not yet'}</span></footer>
    </main>
  );
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
createRoot(document.getElementById('root')!).render(<App />);
