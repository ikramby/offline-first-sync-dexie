import { db, type OutboxOperation, type Task } from './db';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';
export type SyncSnapshot = { state: SyncState; pending: number; lastSyncedAt?: number; error?: string };

type SyncListener = (snapshot: SyncSnapshot) => void;

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

export class SyncEngine {
  private listeners = new Set<SyncListener>();
  private running = false;
  private snapshot: SyncSnapshot = { state: navigator.onLine ? 'idle' : 'offline', pending: 0 };

  subscribe(listener: SyncListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async start() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    await this.refreshPending();
    if (navigator.onLine) await this.flush();
  }

  stop() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  async flush() {
    if (this.running || !navigator.onLine) return;
    this.running = true;
    this.setSnapshot({ state: 'syncing', error: undefined });

    try {
      const ready = await db.outbox.where('nextAttemptAt').belowOrEqual(Date.now()).toArray();
      for (const operation of ready) await this.push(operation);
      await this.refreshPending();
      this.setSnapshot({ state: 'idle', lastSyncedAt: Date.now(), error: undefined });
    } catch (error) {
      this.setSnapshot({ state: 'error', error: error instanceof Error ? error.message : 'Sync failed' });
    } finally {
      this.running = false;
    }
  }

  private async push(operation: OutboxOperation) {
    try {
      await fakeServerRequest(operation);
      if (operation.id !== undefined) await db.outbox.delete(operation.id);
    } catch (error) {
      const attempts = operation.attempts + 1;
      if (operation.id === undefined) return;
      if (attempts >= MAX_ATTEMPTS) {
        await db.outbox.update(operation.id, { attempts, lastError: 'Maximum retries reached', nextAttemptAt: Number.MAX_SAFE_INTEGER });
        throw new Error(`Operation ${operation.id} reached the retry limit`);
      }
      const delay = BASE_DELAY_MS * 2 ** (attempts - 1);
      await db.outbox.update(operation.id, {
        attempts,
        lastError: error instanceof Error ? error.message : 'Request failed',
        nextAttemptAt: Date.now() + delay
      });
      throw error;
    }
  }

  private async refreshPending() {
    this.setSnapshot({ pending: await db.outbox.count() });
  }

  private setSnapshot(next: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private handleOnline = () => void this.flush();
  private handleOffline = () => this.setSnapshot({ state: 'offline' });
}

// A deterministic local server keeps the example runnable without credentials or a backend.
// Toggle the checkbox in the UI to simulate a transient failure and observe retries.
let failNextRequest = false;
export function simulateNextFailure() { failNextRequest = true; }

async function fakeServerRequest(operation: OutboxOperation): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (failNextRequest) {
    failNextRequest = false;
    throw new Error('Simulated transient network failure');
  }
  console.info('[server]', operation.type, operation.payload.id, operation.payload.title);
}

export async function saveTask(task: Task) {
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    await db.tasks.put(task);
    await db.outbox.where('entityId').equals(task.id).delete();
    await db.outbox.add({ entityId: task.id, type: 'upsert', payload: task, createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now() });
  });
}

export async function deleteTask(task: Task) {
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    const tombstone = { ...task, deletedAt: Date.now(), updatedAt: Date.now() };
    await db.tasks.delete(task.id);
    await db.outbox.where('entityId').equals(task.id).delete();
    await db.outbox.add({ entityId: task.id, type: 'delete', payload: tombstone, createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now() });
  });
}
