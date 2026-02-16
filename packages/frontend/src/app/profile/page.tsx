"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

export default function ProfileRedirectPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user) {
      router.replace(`/${user.username}`);
    }
  }, [user, router]);

  if (!user) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Please sign in to view your profile.</p>
      </div>
    );
  }

  return <p role="status">Redirecting to your profile...</p>;
}
