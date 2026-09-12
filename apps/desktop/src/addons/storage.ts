import { accountStorageKey } from "../lib/session-lifecycle";

export const ADDON_STORAGE_BYTES = 256 * 1024;
export const ADDON_STORAGE_KEYS = 64;
export const ADDON_VALUE_BYTES = 16 * 1024;
/** Slash is forbidden in both addon IDs and keys. Dots are not separators. */
export const addonStoragePrefix = (id: string): string =>
  accountStorageKey(`wr.addon/${id}/`);
export function addonStorageKey(id: string, key: unknown): string {
  if (typeof key !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))
    throw new Error("Invalid store key");
  return addonStoragePrefix(id) + key;
}
export function writeAddonValue(
  storage: Storage,
  id: string,
  key: unknown,
  value: unknown,
): void {
  const name = addonStorageKey(id, key);
  if (value === undefined) {
    storage.removeItem(name);
    return;
  }
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Not a JSON value");
  const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
  if (bytes(text) > ADDON_VALUE_BYTES)
    throw new Error("The store holds 16 KiB per value");
  let size = bytes(text),
    count = 1;
  const prefix = addonStoragePrefix(id);
  for (let i = 0; i < storage.length; i++) {
    const other = storage.key(i);
    if (other && other !== name && other.startsWith(prefix)) {
      count++;
      size += bytes(storage.getItem(other) ?? "");
    }
  }
  if (count > ADDON_STORAGE_KEYS || size > ADDON_STORAGE_BYTES)
    throw new Error("Addon storage quota exceeded");
  storage.setItem(name, text);
}
