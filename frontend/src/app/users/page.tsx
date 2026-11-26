"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type User } from "@/lib/api";
import ThemeButton from "@/components/ThemeButton";
import styles from "../forms.module.css";

export default function UsersPage() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ login: "", name: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => setUsers(await api.users());

  useEffect(() => {
    (async () => {
      try {
        const user = await api.me();
        setMe(user);
        if (user.is_admin) await reload();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createUser({ ...form, is_admin: false });
      setForm({ login: "", name: "", password: "" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: User) => {
    const password = prompt(`Новый пароль для ${u.login} (не короче 6 символов)`);
    if (!password) return;
    try {
      await api.updateUser(u.id, { password });
      alert("Пароль изменён");
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const remove = async (u: User) => {
    if (!confirm(`Удалить пользователя ${u.login}?`)) return;
    try {
      await api.deleteUser(u.id);
      await reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  if (me && !me.is_admin) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          Недостаточно прав. <Link href="/">К графику</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${styles.wide}`}>
        <div className={styles.headerRow}>
          <h1>Пользователи</h1>
          <div className={styles.headerActions}>
            <ThemeButton className={styles.theme} />
            <Link href="/">← К графику</Link>
          </div>
        </div>

        <form className={styles.create} onSubmit={create}>
          <label>
            Логин
            <input
              value={form.login}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
          </label>
          <label>
            Имя
            <input
              value={form.name}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <button className={styles.primary} disabled={busy || !form.login.trim() || form.password.length < 6}>
            Добавить
          </button>
        </form>
        <div className={styles.hint}>Пароль не короче 6 символов. Новый пользователь сразу может входить.</div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Логин</th>
              <th>Имя</th>
              <th>Роль</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.login}</td>
                <td>{u.name}</td>
                <td>{u.is_admin ? "администратор" : "диспетчер"}</td>
                <td className={styles.actions}>
                  <button onClick={() => resetPassword(u)}>Сменить пароль</button>
                  {u.id !== me?.id && (
                    <button className={styles.danger} onClick={() => remove(u)}>
                      Удалить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
