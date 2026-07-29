/**
 * FIELD 첨부 사진의 기기 보관소 (IndexedDB).
 * 새로고침·모바일 브라우저 재시작 후에도 전송 전 사진이 살아남도록 모드별로 저장한다.
 * 전송 완료·삭제 시 함께 정리해 용량이 쌓이지 않게 한다.
 */
const DB_NAME = "firstoa_field_photos";
const STORE = "photos";

type StoredPhoto = { id: string; mode: string; name: string; type: string; blob: Blob; ts: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("mode", "mode");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(writable: boolean, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, writable ? "readwrite" : "readonly");
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req ? (req.result as T) : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    return undefined; // 저장 실패는 조용히 — 첨부 기능 자체는 메모리로 계속 동작
  }
}

export async function photoStorePut(mode: string, id: string, file: File): Promise<void> {
  await withStore(true, (store) => { store.put({ id, mode, name: file.name, type: file.type, blob: file, ts: Date.now() } satisfies StoredPhoto); });
}

export async function photoStoreDelete(id: string): Promise<void> {
  await withStore(true, (store) => { store.delete(id); });
}

export async function photoStoreClearMode(mode: string): Promise<void> {
  await withStore(true, (store) => {
    const index = store.index("mode");
    const req = index.openCursor(IDBKeyRange.only(mode));
    req.onsuccess = () => { const cursor = req.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  });
}

// 전체 로드: 모드별 File 목록으로 복원 (앱 시작 시 1회)
export async function photoStoreLoadAll(): Promise<Record<string, { id: string; file: File }[]>> {
  const all = (await withStore<StoredPhoto[]>(false, (store) => store.getAll())) || [];
  const byMode: Record<string, { id: string; file: File }[]> = {};
  for (const item of all.sort((a, b) => a.ts - b.ts)) {
    const file = new File([item.blob], item.name || "photo.jpg", { type: item.type || "image/jpeg" });
    (byMode[item.mode] = byMode[item.mode] || []).push({ id: item.id, file });
  }
  return byMode;
}
