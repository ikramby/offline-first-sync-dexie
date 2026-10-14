# offline-first-sync-dexie

A small, dependency-light reference implementation of an **offline-first synchronization layer** for field and mobile-style web applications.

> The repository intentionally contains no customer data, private APIs, company names, or production credentials. It is a standalone example designed to make the synchronization design easy to review.

## Why this exists

Users working in the field should be able to capture changes even when connectivity is slow or unavailable. Waiting for a remote API before updating the UI creates fragile workflows and poor user experience.

This example treats the local database as the first write target, then synchronizes pending mutations when a connection is available.

## What is included

- **Dexie / IndexedDB** for durable local task storage.
- A transactional **outbox** for pending mutations.
- **Coalescing** of older changes for the same entity.
- **Exponential backoff** with a bounded retry limit.
- A cache-first **service worker** for the application shell.
- Online/offline event handling and a small interactive demo.
- A deterministic fake server so the example runs without credentials or a backend.

## Architecture

```text
User action
    |
    v
Dexie transaction: update local task + append outbox operation
    |
    v
UI updates immediately                 Connectivity returns
                                             |
                                             v
                                      SyncEngine.flush()
                                             |
                                             v
                          fake API request (replace with fetch)
                              |                    |
                         success                failure
                              |                    |
                  delete outbox item      attempts + 2^n backoff
```

## Design choices and trade-offs

### Local-first writes
The task and its outbox entry are written in one IndexedDB transaction. This prevents a local state from existing without a corresponding sync operation. The trade-off is that the example needs a conflict policy when multiple devices edit the same record.

### Coalescing
Only the newest pending operation for an entity is retained. This reduces redundant network traffic and avoids replaying stale intermediate states. It is appropriate for last-write-wins task updates; append-only events would need a different strategy.

### Retry policy
Retries use exponential backoff and stop after five attempts. Permanent failures remain visible in the outbox rather than being silently discarded. A production implementation would add jitter, structured error classes, authentication refresh, and a dead-letter workflow.

### Deletions
Deletes use a tombstone payload so a real API can propagate the intent. This demo removes the record locally; a production sync protocol should retain server-side tombstones long enough to prevent deleted records from reappearing on another client.

### Service worker scope
The service worker caches the application shell and runtime GET requests. It does not intercept mutations: writes are handled by the explicit outbox, where retry and observability are easier to reason about.

## Run the example

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Add tasks, click **Simulate one failure**, and use the browser's network controls to test the offline path. The data survives reloads because it is stored in IndexedDB.

To create a production build:

```bash
npm run build
npm run preview
```

## Extending this into a real API

Replace `fakeServerRequest` in `src/sync.ts` with an authenticated request that sends an operation ID, entity ID, mutation type, payload, and client timestamp. The server should make operation IDs idempotent, validate authorization, and return the server version or conflict information. The client can then add a conflict-resolution policy appropriate to the domain.

## Project structure

```text
src/
  db.ts       Dexie schema and transactional outbox helpers
  sync.ts     flush loop, retry/backoff, connectivity handling
  main.tsx    example UI and user interactions
  styles.css  responsive visual design
public/
  sw.js       application-shell service worker
```

## License

MIT. See `LICENSE`.
