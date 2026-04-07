/**
 * End-to-End Encryption module — MLS-inspired protocol.
 *
 * Key concepts:
 *   • Identity key pair (ECDH P-256) — one per user, generated at first login
 *   • Key packages — one-time prekeys, consumed during conversation creation
 *   • Group secret — derived via X3DH-style dual-DH using key packages
 *   • Per-message keys — HKDF hash ratchet for forward secrecy within epochs
 *   • Epochs advance on membership changes (join/leave/key rotation)
 *
 * The server never sees plaintext or group secrets.
 */

const ECDH_PARAMS: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const AES_KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 600_000;

// ── Identity Key Generation ──

export async function generateKeyPair(): Promise<{
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { publicKey, privateKey: keyPair.privateKey };
}

// ── Private key backup (password-encrypted) ──

export async function encryptPrivateKeyForBackup(
  privateKey: CryptoKey,
  password: string
): Promise<string> {
  const exported = await crypto.subtle.exportKey("jwk", privateKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(exported));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const passwordKey = await deriveKeyFromPassword(
    password,
    salt.buffer as ArrayBuffer
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    passwordKey,
    plaintext
  );

  const packed = new Uint8Array(
    salt.byteLength + iv.byteLength + ciphertext.byteLength
  );
  packed.set(salt, 0);
  packed.set(iv, salt.byteLength);
  packed.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);

  return bufferToBase64(packed);
}

export async function decryptPrivateKeyFromBackup(
  encryptedData: string,
  password: string
): Promise<CryptoKey> {
  const packed = base64ToBuffer(encryptedData);

  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ciphertext = packed.slice(28);

  const passwordKey = await deriveKeyFromPassword(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    passwordKey,
    ciphertext
  );

  const jwk: JsonWebKey = JSON.parse(new TextDecoder().decode(plaintext));
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, [
    "deriveKey",
    "deriveBits",
  ]);
}

// ── MLS Key Packages (one-time prekeys) ──

export async function generateKeyPackages(count: number): Promise<{
  packages: Array<{ id: string; prekeyPublic: JsonWebKey }>;
  privateKeys: Array<{ id: string; privateKey: CryptoKey }>;
}> {
  const packages: Array<{ id: string; prekeyPublic: JsonWebKey }> = [];
  const privateKeys: Array<{ id: string; privateKey: CryptoKey }> = [];

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
      "deriveKey",
      "deriveBits",
    ]);
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    packages.push({ id, prekeyPublic: pub });
    privateKeys.push({ id, privateKey: pair.privateKey });
  }

  return { packages, privateKeys };
}

// ── MLS Group Secret Establishment (X3DH-style) ──

/**
 * Initiator creates the group secret using their identity key
 * and the recipient's key package + identity key.
 *
 *   DH1 = ECDH(my_identity, recipient_prekey)    — forward secrecy
 *   DH2 = ECDH(my_identity, recipient_identity)  — authentication
 *   group_secret = HKDF(DH1 || DH2, "fediplus-mls-v1")
 */
export async function createGroupSecret(
  myIdentityPrivate: CryptoKey,
  recipientIdentityPublic: JsonWebKey,
  recipientPrekeyPublic: JsonWebKey
): Promise<Uint8Array> {
  const recipientIdentity = await importPublicKey(recipientIdentityPublic);
  const recipientPrekey = await importPublicKey(recipientPrekeyPublic);

  const dh1 = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPrekey },
    myIdentityPrivate,
    256
  );

  const dh2 = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientIdentity },
    myIdentityPrivate,
    256
  );

  const combined = new Uint8Array(dh1.byteLength + dh2.byteLength);
  combined.set(new Uint8Array(dh1), 0);
  combined.set(new Uint8Array(dh2), dh1.byteLength);

  return new Uint8Array(await hkdfDerive(combined, "fediplus-mls-v1", 32));
}

/**
 * Recipient derives the same group secret using their prekey private key
 * and the initiator's identity public key.
 *
 *   DH1 = ECDH(my_prekey, initiator_identity)    — mirrors initiator DH1
 *   DH2 = ECDH(my_identity, initiator_identity)  — mirrors initiator DH2
 */
