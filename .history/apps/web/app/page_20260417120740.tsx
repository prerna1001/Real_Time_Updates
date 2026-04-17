"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

interface Ticker {
  symbol: string;
}

interface PriceEvent {
  symbol: string;
  price: number;
  timestampIso: string;
  source: string;
}

// Backend acknowledgement for a requested action (subscribe/unsubscribe).
interface AckMessage {
  type: "ack";
  ok: boolean;
  action?: "subscribe" | "unsubscribe";
  symbol?: string;
  requestId?: string;
  message?: string;
}

interface ControlMessage {
  type: "control";
  action: "subscribe" | "unsubscribe";
  symbol: string;
  requestId: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";
const TICKER_PATTERN = /^[A-Z0-9._-]{2,20}$/;

export default function HomePage() {
  const [tickers, setTickers] = useState<Ticker[]>([{ symbol: "BTCUSDT" }]);
  const [symbolInput, setSymbolInput] = useState<string>("");
  const [events, setEvents] = useState<PriceEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [uiMessage, setUiMessage] = useState<string>("");
  // Tracks in-flight operations per symbol so UI can show "adding/removing" states.
  const [pendingBySymbol, setPendingBySymbol] = useState<Record<string, "subscribe" | "unsubscribe">>({});

  // Refs are used so async websocket handlers always read the latest state.
  const wsRef = useRef<WebSocket | null>(null);
  const tickersRef = useRef<Ticker[]>([{ symbol: "BTCUSDT" }]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  // requestId -> original action context, used to reconcile server acks.
  const pendingRequestsRef = useRef<
    Record<string, { action: "subscribe" | "unsubscribe"; symbol: string }>
  >({});

  // Runtime guard for price events from websocket payloads.
  const isPriceEvent = (value: unknown): value is PriceEvent => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const data = value as Record<string, unknown>;
    return (
      typeof data.symbol === "string" &&
      typeof data.price === "number" &&
      typeof data.timestampIso === "string" &&
      typeof data.source === "string"
    );
  };

  // Runtime guard for ack messages from websocket payloads.
  const isAckMessage = (value: unknown): value is AckMessage => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const data = value as Record<string, unknown>;
    return data.type === "ack" && typeof data.ok === "boolean";
  };

