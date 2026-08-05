/**
 * storage.ts — a tiny JSON key/value store over AsyncStorage, mirroring the
 * slice of chrome.storage.local the extension used (get/set/remove by key).
 *
 * Only the ENCRYPTED wallet blob is ever persisted here. The decrypted keys
 * live in memory for the unlocked session only (see WalletContext), so closing
 * the app drops them and re-opening lands back on the lock screen.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function getItem<T = any>(key: string): Promise<T | null> {
  try {
    const v = await AsyncStorage.getItem(key);
    if (v == null) return null;
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: any): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