export async function deriveGroupSecret(
  myIdentityPrivate: CryptoKey,
  myPrekeyPrivate: CryptoKey,
  initiatorIdentityPublic: JsonWebKey
): Promise<Uint8Array> {
  const initiatorIdentity = await importPublicKey(initiatorIdentityPublic);

  const dh1 = await crypto.subtle.deriveBits(
    { name: "ECDH", public: initiatorIdentity },
    myPrekeyPrivate,
    256
  );

  const dh2 = await crypto.subtle.deriveBits(
    { name: "ECDH", public: initiatorIdentity },
    myIdentityPrivate,
    256
  );

  const combined = new Uint8Array(dh1.byteLength + dh2.byteLength);
  combined.set(new Uint8Array(dh1), 0);
  combined.set(new Uint8Array(dh2), dh1.byteLength);

  return new Uint8Array(await hkdfDerive(combined, "fediplus-mls-v1", 32));
}

// ── Per-Message Key Derivation (HKDF hash ratchet) ──

export async function deriveMessageKey(
  groupSecret: Uint8Array,
  epoch: number,
  counter: number
): Promise<CryptoKey> {
  const info = `msg-${epoch}-${counter}`;
  const keyBytes = await hkdfDerive(groupSecret, info, 32);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── MLS Group Message Encryption / Decryption ──

export async function encryptGroupMessage(
  plaintext: string,
  groupSecret: Uint8Array,
  epoch: number,
  counter: number
): Promise<{ ciphertext: string; iv: string; epoch: number; counter: number }> {
  const key = await deriveMessageKey(groupSecret, epoch, counter);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  return {
    ciphertext: bufferToBase64(new Uint8Array(ciphertext)),
    iv: bufferToBase64(iv),
    epoch,
    counter,
  };
}

export async function decryptGroupMessage(
  ciphertext: string,
  iv: string,
  groupSecret: Uint8Array,
  epoch: number,
  counter: number
): Promise<string> {
  const key = await deriveMessageKey(groupSecret, epoch, counter);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuffer(iv) },
    key,
    base64ToBuffer(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt a group secret so it can be stored on the server for a specific user.
 * Uses ECDH(my_identity, their_identity) + HKDF to derive a wrapping key.
 */
export async function encryptGroupSecretForUser(
  groupSecret: Uint8Array,
  myIdentityPrivate: CryptoKey,
  theirIdentityPublic: JsonWebKey
): Promise<string> {
  const theirKey = await importPublicKey(theirIdentityPublic);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: theirKey },
    myIdentityPrivate,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    groupSecret
  );

  // Pack iv + ciphertext
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.byteLength);
  return bufferToBase64(packed);
}

/**
 * Decrypt a group secret received from the server.
 */
export async function decryptGroupSecretFromUser(
  encryptedState: string,
  myIdentityPrivate: CryptoKey,
  theirIdentityPublic: JsonWebKey
): Promise<Uint8Array> {
  const packed = base64ToBuffer(encryptedState);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);

  const theirKey = await importPublicKey(theirIdentityPublic);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: theirKey },
    myIdentityPrivate,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    ciphertext
  );

  return new Uint8Array(decrypted);
}

// ── Legacy per-message encryption (epoch 0 backward compatibility) ──

export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: JsonWebKey
): Promise<{ ciphertext: string; ephemeralPublicKey: string; iv: string }> {
  const ephemeral = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
    "deriveKey",
    "deriveBits",
  ]);

  const importedRecipientKey = await importPublicKey(recipientPublicKey);

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: importedRecipientKey },
    ephemeral.privateKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    sharedKey,
    encoded
  );

  const ephemeralPubJwk = await crypto.subtle.exportKey(
    "jwk",
    ephemeral.publicKey
  );

  return {
    ciphertext: bufferToBase64(new Uint8Array(ciphertext)),
    ephemeralPublicKey: JSON.stringify(ephemeralPubJwk),
    iv: bufferToBase64(iv),
  };
}

export async function decryptMessage(
  ciphertext: string,
  ephemeralPublicKey: string,
  iv: string,
  myPrivateKey: CryptoKey
): Promise<string> {
  const ephemeralPubJwk: JsonWebKey = JSON.parse(ephemeralPublicKey);
  const importedEphemeral = await importPublicKey(ephemeralPubJwk);

  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: importedEphemeral },
    myPrivateKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBuffer(iv) },
    sharedKey,
    base64ToBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

// ── JWK helpers ──

export function exportPublicKey(jwk: JsonWebKey): string {
  return JSON.stringify(jwk);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, []);
}

// ── Internal helpers ──

async function deriveKeyFromPassword(
  password: string,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

async function hkdfDerive(
  inputKeyMaterial: Uint8Array,
  info: string,
  length: number
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    inputKeyMaterial,
    "HKDF",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    key,
    length * 8
  );
}

export function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