  const buildRequestId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Sends a control message and registers a pending request for ack tracking.
  const sendControlMessage = (
    action: "subscribe" | "unsubscribe",
    symbol: string,
  ): string | null => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setUiMessage("Socket is reconnecting. Your update will sync on reconnect.");
      return null;
    }

    const requestId = buildRequestId();
    const message: ControlMessage = {
      type: "control",
      action,
      symbol,
      requestId,
    };

    pendingRequestsRef.current[requestId] = { action, symbol };
    wsRef.current.send(JSON.stringify(message));
    return requestId;
  };

  // Reconciles optimistic UI updates with backend acknowledgement responses.
  const handleAckMessage = (ack: AckMessage) => {
    const requestId = ack.requestId;
    if (!requestId) {
      if (!ack.ok && ack.message) {
        setUiMessage(ack.message);
      }
      return;
    }

    const pending = pendingRequestsRef.current[requestId];
    if (!pending) {
      return;
    }

    delete pendingRequestsRef.current[requestId];

    if (ack.ok) {
      setPendingBySymbol((prev) => {
        const next = { ...prev };
        delete next[pending.symbol];
        return next;
      });

      if (pending.action === "unsubscribe") {
        setTickers((prev: Ticker[]) => prev.filter((t) => t.symbol !== pending.symbol));
      }

      setUiMessage(ack.message ?? "");
      return;
    }

    setPendingBySymbol((prev) => {
      const next = { ...prev };
      delete next[pending.symbol];
      return next;
    });

    if (pending.action === "subscribe") {
      setTickers((prev: Ticker[]) => prev.filter((t) => t.symbol !== pending.symbol));
    }

    setUiMessage(ack.message ?? `Failed to ${pending.action} ${pending.symbol}`);
  };

  // Keep latest ticker list available to websocket callbacks (avoid stale closures).
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    let cancelled = false;

    // Maintains one socket lifecycle with reconnect/backoff behavior.
    const connect = () => {
      const host = process.env.NEXT_PUBLIC_WS_HOST ?? "localhost:4000";
      const proto = window.location.protocol === "https:" ? "wss" : "ws";

      setConnectionStatus("connecting");
      const ws = new WebSocket(`${proto}://${host}/prices`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnectionStatus("connected");
        setUiMessage("");

        // Re-subscribe active tickers after reconnect.
        for (const ticker of tickersRef.current) {
          const requestId = buildRequestId();
          const message: ControlMessage = {
            type: "control",
            action: "subscribe",
            symbol: ticker.symbol,
            requestId,
          };
          pendingRequestsRef.current[requestId] = {
            action: "subscribe",
            symbol: ticker.symbol,
          };
          setPendingBySymbol((prev) => ({ ...prev, [ticker.symbol]: "subscribe" }));
          ws.send(JSON.stringify(message));
        }
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as unknown;
          // Control flow: ack messages mutate UI state; price messages update feed.
          if (isAckMessage(payload)) {
            handleAckMessage(payload);
            return;
          }

          if (isPriceEvent(payload)) {
            setEvents((prev: PriceEvent[]) => [payload, ...prev].slice(0, 200));
          }
        } catch {
          // Ignore malformed events from the socket instead of crashing the UI.
        }
      };

      ws.onclose = () => {
        if (cancelled) {
          return;
        }

        // Linear backoff with cap to avoid aggressive reconnect loops.
        setConnectionStatus("disconnected");
        const attempts = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempts;
        const delayMs = Math.min(5000, 500 * attempts);

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const handleAddTicker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    addTicker();
  };

  const addTicker = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) {
      return;
    }

    if (!TICKER_PATTERN.test(symbol)) {
      setUiMessage("Ticker format invalid. Use 2-20 chars: A-Z, 0-9, dot, underscore, dash.");
      return;
    }

    if (tickers.some((t: Ticker) => t.symbol === symbol)) {
      setUiMessage("Ticker already tracked.");
      return;
    }

    // Optimistic add: immediately show ticker, then reconcile with ack.
    setTickers((prev: Ticker[]) => [...prev, { symbol }]);
    setPendingBySymbol((prev) => ({ ...prev, [symbol]: "subscribe" }));
    sendControlMessage("subscribe", symbol);
    setUiMessage("");
    setSymbolInput("");
  };

  const removeTicker = (symbol: string) => {
    // Keep ticker visible while "removing" until backend confirms unsubscribe.
    setPendingBySymbol((prev) => ({ ...prev, [symbol]: "unsubscribe" }));
    sendControlMessage("unsubscribe", symbol);
  };

  const isAddDisabled = symbolInput.trim().length === 0;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Crypto Live Updates
        </h1>
        <span className="text-xs text-slate-400" role="status" aria-live="polite">
          WebSocket + Playwright + ConnectRPC (skeleton)
        </span>
      </header>

      <p className="text-xs text-slate-400" role="status" aria-live="polite">
        Connection: {connectionStatus}
      </p>
      {uiMessage && (
        <p className="text-xs text-amber-300" role="status" aria-live="polite">
          {uiMessage}
        </p>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-200">Tracked Tickers</h2>
        <form className="flex gap-2" onSubmit={handleAddTicker}>
          <label htmlFor="ticker-input" className="sr-only">
            Ticker symbol
          </label>
          <input
            id="ticker-input"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            placeholder="e.g. BTCUSDT"
            value={symbolInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setSymbolInput(e.target.value)
            }
          />
          <button
            type="submit"
            disabled={isAddDisabled}
            className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
          >
            Add
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {tickers.map((t: Ticker) => (
            <span
              key={t.symbol}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium"
            >
              {t.symbol}
              {pendingBySymbol[t.symbol] === "subscribe" && (
                <span className="text-slate-400">(adding...)</span>
              )}
              {pendingBySymbol[t.symbol] === "unsubscribe" && (
                <span className="text-slate-400">(removing...)</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${t.symbol}`}
                className="text-slate-400 hover:text-red-400"
                disabled={pendingBySymbol[t.symbol] === "unsubscribe"}
                onClick={() => removeTicker(t.symbol)}
              >
                ×
              </button>
            </span>
          ))}
          {tickers.length === 0 && (
            <span className="text-xs text-slate-500">No tickers yet.</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-200">Price Events</h2>
          <span className="text-xs text-slate-500">Newest first</span>
        </div>
        <div className="max-h-[420px] space-y-1 overflow-auto text-xs font-mono">
          {events.length === 0 && (
            <p className="text-slate-500">Waiting for events...</p>
          )}
          {events.map((e: PriceEvent, idx: number) => (
            <div
              key={`${e.symbol}-${e.timestampIso}-${e.source}-${idx}`}
              className="flex items-center justify-between rounded-md bg-slate-900 px-2 py-1"
            >
              <span className="font-semibold text-emerald-400">
                {e.symbol}
              </span>
              <span>{e.price.toFixed(2)}</span>
              <span className="text-slate-500">
                {new Date(e.timestampIso).toLocaleTimeString()}
              </span>
              <span className="text-slate-500">{e.source}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
