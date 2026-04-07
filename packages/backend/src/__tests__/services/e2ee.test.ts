import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ── Mocks (hoisted before vi.mock) ──

const { findFirstFn, returningFn, selectFn, chainProxy } = vi.hoisted(() => {
  const findFirstFn = vi.fn();
  const returningFn = vi.fn();
  const selectFn = vi.fn();
  const chainProxy = (): unknown =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "returning") return returningFn;
          if (prop === "then")
            return (r: (v: unknown) => void) => r(undefined);
          return vi.fn(() => chainProxy());
        },
      }
    );
  selectFn.mockImplementation(() => chainProxy());
  return { findFirstFn, returningFn, selectFn, chainProxy };
});

vi.mock("../../db/connection.js", () => ({
  db: {
    query: {
      users: { findFirst: findFirstFn },
      conversations: { findFirst: findFirstFn },
      conversationParticipants: { findFirst: findFirstFn },
    },
    select: selectFn,
    insert: vi.fn(() => chainProxy()),
    update: vi.fn(() => chainProxy()),
    delete: vi.fn(() => chainProxy()),
  },
}));

vi.mock("../../realtime/sse.js", () => ({
  sendEvent: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  config: {
    publicUrl: "https://fediplus.test",
    jwt: { secret: "test-secret-key-for-vitest", expiry: "7d" },
    domain: "fediplus.test",
  },
}));

import {
  uploadKeyPackages,
  consumeKeyPackage,
  getAvailableKeyPackageCount,
  storeGroupState,
  getGroupState,
  setupEncryptionKeys,
  getEncryptionKeys,
  getUserPublicKey,
} from "../../services/messages.js";

describe("E2EE Key Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Encryption Key Setup ──

  describe("setupEncryptionKeys", () => {
    it("stores public key and encrypted private key", async () => {
      const userId = randomUUID();
      returningFn.mockResolvedValueOnce([
        { encryptionPublicKey: '{"kty":"EC","crv":"P-256"}' },
      ]);

      const result = await setupEncryptionKeys(
        userId,
        '{"kty":"EC","crv":"P-256"}',
        "encrypted-backup-data"
      );

      expect(result).toEqual({
        encryptionPublicKey: '{"kty":"EC","crv":"P-256"}',
      });
    });
  });

  describe("getEncryptionKeys", () => {
    it("returns both public and encrypted private key", async () => {
      findFirstFn.mockResolvedValueOnce({
        encryptionPublicKey: '{"kty":"EC"}',
        encryptionPrivateKeyEnc: "encrypted-data",
      });

      const keys = await getEncryptionKeys(randomUUID());
      expect(keys).toEqual({
        encryptionPublicKey: '{"kty":"EC"}',
        encryptionPrivateKeyEnc: "encrypted-data",
      });
    });

    it("returns null fields when keys not set up", async () => {
      findFirstFn.mockResolvedValueOnce({
        encryptionPublicKey: null,
        encryptionPrivateKeyEnc: null,
      });

      const keys = await getEncryptionKeys(randomUUID());
      expect(keys?.encryptionPublicKey).toBeNull();
    });
  });

  describe("getUserPublicKey", () => {
    it("returns public encryption key for a user", async () => {
      findFirstFn.mockResolvedValueOnce({
        encryptionPublicKey: '{"kty":"EC","crv":"P-256"}',
      });

      const key = await getUserPublicKey(randomUUID());
      expect(key?.encryptionPublicKey).toContain("P-256");
    });

    it("returns undefined for non-existent user", async () => {
      findFirstFn.mockResolvedValueOnce(undefined);
      const key = await getUserPublicKey(randomUUID());
      expect(key).toBeUndefined();
    });
  });
});

