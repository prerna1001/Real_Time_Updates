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

type ConnectionStatus = "connecting" | "connected" | "disconnected";
const TICKER_PATTERN = /^[A-Z0-9._-]{2,20}$/;

export default function HomePage() {
  const [tickers, setTickers] = useState<Ticker[]>([{ symbol: "BTCUSDT" }]);
  const [symbolInput, setSymbolInput] = useState<string>("");
  const [events, setEvents] = useState<PriceEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [uiMessage, setUiMessage] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const tickersRef = useRef<Ticker[]>([{ symbol: "BTCUSDT" }]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      const host = process.env.NEXT_PUBLIC_WS_HOST ?? "localhost:4000";
      const proto = window.location.protocol === "https:" ? "wss" : "ws";

      setConnectionStatus("connecting");
      const ws = new WebSocket(`${proto}://${host}/prices`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnectionStatus("connected");

        for (const ticker of tickersRef.current) {
          ws.send(JSON.stringify({ action: "subscribe", symbol: ticker.symbol }));
        }
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as PriceEvent;
          if (typeof data.symbol !== "string") {
            return;
          }
          setEvents((prev: PriceEvent[]) => [data, ...prev].slice(0, 200));
        } catch {
          // Ignore malformed events from the socket instead of crashing the UI.
        }
      };

      ws.onclose = () => {
        if (cancelled) {
          return;
        }

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

  const sendWsAction = (action: "subscribe" | "unsubscribe", symbol: string): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setUiMessage("Socket is reconnecting. Your update will sync on reconnect.");
      return false;
    }

    wsRef.current.send(JSON.stringify({ action, symbol }));
    setUiMessage("");
    return true;
  };

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

    sendWsAction("subscribe", symbol);

    setTickers((prev: Ticker[]) => [...prev, { symbol }]);
    setSymbolInput("");
  };

  const removeTicker = (symbol: string) => {
    sendWsAction("unsubscribe", symbol);

    setTickers((prev: Ticker[]) => prev.filter((t: Ticker) => t.symbol !== symbol));
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
              <button
                type="button"
                aria-label={`Remove ${t.symbol}`}
                className="text-slate-400 hover:text-red-400"
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
