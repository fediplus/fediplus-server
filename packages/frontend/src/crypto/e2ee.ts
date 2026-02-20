/**
 * End-to-End Encryption module using Web Crypto API (ECDH + AES-GCM).
 *
 * The server never sees plaintext — only ciphertext flows over the network.
 * Key pairs are ECDH P-256. Message encryption uses AES-GCM-256 with
 * ephemeral ECDH key agreement per message.
 */

const ECDH_PARAMS: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const AES_KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 600_000;

// ── Key generation ──

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

  // Pack salt + iv + ciphertext into a single base64 string
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

// ── Message encryption / decryption ──

export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: JsonWebKey
): Promise<{ ciphertext: string; ephemeralPublicKey: string; iv: string }> {
  // Generate ephemeral key pair for this message
  const ephemeral = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
    "deriveKey",
    "deriveBits",
  ]);

  const importedRecipientKey = await importPublicKey(recipientPublicKey);

  // Derive shared secret
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

// ── JWK serialization helpers ──

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

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
