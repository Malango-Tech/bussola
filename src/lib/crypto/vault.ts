import fs from "fs";
import path from "path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "crypto";
import { dataDir, env } from "@/lib/env";
import { logger } from "@/lib/log";

const log = logger("vault");

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Fixed rather than random: the salt has to be the same on every boot to
 * derive the same key, and its job here is domain separation (this passphrase
 * hashed for this purpose), not per-record uniqueness — the IV provides that.
 */
const KDF_SALT = "bussola-vault-v1";

type KeyRing = {
  /** What new secrets are encrypted with. */
  current: Buffer;
  /**
   * Keys earlier versions derived from the same configuration. Only ever used
   * to decrypt, so that an existing install keeps working after upgrading and
   * `reencryptLegacySecrets` can move its rows onto `current`.
   */
  legacy: Buffer[];
};

let cached: { fingerprint: string; ring: KeyRing } | undefined;

/**
 * The key ring for the current configuration.
 *
 * - A 64-char hex `BUSSOLA_ENCRYPTION_KEY` is the key itself.
 * - Any other value is a passphrase, stretched with scrypt. Earlier versions
 *   used one round of SHA-256, which is kept as a legacy decryption key.
 * - Nothing set (self-hosted only; cloud refuses to start) means a random
 *   32-byte key generated once and kept in the data directory with owner-only
 *   permissions, exactly like the session secret. Earlier versions fell back to
 *   a constant published in this repository — anyone with a copy of the
 *   database could decrypt every provider token with it — so that constant is
 *   now only a legacy key, and startup re-encrypts rows away from it.
 */
function keyRing(): KeyRing {
  const raw = env().BUSSOLA_ENCRYPTION_KEY;
  const fingerprint = `${raw ?? ""}\u0000${dataDir()}`;
  if (cached?.fingerprint === fingerprint) return cached.ring;

  let ring: KeyRing;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    ring = { current: Buffer.from(raw, "hex"), legacy: [] };
  } else if (raw) {
    ring = {
      current: scryptSync(raw, KDF_SALT, 32),
      legacy: [createHash("sha256").update(raw).digest()],
    };
  } else {
    ring = {
      current: generatedKey(),
      legacy: [createHash("sha256").update("bussola-local-dev-key").digest()],
    };
  }

  cached = { fingerprint, ring };
  return ring;
}

function generatedKey(): Buffer {
  const keyFile = path.join(dataDir(), "encryption-key");

  try {
    const existing = fs.readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return Buffer.from(existing, "hex");
  } catch (error) {
    // Not created yet — fall through and write one. Any other failure to
    // read it is worth a line: the exclusive write below will then refuse to
    // replace the file, and this is the context for that error.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("could not read the encryption key file", { file: keyFile }, error);
    }
  }

  const generated = randomBytes(32);
  fs.mkdirSync(dataDir(), { recursive: true });
  // Owner-only, and never overwritten: losing this file loses every stored
  // credential, so an existing one (even unreadable to us) is not replaced.
  fs.writeFileSync(keyFile, generated.toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
  log.info("generated an encryption key", { file: keyFile });
  return generated;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyRing().current, iv, {
    authTagLength: TAG_BYTES,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

function decryptWith(
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  data: Buffer,
): string {
  const decipher = createDecipheriv(ALGO, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Decrypt, and say whether it took a legacy key to do it.
 *
 * GCM authenticates, so trying the keys in turn is safe: a wrong key fails
 * the tag check rather than producing garbage.
 */
export function decryptSecretDetailed(payload: string): {
  plaintext: string;
  legacy: boolean;
} {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  // A truncated tag would weaken the authentication GCM exists to provide.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted payload");
  }
  const data = Buffer.from(dataB64, "base64");

  const ring = keyRing();
  try {
    return { plaintext: decryptWith(ring.current, iv, tag, data), legacy: false };
  } catch (error) {
    for (const key of ring.legacy) {
      try {
        return { plaintext: decryptWith(key, iv, tag, data), legacy: true };
      } catch {
        // Try the next one; the original error is what gets reported.
      }
    }
    throw error;
  }
}

export function decryptSecret(payload: string): string {
  return decryptSecretDetailed(payload).plaintext;
}

export function encryptionConfigured(): boolean {
  return Boolean(env().BUSSOLA_ENCRYPTION_KEY);
}

/** Exposed for tests, which switch keys between cases. */
export function resetKeyCache(): void {
  cached = undefined;
}
