export function getStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] Failed to read "${key}" from localStorage.`, error);
    return null;
  }
}

export function setStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[storage] Failed to write "${key}" to localStorage.`, error);
  }
}

export function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[storage] Failed to remove "${key}" from localStorage.`, error);
  }
}

export function getStorageJson<T>(key: string, fallback: T): T {
  const raw = getStorageItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[storage] Failed to parse JSON from "${key}".`, error);
    removeStorageItem(key);
    return fallback;
  }
}