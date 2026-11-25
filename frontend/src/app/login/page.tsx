"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, tokenStore } from "@/lib/api";
import ThemeButton from "@/components/ThemeButton";
import styles from "../forms.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(login, password);
      tokenStore.set(token);
      router.replace("/");
    } catch (err) {
      setError((err as { status?: number }).status === 401 ? "Неверный логин или пароль" : "Сервер недоступен");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.headerRow}>
          <h1>График транспорта</h1>
          <ThemeButton className={styles.theme} />
        </div>
        <label>
          Логин
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className={styles.error}>{error}</div>}
        <button className={styles.primary} disabled={busy || !login || !password}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
