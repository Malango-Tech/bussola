import fs from "fs";
import os from "os";
import path from "path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  decryptSecretDetailed,
  encryptSecret,
  encryptionConfigured,
  resetKeyCache,
} from "./vault";

const KEY_ENV = "BUSSOLA_ENCRYPTION_KEY";
let original: string | undefined;
let originalDataDir: string | undefined;
let dataDir: string;

beforeEach(() => {
  original = process.env[KEY_ENV];
  originalDataDir = process.env.BUSSOLA_DATA_DIR;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-vault-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  resetKeyCache();
});

afterEach(() => {
  if (original === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = original;
  if (originalDataDir === undefined) delete process.env.BUSSOLA_DATA_DIR;
  else process.env.BUSSOLA_DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  resetKeyCache();
});

/** Encrypt the way versions before the key ring did, with a given key. */
function legacyEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

describe("vault", () => {
  it("round-trips a secret with a 64-char hex key", () => {
    process.env[KEY_ENV] = "a".repeat(64);
    const payload = encryptSecret("hunter2");
    expect(payload).not.toContain("hunter2");
    expect(decryptSecret(payload)).toBe("hunter2");
  });

  it("round-trips a secret with an arbitrary passphrase key", () => {
    process.env[KEY_ENV] = "not-hex-just-a-passphrase";
    expect(decryptSecret(encryptSecret("café ☕ unicode"))).toBe("café ☕ unicode");
  });

  it("generates a random local key when none is configured", () => {
    delete process.env[KEY_ENV];
    expect(decryptSecret(encryptSecret("local"))).toBe("local");

    const keyFile = path.join(dataDir, "encryption-key");
    const stored = fs.readFileSync(keyFile, "utf8");
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    // Owner-only, like the session secret.
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    // Not the constant earlier versions published in the repository.
    expect(Buffer.from(stored, "hex").equals(sha256("bussola-local-dev-key"))).toBe(false);
  });

  it("keeps using the same generated key across restarts", () => {
    delete process.env[KEY_ENV];
    const payload = encryptSecret("persisted");
    resetKeyCache();
    expect(decryptSecret(payload)).toBe("persisted");
  });

  it("still opens secrets written with the old public fallback key, flagged as legacy", () => {
    delete process.env[KEY_ENV];
    const old = legacyEncrypt(sha256("bussola-local-dev-key"), "from-before");
    expect(decryptSecretDetailed(old)).toEqual({
      plaintext: "from-before",
      legacy: true,
    });
    expect(decryptSecretDetailed(encryptSecret("new")).legacy).toBe(false);
  });

  it("stretches a passphrase with a KDF but still opens SHA-256-era secrets", () => {
    process.env[KEY_ENV] = "correct horse battery staple";
    const old = legacyEncrypt(sha256("correct horse battery staple"), "pre-kdf");
    expect(decryptSecretDetailed(old)).toEqual({ plaintext: "pre-kdf", legacy: true });

    const fresh = encryptSecret("post-kdf");
    expect(decryptSecretDetailed(fresh)).toEqual({ plaintext: "post-kdf", legacy: false });
    // The new derivation is not the old one.
    expect(() =>
      legacyDecrypt(sha256("correct horse battery staple"), fresh),
    ).toThrow();
  });

  it("rejects a truncated auth tag", () => {
    process.env[KEY_ENV] = "a".repeat(64);
    const [iv, tag, data] = encryptSecret("secret").split(".");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(() => decryptSecret([iv, short, data].join("."))).toThrow(
      /invalid encrypted payload/i,
    );
  });

  it("produces a unique IV per call", () => {
    process.env[KEY_ENV] = "b".repeat(64);
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    process.env[KEY_ENV] = "c".repeat(64);
    const [iv, tag, data] = encryptSecret("secret").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0x01;
    const tampered = [iv, tag, flipped.toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("nope")).toThrow(/invalid encrypted payload/i);
  });

  it("cannot decrypt with the wrong key", () => {
    process.env[KEY_ENV] = "d".repeat(64);
    const payload = encryptSecret("secret");
    process.env[KEY_ENV] = "e".repeat(64);
    resetKeyCache();
    expect(() => decryptSecret(payload)).toThrow();
  });

  it("reports whether an explicit key is configured", () => {
    process.env[KEY_ENV] = "f".repeat(64);
    expect(encryptionConfigured()).toBe(true);
    delete process.env[KEY_ENV];
    expect(encryptionConfigured()).toBe(false);
  });
});

function legacyDecrypt(key: Buffer, payload: string): string {
  const [iv, tag, data] = payload.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
