import { emptyState, validateState, createInitiative, createLink, setArchived, mergeBackup, toBackup } from "./core.mjs";

export const DATABASE_NAME = "learn-campaign-links";

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Browser storage is unavailable. Enable site storage or use a supported browser."));
      return;
    }
    const request = indexedDB.open(name, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("library");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Storage upgrade is blocked. Close other tabs of this site, then reload."));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
  });
}

export class Store {
  constructor(name = DATABASE_NAME) {
    this.name = name;
  }

  async transact(mutate) {
    let db;
    try {
      db = await openDatabase(this.name);
      return await new Promise((resolve, reject) => {
        // Read, validate, and write in one transaction so tabs cannot overwrite stale snapshots.
        const transaction = db.transaction("library", mutate ? "readwrite" : "readonly");
        const objectStore = transaction.objectStore("library");
        const request = objectStore.get("state");
        let result;
        let failure;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || transaction.error || new Error("Storage transaction was interrupted."));
        transaction.onerror = () => { failure ||= transaction.error; };
        request.onsuccess = () => {
          try {
            const state = request.result === undefined ? emptyState() : validateState(request.result);
            if (mutate) {
              result = mutate(state);
              state.updatedAt = new Date().toISOString();
              const validated = validateState(state);
              toBackup(validated);
              objectStore.put(validated, "state");
            } else result = state;
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
      });
    } catch (error) {
      throw new Error(`${mutate ? "Could not save" : "Could not read"} your browser library: ${error.message} No existing data was overwritten. If storage is full or blocked, allow site storage or free space, then retry. Keep JSON backups.`);
    } finally {
      db?.close();
    }
  }

  read() { return this.transact(); }
  createInitiative(input) { return this.transact((state) => createInitiative(state, input)); }
  createLink(input) { return this.transact((state) => createLink(state, input)); }
  setArchived(input) { return this.transact((state) => setArchived(state, input)); }
  importBackup(input) {
    const incoming = validateState(input);
    return this.transact((state) => mergeBackup(state, incoming));
  }
}
