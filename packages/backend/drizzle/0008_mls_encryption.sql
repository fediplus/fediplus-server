-- Migration: MLS-inspired E2E encryption infrastructure
-- Adds key packages for forward secrecy, group state for conversations,
-- and epoch-based message encryption support.

-- ── MLS Key Packages (one-time prekeys consumed during conversation creation) ──

CREATE TABLE mls_key_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_data TEXT NOT NULL,          -- JSON: { prekeyPublic: JWK }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ          -- NULL = available to be claimed
);

CREATE INDEX idx_mls_key_packages_available
  ON mls_key_packages(user_id)
  WHERE consumed_at IS NULL;

-- ── MLS Group State (per-member group secret per epoch) ──

CREATE TABLE mls_group_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL DEFAULT 0,
  encrypted_state TEXT NOT NULL,    -- Group secret encrypted to this user's identity key
  initiator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  key_package_id UUID REFERENCES mls_key_packages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, user_id, epoch)
);

CREATE INDEX idx_mls_group_state_lookup
  ON mls_group_state(conversation_id, user_id, epoch);

-- ── Add epoch tracking to messages ──

ALTER TABLE messages ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN mls_counter INTEGER;
ALTER TABLE messages ALTER COLUMN ephemeral_public_key DROP NOT NULL;
