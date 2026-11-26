"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, tokenStore } from "@/lib/api";
import { connectRealtime } from "@/lib/realtime";
import { useStore } from "@/lib/store";
import FloatingWindow, { type WindowGeometry } from "./FloatingWindow";
import Grid, { type FrozenCol } from "./Grid";
import MapView from "./MapView";
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
const NAMES_KEY = "fleet.namesCollapsed";
const MAPS_KEY = "fleet.mapWindows";
const OPEN_MAPS_KEY = "fleet.openMaps";

function defaultMapGeometry(index: number): WindowGeometry {
  const w = typeof window === "undefined" ? 1400 : window.innerWidth;
  const h = typeof window === "undefined" ? 900 : window.innerHeight;
  const width = Math.min(480, w - 80);
  const height = Math.min(380, h - 160);
  const shift = (index % 8) * 32;
  return {
    x: Math.max(16, w - width - 28 - shift),
    y: 72 + shift,
    w: width,
    h: height,
    collapsed: false,
  };
}

function loadMapGeometries(): Record<string, WindowGeometry> {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem(MAPS_KEY);
    return saved ? (JSON.parse(saved) as Record<string, WindowGeometry>) : {};
  } catch {
    return {};
  }
}

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
  const [mapGeometry, setMapGeometry] = useState<Record<string, WindowGeometry>>(loadMapGeometries);
  const [mapOnTop, setMapOnTop] = useState(true);
  const [topMapId, setTopMapId] = useState<string | null>(null);
  const mapTargets = useStore((s) => s.mapTargets);
  const mapsRestored = useCallback((ids: string[]) => {
    const rows = useStore.getState().rows;
    for (const id of ids) {
      const row = rows[id];
      if (!row) continue;
      const units = (["tractor", "trailer"] as const)
        .map((kind) => ({ kind, text: row[kind].trim() }))
        .filter((u) => u.text);
      if (!units.length) continue;
      useStore.getState().openMap({
        rowId: row.id,
        title: row.driver.split("\n")[0].trim() || units[0].text,
        units,
      });
    }
  }, []);
  const toast = useStore((s) => s.toast);
  const loading = useStore((s) => s.loading);
  const [narrow, setNarrow] = useState(false);
  const [namesCollapsed, setNamesCollapsed] = useState(false);

  useLayoutEffect(() => {
    setNamesCollapsed(localStorage.getItem(NAMES_KEY) === "1");
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const toggleNames = useCallback(() => {
    setNamesCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAMES_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

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
        await useStore.getState().loadCalendar();
        await useStore.getState().loadAll();
        try {
          const ids = JSON.parse(localStorage.getItem(OPEN_MAPS_KEY) || "[]") as string[];
          if (Array.isArray(ids)) mapsRestored(ids);
        } catch {
          // Список открытых карт необязателен.
        }
        setReady(true);
        disconnect = connectRealtime();
      } catch {
        // При 401 api уже перенаправил на страницу входа.
      }
    })();
    return () => disconnect?.();
  }, [router, mapsRestored]);

  const updateWindows = useCallback((fn: (w: WindowsState) => WindowsState) => {
    setWindows((prev) => {
      const next = fn(prev);
      localStorage.setItem(WINDOWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const bringToFront = useCallback(
    (p: PanelKey) => {
      setMapOnTop(false);
      updateWindows((w) => (w.order[w.order.length - 1] === p ? w : { ...w, order: [...w.order.filter((x) => x !== p), p] }));
    },
    [updateWindows],
  );

  const changeMapGeometry = useCallback((rowId: string, g: WindowGeometry) => {
    setMapGeometry((prev) => {
      const next = { ...prev, [rowId]: g };
      localStorage.setItem(MAPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const mapCount = useRef(0);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(OPEN_MAPS_KEY, JSON.stringify(mapTargets.map((t) => t.rowId)));
    setMapGeometry((prev) => {
      let changed = false;
      const next = { ...prev };
      mapTargets.forEach((t, i) => {
        if (!next[t.rowId]) {
          next[t.rowId] = defaultMapGeometry(i);
          changed = true;
        }
      });
      if (!changed) return prev;
      localStorage.setItem(MAPS_KEY, JSON.stringify(next));
      return next;
    });
    const lastId = mapTargets[mapTargets.length - 1]?.rowId ?? null;
    if (mapTargets.length >= mapCount.current && lastId && lastId !== topMapId) {
      setTopMapId(lastId);
      setMapOnTop(true);
    }
    mapCount.current = mapTargets.length;
  }, [ready, mapTargets]);

  const toggle = (p: PanelKey) => {
    updateWindows((w) => ({ ...w, visible: { ...w.visible, [p]: !w.visible[p] } }));
    bringToFront(p);
  };

  const showPanel = useCallback(
    (p: PanelKey) => {
      setMapOnTop(false);
      updateWindows((w) => ({
        ...w,
        visible: { ...w.visible, [p]: true },
        geometry: { ...w.geometry, [p]: { ...w.geometry[p], collapsed: false } },
        order: w.order[w.order.length - 1] === p ? w.order : [...w.order.filter((x) => x !== p), p],
      }));
    },
    [updateWindows],
  );

  if (!ready) {
    return <div className={styles.splash}>{loading ? "Загрузка…" : ""}</div>;
  }

  return (
    <div className={styles.workspace}>
      <Toolbar
        visible={windows.visible}
        onToggle={toggle}
        onShow={showPanel}
        namesCollapsed={namesCollapsed}
        onToggleNames={toggleNames}
      />
      <FormulaBar />
      <div className={styles.main}>
        <Grid panel="main" frozen={MAIN_COLUMNS} hideFrozen={narrow && namesCollapsed} />
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

      {mapTargets.map((target, index) => (
        <FloatingWindow
          key={target.rowId}
          title={`НА КАРТЕ — ${target.title}`}
          accent="#7e57c2"
          geometry={mapGeometry[target.rowId] ?? defaultMapGeometry(index)}
          zIndex={mapOnTop ? (target.rowId === topMapId ? 170 : 130 + index) : 90 + index}
          onFocus={() => {
            setMapOnTop(true);
            setTopMapId(target.rowId);
          }}
          onChange={(g) => changeMapGeometry(target.rowId, g)}
          onClose={() => useStore.getState().closeMap(target.rowId)}
        >
          <MapView target={target} />
        </FloatingWindow>
      ))}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
