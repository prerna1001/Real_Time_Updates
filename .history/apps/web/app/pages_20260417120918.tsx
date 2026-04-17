"use client";

import { useEffect, useRef, useState } from "react";

// Each live price update received from the server
interface PriceEvent {
  symbol: string;
  price: number;
  timestampIso: string;
  source: string;
}

// Message shape for subscribing to a ticker
interface SubscribeRequest {
  action: "subscribe";
  symbol: string;
  requestId: string;
}

// Message shape for unsubscribing from a ticker
interface UnsubscribeRequest {
  action: "unsubscribe";
  symbol: string;
  requestId: string;
}

export default function LiveCryptoDashboard() {
  // Whether the websocket is currently connected
  const [connected, setConnected] = useState(false);

  // List of symbols the user is currently tracking
  const [tickers, setTickers] = useState<string[]>([]);

  // Recent live price events shown in the UI
  const [events, setEvents] = useState<PriceEvent[]>([]);

  // Controlled input value for adding a ticker
  const [input, setInput] = useState("");

  // Tracks symbols currently waiting on server acknowledgement
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Ref to the active websocket connection
  const socketRef = useRef<WebSocket | null>(null);

  // Ref that always holds the latest ticker list
  // This avoids stale closures inside websocket callbacks
  const tickersRef = useRef<string[]>([]);

  // Counts reconnect attempts so we can back off gradually
  const reconnectAttempts = useRef(0);

  // Keep the ref in sync whenever tickers change
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  // Open the websocket, listen for updates, and reconnect if needed
  useEffect(() => {
    let ws: WebSocket;

    const connect = () => {
      ws = new WebSocket("ws://localhost:3001");
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;

        // If the socket reconnects, re-subscribe to all active tickers
        tickersRef.current.forEach((symbol) => {
          ws.send(JSON.stringify({ action: "subscribe", symbol }));
        });
      };

      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        // Handle incoming price updates
        if (data.type === "price") {
          setEvents((prev) => {
            const next = [data.payload, ...prev];
            return next.slice(0, 50); // keep only the latest 50 events
          });
        }

        // Handle server acknowledgement for subscribe/unsubscribe actions
        if (data.type === "ack") {
          const { symbol } = data.payload;
          setPending((prev) => ({ ...prev, [symbol]: false }));
        }
      };

      ws.onclose = () => {
        setConnected(false);

        // Exponential backoff for reconnects, capped at 10 seconds
        const timeout = Math.min(1000 * 2 ** reconnectAttempts.current, 10000);
        reconnectAttempts.current++;
        setTimeout(connect, timeout);
      };
    };

    connect();

    // Clean up websocket if component unmounts
    return () => ws?.close();
  }, []);

  // Small helper to send typed requests through the socket
  const sendRequest = (req: SubscribeRequest | UnsubscribeRequest) => {
    socketRef.current?.send(JSON.stringify(req));
  };

  // Add a ticker to track
  const addTicker = () => {
    const symbol = input.trim().toUpperCase();

    // Ignore empty or duplicate symbols
    if (!symbol || tickers.includes(symbol)) return;

    // Mark this ticker as waiting for server acknowledgement
    setPending((prev) => ({ ...prev, [symbol]: true }));

    sendRequest({
      action: "subscribe",
      symbol,
      requestId: crypto.randomUUID(),
    });

    // Optimistically add ticker to UI
    setTickers((prev) => [...prev, symbol]);
    setInput("");
  };

  // Remove a ticker from tracking
  const removeTicker = (symbol: string) => {
    setPending((prev) => ({ ...prev, [symbol]: true }));

    sendRequest({
      action: "unsubscribe",
      symbol,
      requestId: crypto.randomUUID(),
    });

    // Optimistically remove ticker from UI
    setTickers((prev) => prev.filter((t) => t !== symbol));
  };

  return (
    <div>
      <h2>Live Crypto Dashboard</h2>
      <p>Status: {connected ? "Connected" : "Disconnected"}</p>

      {/* Input form for adding a new ticker */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTicker();
        }}
      >
        <label htmlFor="ticker">Add Symbol:</label>
        <input
          id="ticker"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      {/* Current tracked symbols */}
      <ul>
        {tickers.map((t) => (
          <li key={t}>
            {t}
            {pending[t] && " (pending...)"}
            <button onClick={() => removeTicker(t)}>Remove</button>
          </li>
        ))}
      </ul>

      {/* Most recent live events */}
      <h3>Latest Events</h3>
      <ul>
        {events.map((e, idx) => (
          <li key={idx}>
            {e.symbol}: ${e.price} (
            {new Date(e.timestampIso).toLocaleTimeString()})
          </li>
        ))}
      </ul>
    </div>
  );
}