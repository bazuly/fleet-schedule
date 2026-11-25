"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { api, type Located } from "@/lib/api";
import type { MapTarget } from "@/lib/store";
import styles from "./MapView.module.css";

const REFRESH_MS = 30_000;
/** Светлая подложка OSM. Тёмные тайлы CARTO с сентября 2026 без ключа не отдаются. */
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const KIND_LABEL = { tractor: "Тягач", trailer: "Прицеп" } as const;
const KIND_COLOR = { tractor: "#1a73e8", trailer: "#e8710a" } as const;

interface Props {
  target: MapTarget;
}

type Unit = MapTarget["units"][number] & { located?: Located };

function ago(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч назад`;
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function status(u: Unit): string {
  const l = u.located;
  if (!l) return "поиск…";
  if (!l.plate) return "номер не распознан";
  if (!l.vehicle) return "нет в навигации";
  const v = l.vehicle;
  if (v.lat == null || v.lon == null) return "нет координат";
  const parts = [ago(v.position_time ?? v.message_time)];
  if (v.speed != null && v.speed > 0) parts.unshift(`${Math.round(v.speed)} км/ч`);
  else if (v.moving === false) parts.unshift("стоит");
  return parts.filter(Boolean).join(", ");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default function MapView({ target }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const fittedRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [result, setResult] = useState<{ key: string; located: Located[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const key = `${target.rowId}|${target.units.map((u) => u.text).join("|")}`;
  const located = result?.key === key ? result.located : null;
  const units: Unit[] = target.units.map((u, i) => ({ ...u, located: located?.[i] }));
  const currentError = error?.key === key ? error.message : null;

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    let ro: ResizeObserver | null = null;
    void import("leaflet").then((L) => {
      if (cancelled || !boxRef.current) return;
      leafletRef.current = L;
      map = L.map(boxRef.current, { zoomControl: true, attributionControl: false }).setView([59.94, 30.31], 6);
      L.tileLayer(TILES, { maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      ro = new ResizeObserver(() => map?.invalidateSize());
      ro.observe(boxRef.current);
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const texts = target.units.map((u) => u.text);
    const load = async () => {
      try {
        const res = await api.locate(texts);
        if (cancelled) return;
        setResult({ key, located: res });
        setError(null);
      } catch (e) {
        if (!cancelled) setError({ key, message: (e as Error).message });
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, target.units]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!mapReady || !L || !map || !layer || !located) return;
    layer.clearLayers();
    const points: Leaflet.LatLngExpression[] = [];
    target.units.forEach((u, i) => {
      const v = located[i]?.vehicle;
      if (!v || v.lat == null || v.lon == null) return;
      const color = KIND_COLOR[u.kind];
      const icon = L.divIcon({
        className: styles.markerWrap,
        html: `<div class="${styles.marker}" style="--c:${color}">
            <span class="${styles.arrow}" style="transform:rotate(${v.course ?? 0}deg)${v.course == null ? ";opacity:0" : ""}"></span>
            <span class="${styles.dot}"></span>
            <span class="${styles.label}">${escapeHtml(located[i].plate ?? u.text)}</span>
          </div>`,
        iconSize: [0, 0],
      });
      L.marker([v.lat, v.lon], { icon, title: v.name })
        .bindPopup(
          `<b>${KIND_LABEL[u.kind]}: ${escapeHtml(v.name)}</b><br>${escapeHtml(status({ ...u, located: located[i] }))}`,
        )
        .addTo(layer);
      points.push([v.lat, v.lon]);
    });
    // Подгоняем вид только при открытии строки, чтобы автообновление не сбивало масштаб.
    if (points.length && fittedRef.current !== key) {
      fittedRef.current = key;
      if (points.length === 1) map.setView(points[0], 13);
      else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 14 });
    }
  }, [mapReady, located, key, target.units]);

  const focusUnit = (i: number) => {
    const v = located?.[i]?.vehicle;
    if (v?.lat != null && v.lon != null) mapRef.current?.setView([v.lat, v.lon], Math.max(mapRef.current.getZoom(), 13));
  };

  return (
    <div className={styles.root}>
      <div className={styles.units}>
        {units.map((u, i) => {
          const v = u.located?.vehicle;
          const onMap = v?.lat != null && v?.lon != null;
          return (
            <button
              key={u.kind}
              className={styles.unit}
              disabled={!onMap}
              onClick={() => focusUnit(i)}
              title={v?.name}
            >
              <span className={styles.swatch} style={{ background: KIND_COLOR[u.kind] }} />
              <span className={styles.kind}>{KIND_LABEL[u.kind]}</span>
              <span className={styles.plate}>{u.located?.plate ?? u.text.replace(/\s+/g, " ")}</span>
              <span className={onMap ? styles.status : styles.statusMissing}>{status(u)}</span>
            </button>
          );
        })}
      </div>
      <div ref={boxRef} className={styles.map} />
      {currentError && <div className={styles.error}>{currentError}</div>}
    </div>
  );
}
