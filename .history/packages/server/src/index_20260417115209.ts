import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import cors from "@fastify/cors";
import { EventEmitter } from "node:events";
import { chromium, Page } from "playwright";
import { PriceUpdate } from "proto/crypto.proto";

const PORT = Number(process.env.PORT ?? 4000);

type PriceEvent = PriceUpdate;

const priceBus = new EventEmitter();
priceBus.setMaxListeners(0);

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
      // @ts-ignore - injected in page runtime
      const tracked = Array.isArray(window.__trackedSymbols)
        ? window.__trackedSymbols
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

  // Single shared Playwright page for all clients
  const trackedSymbols = new Set<string>(["BTCUSDT"]);
  const page = await createTradingViewObserver(Array.from(trackedSymbols));
  await syncTrackedSymbols(page, Array.from(trackedSymbols));

  fastify.addHook("onClose", async () => {
    await page.context().browser()?.close();
  });

  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.get("/tickers", async () => ({ symbols: Array.from(trackedSymbols) }));

  fastify.post<{ Body: { symbol?: string } }>("/tickers", async (request, reply) => {
    const symbol = (request.body?.symbol ?? "").trim().toUpperCase();
    if (!symbol) {
      return reply.code(400).send({ error: "symbol is required" });
    }

    trackedSymbols.add(symbol);
    await syncTrackedSymbols(page, Array.from(trackedSymbols));
    return { symbols: Array.from(trackedSymbols) };
  });

  fastify.delete<{ Params: { symbol: string } }>("/tickers/:symbol", async (request) => {
    const symbol = request.params.symbol.trim().toUpperCase();
    trackedSymbols.delete(symbol);
    await syncTrackedSymbols(page, Array.from(trackedSymbols));
    return { symbols: Array.from(trackedSymbols) };
  });

  fastify.get("/prices", { websocket: true }, (connection) => {
    const listener = (update: PriceEvent) => {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.send(JSON.stringify(update));
      }
    };

    priceBus.on("price", listener);

    connection.socket.on("close", () => {
      priceBus.off("price", listener);
    });
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
