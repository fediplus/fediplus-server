/**
 * IndexedDB-backed CryptoKey storage.
 *
 * Web Crypto CryptoKey objects are structured-cloneable, so they survive
 * IndexedDB round-trips without export/import.  This lets the decrypted
 * identity key persist across page reloads while staying in-browser only.
 */

const DB_NAME = "fediplus-keystore";
const DB_VERSION = 1;
const STORE_NAME = "keys";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Store the user's decrypted identity private key. */
export async function storeIdentityKey(
  userId: string,
  key: CryptoKey
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, `identity-${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load the user's identity private key (if it was stored in this browser). */
export async function loadIdentityKey(
  userId: string
): Promise<CryptoKey | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(`identity-${userId}`);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Store a prekey private key (used when someone consumes our key package). */
export async function storePrekeyPrivateKey(
  keyPackageId: string,
  key: CryptoKey
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, `prekey-${keyPackageId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a prekey private key by its key package ID. */
export async function loadPrekeyPrivateKey(
  keyPackageId: string
): Promise<CryptoKey | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(`prekey-${keyPackageId}`);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Store the group secret for a conversation epoch. */
export async function storeGroupSecret(
  conversationId: string,
  epoch: number,
  secret: Uint8Array
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(secret, `group-${conversationId}-${epoch}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a group secret for a specific conversation epoch. */
export async function loadGroupSecret(
  conversationId: string,
  epoch: number
): Promise<Uint8Array | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx
      .objectStore(STORE_NAME)
      .get(`group-${conversationId}-${epoch}`);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Clear all keys (used on logout). */
export async function clearKeystore(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
