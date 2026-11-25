"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, tokenStore } from "@/lib/api";
import { connectRealtime } from "@/lib/realtime";
import { useStore } from "@/lib/store";
import FloatingWindow, { type WindowGeometry } from "./FloatingWindow";
import Grid, { type FrozenCol } from "./Grid";
import Toolbar, { FormulaBar, type PanelKey } from "./Toolbar";
import styles from "./Workspace.module.css";

const MAIN_COLUMNS: FrozenCol[] = [
  { field: "driver", title: "Водитель", width: 210 },
  { field: "tractor", title: "Тягач", width: 130 },
  { field: "trailer", title: "Прицеп", width: 120 },
];

const POOL_COLUMNS: FrozenCol[] = [{ field: "note", title: "Заметка", width: 130 }];

const PANEL_TITLES: Record<PanelKey, string> = {
  unassigned: "НЕРАСПРЕДЕЛЕННОЕ",
  pickups: "ЗАБОРЫ ПРОДУКЦИИ",
};

const PANEL_ACCENTS: Record<PanelKey, string> = {
  unassigned: "#f9ab00",
  pickups: "#1e8e3e",
};

interface WindowsState {
  visible: Record<PanelKey, boolean>;
  geometry: Record<PanelKey, WindowGeometry>;
  order: PanelKey[];
}

const WINDOWS_KEY = "fleet.windows";

function defaultWindows(): WindowsState {
  const w = typeof window === "undefined" ? 1400 : window.innerWidth;
  const h = typeof window === "undefined" ? 900 : window.innerHeight;
  const width = Math.min(900, w - 120);
  return {
    visible: { unassigned: false, pickups: false },
    geometry: {
      unassigned: { x: w - width - 30, y: h - 380, w: width, h: 330, collapsed: false },
      pickups: { x: w - width - 60, y: h - 420, w: width, h: 330, collapsed: false },
    },
    order: ["unassigned", "pickups"],
  };
}

function loadWindows(): WindowsState {
  const defaults = defaultWindows();
  if (typeof window === "undefined") return defaults;
  try {
    const saved = localStorage.getItem(WINDOWS_KEY);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

export default function Workspace() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [windows, setWindows] = useState<WindowsState>(loadWindows);
  const toast = useStore((s) => s.toast);
  const loading = useStore((s) => s.loading);

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace("/login");
      return;
    }
    let disconnect: (() => void) | undefined;
    (async () => {
      try {
        const user = await api.me();
        useStore.getState().setUser(user);
        await useStore.getState().loadAll();
        setReady(true);
        disconnect = connectRealtime();
      } catch {
        // При 401 api уже перенаправил на страницу входа.
      }
    })();
    return () => disconnect?.();
  }, [router]);

  const updateWindows = useCallback((fn: (w: WindowsState) => WindowsState) => {
    setWindows((prev) => {
      const next = fn(prev);
      localStorage.setItem(WINDOWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const bringToFront = useCallback(
    (p: PanelKey) =>
      updateWindows((w) => (w.order[w.order.length - 1] === p ? w : { ...w, order: [...w.order.filter((x) => x !== p), p] })),
    [updateWindows],
  );

  const toggle = (p: PanelKey) => {
    updateWindows((w) => ({ ...w, visible: { ...w.visible, [p]: !w.visible[p] } }));
    bringToFront(p);
  };

  if (!ready) {
    return <div className={styles.splash}>{loading ? "Загрузка…" : ""}</div>;
  }

  return (
    <div className={styles.workspace}>
      <Toolbar visible={windows.visible} onToggle={toggle} />
      <FormulaBar />
      <div className={styles.main}>
        <Grid panel="main" frozen={MAIN_COLUMNS} />
      </div>

      {(Object.keys(PANEL_TITLES) as PanelKey[]).map(
        (p) =>
          windows.visible[p] && (
            <FloatingWindow
              key={p}
              title={PANEL_TITLES[p]}
              accent={PANEL_ACCENTS[p]}
              geometry={windows.geometry[p]}
              zIndex={100 + windows.order.indexOf(p)}
              onFocus={() => bringToFront(p)}
              onChange={(g) => updateWindows((w) => ({ ...w, geometry: { ...w.geometry, [p]: g } }))}
              onClose={() => updateWindows((w) => ({ ...w, visible: { ...w.visible, [p]: false } }))}
            >
              <Grid panel={p} frozen={POOL_COLUMNS} />
            </FloatingWindow>
          ),
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
