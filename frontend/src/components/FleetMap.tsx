"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Located, type NavVehicle } from "@/lib/api";
import { ROW_STATUSES } from "@/lib/status";
import { sortedRowIds, useStore } from "@/lib/store";
import styles from "./FleetMap.module.css";

const REFRESH_MS = 30_000;
const CHUNK = 80;
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Яркий зелёный: свободная машина должна читаться с карты сразу. */
const FREE_COLOR = "#00c853";
const STATUS_COLOR: Record<string, string> = {
  free: FREE_COLOR,
  work: "#1a73e8",
  dayoff: "#f9a825",
  sick: "#f9a825",
  repair: "#e53935",
};

interface Unit {
  rowId: string;
  driver: string;
  tractor: string;
  trailer: string;
  status: string;
}

function markerColor(status: string): string {
  return STATUS_COLOR[status] ?? "#9aa0a6";
}

function statusLabel(status: string): string {
  return ROW_STATUSES.find((s) => s.id === status)?.label ?? "Без статуса";
}

function plateQuery(text: string): string {
  return text.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч назад`;
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function motion(v: NavVehicle): string {
  const parts = [ago(v.position_time ?? v.message_time)];
  if (v.speed != null && v.speed > 0) parts.unshift(`${Math.round(v.speed)} км/ч`);
  else if (v.moving === false) parts.unshift("стоит");
  return parts.filter(Boolean).join(", ");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function hasCoords(v: NavVehicle | null | undefined): v is NavVehicle {
  return !!v && v.lat != null && v.lon != null;
}

async function locateAll(texts: string[]): Promise<Map<string, Located>> {
  const out = new Map<string, Located>();
  for (let i = 0; i < texts.length; i += CHUNK) {
    const part = texts.slice(i, i + CHUNK);
    const res = await api.locate(part);
    res.forEach((item, index) => out.set(part[index], item));
  }
  return out;
}

export default function FleetMap() {
  const rows = useStore((s) => s.rows);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const fittedRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [located, setLocated] = useState<Map<string, Located>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [onlyFree, setOnlyFree] = useState(false);

  const units = useMemo<Unit[]>(() => {
    return sortedRowIds(rows, "main").flatMap((id) => {
      const row = rows[id];
      const tractor = plateQuery(row.tractor);
      const trailer = plateQuery(row.trailer);
      if (!tractor && !trailer) return [];
      return [
        {
          rowId: id,
          driver: row.driver.split("\n")[0].trim(),
          tractor,
          trailer,
          status: row.status || "",
        },
      ];
    });
  }, [rows]);

  const fleetKey = useMemo(
    () => units.map((u) => `${u.rowId}\t${u.status}\t${u.driver}\t${u.tractor}\t${u.trailer}`).join("\n"),
    [units],
  );
  const platesKey = useMemo(() => {
    const set = new Set<string>();
    for (const u of units) {
      if (u.tractor) set.add(u.tractor);
      if (u.trailer) set.add(u.trailer);
    }
    return [...set].sort().join("\n");
  }, [units]);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    let ro: ResizeObserver | null = null;
    const el = boxRef.current;
    if (!el) return;
    let starting = false;

    const start = () => {
      if (cancelled || map || starting || !boxRef.current || boxRef.current.clientHeight < 80) return;
      starting = true;
      void import("leaflet").then((L) => {
        if (cancelled || map || !boxRef.current || boxRef.current.clientHeight < 80) {
          starting = false;
          return;
        }
        leafletRef.current = L;
        map = L.map(boxRef.current, { zoomControl: true, attributionControl: false }).setView([55.75, 37.62], 5);
        L.tileLayer(TILES, { maxZoom: 19 }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        map.invalidateSize();
        setMapReady(true);
        window.setTimeout(() => map?.invalidateSize(), 300);
      });
    };

    ro = new ResizeObserver(() => {
      if (!map) start();
      else map.invalidateSize();
    });
    ro.observe(el);
    start();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const texts = platesKey ? platesKey.split("\n") : [];
    if (!texts.length) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await locateAll(texts);
        if (cancelled) return;
        setLocated(res);
        setLoaded(true);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [platesKey]);

  const placed = useMemo(() => {
    return units.map((u) => {
      const tractor = u.tractor ? located.get(u.tractor) : undefined;
      const trailer = u.trailer ? located.get(u.trailer) : undefined;
      const byTractor = hasCoords(tractor?.vehicle);
      const vehicle = byTractor ? tractor?.vehicle : hasCoords(trailer?.vehicle) ? trailer?.vehicle : null;
      const plate = (byTractor ? tractor?.plate : trailer?.plate) || (u.tractor || u.trailer);
      return { ...u, vehicle: vehicle ?? null, plate, byTrailer: !byTractor && !!vehicle };
    });
  }, [units, located]);

  const visible = onlyFree ? placed.filter((u) => u.status === "free") : placed;
  const freeCount = placed.filter((u) => u.status === "free").length;
  const onMap = visible.filter((u) => u.vehicle);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!mapReady || !L || !map || !layer) return;
    layer.clearLayers();
    const points: Leaflet.LatLngExpression[] = [];
    const ordered = [...visible].sort((a, b) => Number(a.status === "free") - Number(b.status === "free"));
    for (const u of ordered) {
      const v = u.vehicle;
      if (!v || v.lat == null || v.lon == null) continue;
      const free = u.status === "free";
      const color = markerColor(u.status);
      const who = u.driver || u.plate;
      const icon = L.divIcon({
        className: styles.markerWrap,
        html: `<div class="${styles.marker}${free ? ` ${styles.freeMarker}` : ""}" style="--c:${color}">
            <span class="${styles.arrow}" style="transform:rotate(${v.course ?? 0}deg)${v.course == null ? ";opacity:0" : ""}"></span>
            <span class="${free ? styles.dotFree : styles.dot}"></span>
            <span class="${free ? styles.labelFree : styles.label}">${escapeHtml(u.plate)}</span>
          </div>`,
        iconSize: [0, 0],
      });
      const where = u.byTrailer ? "Прицеп" : "Тягач";
      L.marker([v.lat, v.lon], { icon, title: who, zIndexOffset: free ? 600 : 0 })
        .bindPopup(
          `<b>${escapeHtml(who)}</b><br>${where}: ${escapeHtml(u.plate)}<br>${escapeHtml(statusLabel(u.status))}<br>${escapeHtml(motion(v))}`,
        )
        .addTo(layer);
      points.push([v.lat, v.lon]);
    }
    const viewKey = onlyFree ? "free" : "all";
    if (points.length && fittedRef.current !== viewKey) {
      fittedRef.current = viewKey;
      if (points.length === 1) map.setView(points[0], 11);
      else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 9 });
    }
  }, [mapReady, fleetKey, located, onlyFree, visible]);

  const focusUnit = (rowId: string) => {
    const u = placed.find((item) => item.rowId === rowId);
    const v = u?.vehicle;
    if (v?.lat != null && v.lon != null) mapRef.current?.setView([v.lat, v.lon], Math.max(mapRef.current.getZoom(), 12));
  };

  const listed = [...visible].sort((a, b) => {
    const free = Number(b.status === "free") - Number(a.status === "free");
    if (free) return free;
    return (a.driver || a.plate).localeCompare(b.driver || b.plate, "ru");
  });

  return (
    <div className={styles.root}>
      <aside className={styles.list}>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            Машины
            <span className={styles.freeCount}>свободно {freeCount}</span>
          </div>
          <label className={styles.filter}>
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            только свободные
          </label>
        </div>
        <div className={styles.items}>
          {listed.map((u) => {
            const here = !!u.vehicle;
            return (
              <button
                key={u.rowId}
                className={`${styles.item} ${u.status === "free" ? styles.itemFree : ""}`}
                disabled={!here}
                onClick={() => focusUnit(u.rowId)}
              >
                <span className={styles.swatch} style={{ background: markerColor(u.status) }} />
                <span className={styles.itemBody}>
                  <span className={styles.who}>{u.driver || u.plate}</span>
                  <span className={styles.meta}>
                    {u.plate}
                    {u.byTrailer ? " · прицеп" : ""}
                    {" · "}
                    {statusLabel(u.status)}
                    {here && u.vehicle ? ` · ${motion(u.vehicle)}` : !loaded ? " · поиск…" : " · нет на карте"}
                  </span>
                </span>
              </button>
            );
          })}
          {!listed.length && <div className={styles.empty}>{onlyFree ? "Свободных машин нет" : "В списке нет машин"}</div>}
        </div>
      </aside>
      <div className={styles.stage}>
        <div className={styles.mapSlot}>
          <div ref={boxRef} className={styles.map} />
        </div>
        <div className={styles.legend}>
          <span><i style={{ background: FREE_COLOR }} />Свободен</span>
          <span><i style={{ background: STATUS_COLOR.work }} />В работе</span>
          <span><i style={{ background: STATUS_COLOR.repair }} />Ремонт</span>
          <span><i style={{ background: STATUS_COLOR.dayoff }} />Выходной</span>
          <span><i style={{ background: "#9aa0a6" }} />Без статуса</span>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        {!error && loaded && onMap.length === 0 && (
          <div className={styles.error}>
            {onlyFree ? "У свободных машин нет координат" : "Координаты машин пока не пришли"}
          </div>
        )}
      </div>
    </div>
  );
}
