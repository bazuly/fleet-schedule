"use client";

import { CLIENT_ID, wsUrl, type ServerEvent } from "./api";
import { useStore } from "./store";

/** Подключается к WebSocket с автопереподключением. Возвращает функцию отключения. */
export function connectRealtime(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let everConnected = false;

  const open = () => {
    const store = useStore.getState();
    store.setWsStatus("connecting");
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      retry = 0;
      useStore.getState().setWsStatus("online");
      // После переподключения могли пропустить события — перечитываем данные.
      if (everConnected) void useStore.getState().loadAll();
      everConnected = true;
    };

    ws.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      if ("client" in event && event.client === CLIENT_ID) return;
      const s = useStore.getState();
      switch (event.type) {
        case "cells":
          s.applyRemoteCells(event.cells);
          break;
        case "rows":
          s.applyRemoteRows(event.rows);
          break;
        case "row_deleted":
          s.removeRowLocal(event.id);
          break;
        case "resync":
          void s.loadAll();
          break;
      }
    };

    ws.onclose = () => {
      if (stopped) return;
      useStore.getState().setWsStatus("offline");
      const delay = Math.min(1000 * 2 ** retry, 15000);
      retry++;
      timer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
