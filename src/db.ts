import Dexie, { type Table } from 'dexie';

export type Task = {
  id: string;
  title: string;
  completed: boolean;
  updatedAt: number;
  deletedAt?: number;
};

export type OutboxOperation = {
  id?: number;
  entityId: string;
  type: 'upsert' | 'delete';
  payload: Task;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

class SyncDatabase extends Dexie {
  tasks!: Table<Task, string>;
  outbox!: Table<OutboxOperation, number>;

  constructor() {
    super('offline-first-sync-dexie');
    this.version(1).stores({
      tasks: 'id, updatedAt, deletedAt',
      outbox: '++id, entityId, createdAt, nextAttemptAt'
    });
  }
}

export const db = new SyncDatabase();

export async function enqueue(operation: Omit<OutboxOperation, 'id' | 'attempts' | 'nextAttemptAt'>) {
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    if (operation.type === 'delete') {
      await db.tasks.delete(operation.entityId);
    } else {
      await db.tasks.put(operation.payload);
    }

    // Coalesce older local changes for the same entity: only the newest state matters.
    await db.outbox.where('entityId').equals(operation.entityId).delete();
    await db.outbox.add({ ...operation, attempts: 0, nextAttemptAt: Date.now() });
  });
}
