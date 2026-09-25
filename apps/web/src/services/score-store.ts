import type { Score } from "@sower/core";

// DB name kept from the old project name on purpose — renaming the database
// would orphan scores already saved in users' browsers.
const DB_NAME = "stdbd";
const DB_VERSION = 1;
const STORE = "scores";
const ACTIVE_KEY = "active-score";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open database"));
    };
  });
}

export async function loadActiveScore(): Promise<Score | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<Score | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(ACTIVE_KEY);
        request.onsuccess = () => {
          resolve((request.result as Score | undefined) ?? null);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("Failed to load score"));
        };
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveActiveScore(score: Score): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(score, ACTIVE_KEY);
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error("Failed to save score"));
        };
      });
    } finally {
      db.close();
    }
  } catch {
    // storage unavailable (private mode, quota) — editing continues in-memory
  }
}

/** Debounced autosave subscription for a ScoreDocument. */
export function attachAutosave(
  doc: { score: Score; subscribe(listener: () => void): () => void },
  delayMs = 600,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = doc.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveActiveScore(doc.score);
    }, delayMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    off();
  };
}
