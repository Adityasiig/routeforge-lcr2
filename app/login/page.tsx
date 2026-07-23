"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Invalid username or password.");
      }
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      const target = from && from.startsWith("/") ? from : "/";
      router.replace(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "radial-gradient(1200px 600px at 50% -10%, #1c2530 0%, #0f141a 60%)",
        color: "#e8edf2",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: "380px",
          background: "#151b22",
          border: "1px solid #263140",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "34px",
              height: "34px",
              borderRadius: "9px",
              background: "#2f6f4f",
              color: "#fff",
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: "0.5px",
            }}
          >
            RF
          </span>
          <strong style={{ fontSize: "18px" }}>RouteForge</strong>
        </div>
        <p style={{ margin: "0 0 22px", color: "#9fb0c0", fontSize: "13px" }}>
          Sign in to access the LCR 2 pricing console.
        </p>

        <label style={{ display: "block", fontSize: "12px", color: "#9fb0c0", marginBottom: "6px" }}>Username</label>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
          style={inputStyle}
        />

        <label style={{ display: "block", fontSize: "12px", color: "#9fb0c0", margin: "16px 0 6px" }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: "16px",
              padding: "10px 12px",
              borderRadius: "9px",
              background: "rgba(220,80,80,0.12)",
              border: "1px solid rgba(220,80,80,0.35)",
              color: "#ffb4b4",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: "22px",
            width: "100%",
            padding: "12px",
            borderRadius: "10px",
            border: "none",
            background: busy ? "#3a4a3f" : "#2f6f4f",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: "10px",
  border: "1px solid #2b3846",
  background: "#0f141a",
  color: "#e8edf2",
  fontSize: "15px",
  outline: "none",
  boxSizing: "border-box",
};