describe("MLS Key Packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadKeyPackages", () => {
    it("uploads a batch of key packages", async () => {
      const userId = randomUUID();
      const packages = [
        { id: randomUUID(), keyData: '{"kty":"EC","crv":"P-256"}' },
        { id: randomUUID(), keyData: '{"kty":"EC","crv":"P-256"}' },
      ];

      const result = await uploadKeyPackages(userId, packages);
      expect(result).toEqual({ uploaded: 2 });
    });

    it("handles single key package upload", async () => {
      const result = await uploadKeyPackages(randomUUID(), [
        { id: randomUUID(), keyData: '{"kty":"EC"}' },
      ]);
      expect(result.uploaded).toBe(1);
    });
  });

  describe("consumeKeyPackage", () => {
    it("returns and marks the oldest available key package", async () => {
      const keyPackage = {
        id: randomUUID(),
        userId: randomUUID(),
        keyData: '{"kty":"EC","crv":"P-256"}',
        createdAt: new Date(),
        consumedAt: null,
      };

      // Mock the select chain: select().from().where().orderBy().limit()
      const limitFn = vi.fn().mockResolvedValueOnce([keyPackage]);
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      const result = await consumeKeyPackage(keyPackage.userId);

      expect(result).toEqual(keyPackage);
    });

    it("returns null when no key packages available", async () => {
      const limitFn = vi.fn().mockResolvedValueOnce([]);
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      const result = await consumeKeyPackage(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe("getAvailableKeyPackageCount", () => {
    it("returns count of unconsumed key packages", async () => {
      const limitFn = vi.fn().mockResolvedValueOnce([{ count: 5 }]);
      const whereFn = vi.fn(() => limitFn());
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      // The function chains select().from().where() and returns [{count}]
      // Since our mock is simplified, we need to handle the promise chain
      const result = await getAvailableKeyPackageCount(randomUUID());
      expect(result).toBe(5);
    });
  });
});

describe("MLS Group State", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("storeGroupState", () => {
    it("stores encrypted group state for a conversation member", async () => {
      const conversationId = randomUUID();
      const userId = randomUUID();
      const initiatorId = randomUUID();
      const keyPackageId = randomUUID();

      const storedState = {
        id: randomUUID(),
        conversationId,
        userId,
        epoch: 0,
        encryptedState: "encrypted-group-secret",
        initiatorId,
        keyPackageId,
        createdAt: new Date(),
      };

      returningFn.mockResolvedValueOnce([storedState]);

      const result = await storeGroupState(
        conversationId,
        userId,
        0,
        "encrypted-group-secret",
        initiatorId,
        keyPackageId
      );

      expect(result).toEqual(storedState);
    });

    it("stores group state without optional fields", async () => {
      const storedState = {
        id: randomUUID(),
        conversationId: randomUUID(),
        userId: randomUUID(),
        epoch: 1,
        encryptedState: "encrypted-data",
        initiatorId: null,
        keyPackageId: null,
        createdAt: new Date(),
      };

      returningFn.mockResolvedValueOnce([storedState]);

      const result = await storeGroupState(
        storedState.conversationId,
        storedState.userId,
        1,
        "encrypted-data"
      );

      expect(result.initiatorId).toBeNull();
      expect(result.keyPackageId).toBeNull();
    });
  });

  describe("getGroupState", () => {
    it("returns the latest group state for a conversation member", async () => {
      const state = {
        id: randomUUID(),
        conversationId: randomUUID(),
        userId: randomUUID(),
        epoch: 2,
        encryptedState: "encrypted-data",
        createdAt: new Date(),
      };

      const limitFn = vi.fn().mockResolvedValueOnce([state]);
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      const result = await getGroupState(state.conversationId, state.userId);
      expect(result).toEqual(state);
    });

    it("returns group state for a specific epoch", async () => {
      const state = {
        id: randomUUID(),
        conversationId: randomUUID(),
        userId: randomUUID(),
        epoch: 1,
        encryptedState: "epoch-1-data",
        createdAt: new Date(),
      };

      const limitFn = vi.fn().mockResolvedValueOnce([state]);
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      const result = await getGroupState(
        state.conversationId,
        state.userId,
        1
      );
      expect(result?.epoch).toBe(1);
    });

    it("returns null when no group state exists", async () => {
      const limitFn = vi.fn().mockResolvedValueOnce([]);
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      selectFn.mockReturnValueOnce({ from: fromFn });

      const result = await getGroupState(randomUUID(), randomUUID());
      expect(result).toBeNull();
    });
  });
});

describe("MLS-aware message sending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendMessageSchema accepts MLS epoch fields", async () => {
    const { sendMessageSchema } = await import(
      "../../../../shared/src/validation.js"
    );
    const result = sendMessageSchema.safeParse({
      ciphertext: "encrypted-data",
      iv: "base64-iv",
      epoch: 1,
      mlsCounter: 5,
    });
    expect(result.success).toBe(true);
  });

  it("sendMessageSchema accepts legacy format with ephemeralPublicKey", async () => {
    const { sendMessageSchema } = await import(
      "../../../../shared/src/validation.js"
    );
    const result = sendMessageSchema.safeParse({
      ciphertext: "encrypted-data",
      ephemeralPublicKey: '{"kty":"EC"}',
      iv: "base64-iv",
    });
    expect(result.success).toBe(true);
  });

  it("uploadKeyPackagesSchema validates key package batch", async () => {
    const { uploadKeyPackagesSchema } = await import(
      "../../../../shared/src/validation.js"
    );
    const result = uploadKeyPackagesSchema.safeParse({
      packages: [
        { id: randomUUID(), keyData: '{"kty":"EC"}' },
        { id: randomUUID(), keyData: '{"kty":"EC"}' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("uploadKeyPackagesSchema rejects empty packages array", async () => {
    const { uploadKeyPackagesSchema } = await import(
      "../../../../shared/src/validation.js"
    );
    const result = uploadKeyPackagesSchema.safeParse({
      packages: [],
    });
    expect(result.success).toBe(false);
  });

  it("storeGroupStateSchema validates group state input", async () => {
    const { storeGroupStateSchema } = await import(
      "../../../../shared/src/validation.js"
    );
    const result = storeGroupStateSchema.safeParse({
      epoch: 0,
      encryptedState: "encrypted-group-secret",
      initiatorId: randomUUID(),
      keyPackageId: randomUUID(),
    });
    expect(result.success).toBe(true);
  });
});
