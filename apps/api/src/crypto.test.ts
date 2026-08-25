import { describe, expect, test } from "vitest";
import {
  generateRootKey,
  generateToken,
  open,
  safeEqual,
  seal,
} from "./crypto";

describe("envelope encryption", () => {
  const rootKey = generateRootKey();

  test("a refresh token round-trips", async () => {
    const sealed = await seal(rootKey, "user-1", "1//0eXampleRefreshToken");
    expect(sealed.ciphertext).not.toContain("Refresh");
    expect(await open(rootKey, "user-1", sealed)).toBe(
      "1//0eXampleRefreshToken",
    );
  });

  test("each seal uses a fresh IV, so identical plaintext differs on disk", async () => {
    const a = await seal(rootKey, "user-1", "same");
    const b = await seal(rootKey, "user-1", "same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  // The point of deriving per user: one leaked derived key is not a master key.
  test("another user's derived key cannot decrypt it", async () => {
    const sealed = await seal(rootKey, "user-1", "secret");
    await expect(open(rootKey, "user-2", sealed)).rejects.toThrow();
  });

  test("a different root key cannot decrypt it", async () => {
    const sealed = await seal(rootKey, "user-1", "secret");
    await expect(open(generateRootKey(), "user-1", sealed)).rejects.toThrow();
  });

  // AES-GCM is authenticated: tampering must fail, not silently return garbage.
  test("tampered ciphertext is rejected", async () => {
    const sealed = await seal(rootKey, "user-1", "secret");
    const flipped = `${sealed.ciphertext.slice(0, -4)}AAAA`;
    await expect(
      open(rootKey, "user-1", { ...sealed, ciphertext: flipped }),
    ).rejects.toThrow();
  });

  test("the root key is 32 bytes", () => {
    expect(atob(generateRootKey())).toHaveLength(32);
  });
});

describe("generateToken", () => {
  test("is url-safe and unguessable", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(new Set(Array.from({ length: 100 }, generateToken)).size).toBe(100);
  });
});

describe("safeEqual", () => {
  test("compares correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
