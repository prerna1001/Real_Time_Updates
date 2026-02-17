// Simplified ConnectRPC-style definition file for crypto price streaming

export interface SubscribeTickersRequest {
  symbols: string[];
}

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestampIso: string;
  source: string;
}

export interface CryptoService {
  subscribeTickers(request: SubscribeTickersRequest): AsyncIterable<PriceUpdate>;
}
