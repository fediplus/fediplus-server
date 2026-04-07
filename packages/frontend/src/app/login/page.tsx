"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import {
  generateKeyPair,
  encryptPrivateKeyForBackup,
  decryptPrivateKeyFromBackup,
  exportPublicKey,
  generateKeyPackages,
} from "@/crypto/e2ee";
import {
  storeIdentityKey,
  storePrekeyPrivateKey,
} from "@/crypto/keystore";
import styles from "./page.module.css";

const MLS_KEY_PACKAGE_BATCH_SIZE = 10;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setEncryptionKey = useAuthStore((s) => s.setEncryptionKey);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function setupEncryption(
    userId: string,
    token: string,
    encryptedPrivateKey: string | null,
    pwd: string
  ) {
    try {
      if (encryptedPrivateKey) {
        // Existing user — decrypt with password
        const privateKey = await decryptPrivateKeyFromBackup(
          encryptedPrivateKey,
          pwd
        );
        await storeIdentityKey(userId, privateKey);
        setEncryptionKey(privateKey);
      } else {
        // First-time setup — generate keys, encrypt backup, upload
        const { publicKey, privateKey } = await generateKeyPair();
        const backup = await encryptPrivateKeyForBackup(privateKey, pwd);

        await apiFetch("/api/v1/users/me/encryption-keys", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            encryptionPublicKey: exportPublicKey(publicKey),
            encryptionPrivateKeyEnc: backup,
          }),
        });

        await storeIdentityKey(userId, privateKey);
        setEncryptionKey(privateKey);

        // Generate initial MLS key packages
        const { packages, privateKeys } = await generateKeyPackages(
          MLS_KEY_PACKAGE_BATCH_SIZE
        );

        // Store prekey private keys locally
        for (const pk of privateKeys) {
          await storePrekeyPrivateKey(pk.id, pk.privateKey);
        }

        // Upload public parts to server
        await apiFetch("/api/v1/users/me/key-packages", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            packages: packages.map((p) => ({
              id: p.id,
              keyData: JSON.stringify(p.prekeyPublic),
            })),
          }),
        });
      }
    } catch {
      // E2EE setup failure is non-fatal; user can still browse
      console.error("E2EE setup failed — encryption will be unavailable");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await apiFetch<{
        user: {
          id: string;
          username: string;
          actorType: string;
          actorUri: string;
        };
        token: string;
        encryption: {
          publicKey: string | null;
          encryptedPrivateKey: string | null;
        };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setAuth(result.user, result.token);

      // Auto-setup / auto-recover E2EE keys in the background
      // Password is still in memory — no extra prompt needed
      setupEncryption(
        result.user.id,
        result.token,
        result.encryption.encryptedPrivateKey,
        password
      );

      announce("Logged in successfully");
      router.push("/");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong";
      setError(message);
      announce(message, "assertive");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <Card className={styles.card} elevation={2}>
        <h1 className={styles.title}>Sign in to Fedi+</h1>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <Button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className={styles.footer}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
        <p className={styles.footer}>
          Don&apos;t have an account?{" "}
          <Link href="/register">Create one</Link>
        </p>
      </Card>
    </div>
  );
}
