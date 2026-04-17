import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import cors from "@fastify/cors";
import { EventEmitter } from "node:events";
import { chromium, Page } from "playwright";
import { PriceUpdate } from "proto/crypto.proto";

const PORT = Number(process.env.PORT ?? 4000);

type PriceEvent = PriceUpdate;
type ClientAction = {
  action?: "subscribe" | "unsubscribe";
  symbol?: string;
};

const priceBus = new EventEmitter();
priceBus.setMaxListeners(0);
const symbolRefCounts = new Map<string, number>();

function normalizeSymbol(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function getTrackedSymbols(): string[] {
  return Array.from(symbolRefCounts.keys());
}

async function addSymbolReference(page: Page, symbol: string): Promise<void> {
  const next = (symbolRefCounts.get(symbol) ?? 0) + 1;
  symbolRefCounts.set(symbol, next);

  if (next === 1) {
    await syncTrackedSymbols(page, getTrackedSymbols());
  }
}

async function removeSymbolReference(page: Page, symbol: string): Promise<void> {
  const current = symbolRefCounts.get(symbol);
  if (!current) {
    return;
  }

  if (current === 1) {
    symbolRefCounts.delete(symbol);
    await syncTrackedSymbols(page, getTrackedSymbols());
    return;
  }

  symbolRefCounts.set(symbol, current - 1);
}

async function syncTrackedSymbols(page: Page, symbols: string[]): Promise<void> {
  await page.evaluate((nextSymbols: string[]) => {
    // @ts-ignore - injected in page runtime
    window.__trackedSymbols = nextSymbols;
  }, symbols);
}

async function createTradingViewObserver(symbols: string[]): Promise<Page> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // NOTE: This is a placeholder TradingView URL; adjust as needed.
  await page.goto("https://www.tradingview.com/chart/", {
    waitUntil: "networkidle",
  });

  await page.exposeFunction("__pushPriceEvent", (payload: PriceEvent) => {
    priceBus.emit("price", payload);
  });

  await page.evaluate((trackedSymbols: string[]) => {
    // @ts-ignore - injected in page runtime
    window.__trackedSymbols = trackedSymbols;

    const push = (update: PriceEvent) => {
      // @ts-ignore - injected by exposeFunction
      window.__pushPriceEvent(update);
    };

    // This is intentionally schematic: in a real app, you would
    // inspect TradingView's DOM structure and attach MutationObservers
    // to the correct nodes that show price for each symbol.
    const observer = new MutationObserver(() => {
      const trackedSymbols = (window as unknown as { __trackedSymbols?: string[] })
        .__trackedSymbols;
      const tracked = Array.isArray(trackedSymbols)
        ? trackedSymbols
        : [];
      const now = new Date().toISOString();
      for (const symbol of tracked) {
        const price = Number((Math.random() * 50000).toFixed(2));
        push({
          symbol,
          price,
          timestampIso: now,
          source: "tradingview-dom-mock",
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, symbols);

  return page;
}

async function main() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: true,
  });
  await fastify.register(websocketPlugin);

  // Single shared Playwright page for all clients; tracked symbols are ref-counted across sockets.
  const page = await createTradingViewObserver([]);
  await syncTrackedSymbols(page, []);

  fastify.addHook("onClose", async () => {
    await page.context().browser()?.close();
  });

  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.get("/prices", { websocket: true }, (connection) => {
    const clientSymbols = new Set<string>();

    const listener = (update: PriceEvent) => {
      if (
        clientSymbols.has(update.symbol) &&
        connection.socket.readyState === connection.socket.OPEN
      ) {
        connection.socket.send(JSON.stringify(update));
      }
    };

    priceBus.on("price", listener);

    connection.socket.on("message", async (raw: unknown) => {
      try {
        const parsed = JSON.parse(String(raw)) as ClientAction;
        const symbol = normalizeSymbol(parsed.symbol);
        if (!symbol) {
          return;
        }

        if (parsed.action === "subscribe") {
          if (clientSymbols.has(symbol)) {
            return;
          }
          clientSymbols.add(symbol);
          await addSymbolReference(page, symbol);
          return;
        }

        if (parsed.action === "unsubscribe") {
          if (!clientSymbols.has(symbol)) {
            return;
          }
          clientSymbols.delete(symbol);
          await removeSymbolReference(page, symbol);
        }
      } catch {
        // Ignore malformed client messages.
      }
    });

    connection.socket.on("close", async () => {
      priceBus.off("price", listener);

      for (const symbol of clientSymbols) {
        await removeSymbolReference(page, symbol);
      }
      clientSymbols.clear();
    });
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
