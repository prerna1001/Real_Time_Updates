"use client";

import { useEffect, useState } from "react";

interface Ticker {
  symbol: string;
}

interface PriceEvent {
  symbol: string;
  price: number;
  timestamp: string;
  source: string;
}

export default function HomePage() {
  const [tickers, setTickers] = useState<Ticker[]>([{ symbol: "BTCUSDT" }]);
  const [symbolInput, setSymbolInput] = useState("");
  const [events, setEvents] = useState<PriceEvent[]>([]);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:4000/prices");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as PriceEvent;
      setEvents((prev) => [data, ...prev].slice(0, 200));
    };

    return () => ws.close();
  }, []);

  const addTicker = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol || tickers.some((t) => t.symbol === symbol)) return;
    setTickers((prev) => [...prev, { symbol }]);
    setSymbolInput("");
    // TODO: Call ConnectRPC to register ticker on backend
  };

  const removeTicker = (symbol: string) => {
    setTickers((prev) => prev.filter((t) => t.symbol !== symbol));
    // TODO: Call ConnectRPC to unregister ticker on backend
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Crypto Live Updates
        </h1>
        <span className="text-xs text-slate-400">
          WebSocket + Playwright + ConnectRPC (skeleton)
        </span>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-200">Tracked Tickers</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            placeholder="e.g. BTCUSDT"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
          />
          <button
            onClick={addTicker}
            className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
          >
            Add
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {tickers.map((t) => (
            <span
              key={t.symbol}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium"
            >
              {t.symbol}
              <button
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
          {events.map((e, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-md bg-slate-900 px-2 py-1"
            >
              <span className="font-semibold text-emerald-400">
                {e.symbol}
              </span>
              <span>{e.price.toFixed(2)}</span>
              <span className="text-slate-500">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-slate-500">{e.source}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
