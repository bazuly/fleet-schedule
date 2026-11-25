"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type User } from "@/lib/api";
import ThemeButton from "@/components/ThemeButton";
import styles from "../forms.module.css";

export default function UsersPage() {
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ login: "", name: "", password: "", is_admin: false });
  const [error, setError] = useState<string | null>(null);

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
    try {
      await api.createUser(form);
      setForm({ login: "", name: "", password: "", is_admin: false });
      await reload();
    } catch (err) {
      setError((err as Error).message);
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

        <form className={styles.inline} onSubmit={create}>
          <input placeholder="Логин" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          <input placeholder="Имя" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input
            placeholder="Пароль"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
            />
            админ
          </label>
          <button className={styles.primary} disabled={!form.login || form.password.length < 6}>
            Добавить
          </button>
        </form>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
