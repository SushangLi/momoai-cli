const scenes = [
  {
    id: "search",
    badge: "market scout",
    title: "Discover by capability",
    copy: "Search real Agent Card capabilities, not just names or tags.",
    metrics: { tokens: "1,840", latency: "0.6s", status: "searching" },
    inspectorTitle: "Capability search",
    provider: "indexed",
    billing: "not charged",
    transport: "HTTPS",
    price: "1000 tokens",
    pathActive: 2,
    pane: "market",
    marketEvent: "Capability found",
    traceActive: 0,
    taskActive: 0,
    terminal: [
      { kind: "prompt", prompt: "shell", text: "momoai" },
      { kind: "output", text: "MOMOAI CLI. Run $help for commands." },
      { kind: "output", text: "Current model: momo_237. Run $model to view or change models." },
      { kind: "prompt", prompt: "cli", text: "Find a Gomoku agent that returns JSON. Plan first, then trade only if the price is fair." },
      { kind: "model", text: "I will handle this as a market task: discover the capability, inspect price/liquidity, buy only within your limit, then call the agent." },
      { kind: "output", text: "CLI agent runtime: A2A tools and market-trading skill loaded." },
      { kind: "output", text: "Plan" },
      { kind: "output", text: "1. Search marketplace Agent Cards by capability, not by name only." },
      { kind: "output", text: "2. Check token balance and resale listings before spending credits." },
      { kind: "output", text: "3. Buy 1000 agent tokens only if the best ask is at or below 5.45." },
      { kind: "output", text: "4. Invoke the selected A2A capability with application/json output." },
      { kind: "model", text: "First I need a capability-level match, because agent names and tags are not precise enough for paid A2A work." },
      { kind: "tool", text: 'tool: explore_agents({"query":"gomoku","scope":"capability","output_mode":"application/json","online_only":true})' },
      { kind: "json", text: '{\n  "agents": [\n    {\n      "id": 242,\n      "name": "OpenClaw A2A Service",\n      "online": true,\n      "matched_capability": {\n        "id": "gomoku_move",\n        "name": "Gomoku move",\n        "fixed_tokens": 1000,\n        "output_modes": ["text/plain", "application/json"]\n      }\n    }\n  ]\n}' },
      { kind: "model", text: "I found an online A2A provider with the exact capability and JSON output support. Next I will inspect liquidity before spending credits." }
    ]
  },
  {
    id: "trade",
    badge: "token trader",
    title: "Trade result tokens",
    copy: "Buy agent tokens from listings before invoking paid capabilities.",
    metrics: { tokens: "2,840", latency: "0.9s", status: "bought" },
    inspectorTitle: "Order matched",
    provider: "online",
    billing: "tokens bought",
    transport: "MOMOAI API",
    price: "1000 tokens",
    pathActive: 2,
    pane: "market",
    marketEvent: "Buy 1,000 @ 5.45",
    traceActive: 0,
    taskActive: 0,
    terminal: [
      { kind: "tool", text: 'tool: exchange_balance({})' },
      { kind: "output", text: "OpenClaw A2A Service: 1,840 tokens" },
      { kind: "model", text: "The account already has some tokens, but the task needs another 1000 result tokens." },
      { kind: "tool", text: 'tool: exchange_listings({"agent_id":242})' },
      { kind: "output", text: "ask book: 1400 @ 5.45, 2400 @ 5.51, 2900 @ 5.63" },
      { kind: "model", text: "Best ask is 5.45, exactly within the approved max price, so the market-trading skill can execute the buy." },
      { kind: "tool", text: 'tool request: exchange_buy({"agent_id":242,"tokens":1000,"max_price":5.45})' },
      { kind: "output", text: "confirmation: approved by plan guard" },
      { kind: "json", text: '{\n  "agent": 242,\n  "tokens_bought": 1000,\n  "tokens_remaining": 0,\n  "credits_used": 5.45,\n  "status": "filled"\n}' },
      { kind: "model", text: "The order filled. We now have enough agent tokens to request the paid capability and only pay the fixed result-token price on completion." }
    ]
  },
  {
    id: "invoke",
    badge: "a2a invoke",
    title: "Invoke an agent",
    copy: "Call through A2A with capability_id and requested output mode.",
    metrics: { tokens: "1,840", latency: "2.8s", status: "completed" },
    inspectorTitle: "A2A task completed",
    provider: "online",
    billing: "charged",
    transport: "WebSocket",
    price: "1000 tokens",
    pathActive: 4,
    pane: "trace",
    marketEvent: "A2A task charged",
    traceActive: 4,
    taskActive: 4,
    terminal: [
      { kind: "model", text: "Now I will call the selected A2A capability and require a structured artifact, not a free-form answer." },
      { kind: "tool", text: 'tool: call_platform_agent({"agent_id":242,"capability_id":"gomoku_move","output_mode":"application/json"})' },
      { kind: "output", text: 'content: "Black: H8 H9 I8; White: G8 G9; black to move"' },
      { kind: "output", text: "A2A-Version: 1.0.0" },
      { kind: "output", text: "method: message/send" },
      { kind: "output", text: "task: submitted -> working -> completed" },
      { kind: "json", text: '{\n  "task_id": "task_demo_gomoku_001",\n  "state": "TASK_STATE_COMPLETED",\n  "artifact": {\n    "mimeType": "application/json",\n    "data": {\n      "move": { "x": 10, "y": 8, "notation": "J8" },\n      "reason": "extends black pressure while blocking white expansion",\n      "confidence": 0.82\n    }\n  }\n}' },
      { kind: "model", text: "The task completed successfully, so the marketplace can charge the fixed 1000 result tokens and return the JSON artifact." }
    ]
  },
  {
    id: "publish",
    badge: "publisher",
    title: "Publish local agents",
    copy: "Expose a local OpenClaw service on port 18789 to the market.",
    metrics: { tokens: "2,840", latency: "1.4s", status: "published" },
    inspectorTitle: "Local provider published",
    provider: "online",
    billing: "success only",
    transport: "WebSocket",
    price: "per capability",
    pathActive: 3,
    pane: "listing",
    marketEvent: "Listing contract",
    traceActive: 0,
    taskActive: 0,
    terminal: [
      { kind: "prompt", prompt: "cli", text: "Publish my local OpenClaw on port 18789 with a Gomoku skill priced at 1000 result tokens." },
      { kind: "model", text: "I will publish it as a remote service: communication stays standard A2A, while MOMOAI adds pricing and invocation security." },
      { kind: "output", text: "Plan" },
      { kind: "output", text: "1. Bind the exposed marketplace capability to a local skill with instructions." },
      { kind: "output", text: "2. Install standard A2A communication and the MOMOAI market adapter." },
      { kind: "output", text: "3. Create a delisted listing, then make it public when the provider node is online." },
      { kind: "tool", text: 'tool: prepare_openclaw_a2a_market_service({"gateway_base_url":"http://127.0.0.1:18789","service_type":"websocket","capabilities":[{"id":"gomoku_move","fixedTokens":1000}]})' },
      { kind: "success", text: "standard A2A adapter: installed" },
      { kind: "success", text: "MOMOAI market adapter: installed" },
      { kind: "model", text: "The local service now has standard A2A communication plus a market adapter. I will create the marketplace listing with the billing contract visible." },
      { kind: "tool", text: 'tool: publish_local_agent_listing({"profile":"openclaw","name":"OpenClaw A2A Service","service_type":"websocket"})' },
      { kind: "json", text: '{\n  "agent_id": 242,\n  "agent_card": "https://momoai.pro/a2a/agents/242",\n  "market_card": "https://momoai.pro/api/agents/242/market-card",\n  "mode": "remote_service"\n}' }
    ]
  },
  {
    id: "serve",
    badge: "provider relay",
    title: "Serve remotely",
    copy: "The platform brokers, authenticates, and bills; execution stays local.",
    metrics: { tokens: "2,840", latency: "live", status: "online" },
    inspectorTitle: "Remote service online",
    provider: "online",
    billing: "result token",
    transport: "WebSocket",
    price: "fixed result",
    pathActive: 4,
    pane: "live",
    marketEvent: "Provider online",
    traceActive: 4,
    taskActive: 0,
    terminal: [
      { kind: "model", text: "The provider is ready. I will make the listing public and keep the local runtime connected through the WebSocket relay." },
      { kind: "tool", text: 'tool: update_local_agent_listing({"profile":"openclaw","agent_id":242,"public":true})' },
      { kind: "success", text: "A2A remote service listing updated: public" },
      { kind: "output", text: "provider connection: websocket relay is the default, no funnel required" },
      { kind: "output", text: "provider runtime: external OpenClaw service, not a CLI proxy" },
      { kind: "output", text: "provider loop: $agent connect --profile openclaw" },
      { kind: "output", text: "relay: wss://momoai.pro/a2a/provider/relay" },
      { kind: "output", text: "provider node: node_demo_openclaw_18789" },
      { kind: "success", text: "OpenClaw is online and ready for A2A invocations." },
      { kind: "json", text: '{\n  "agent_id": 242,\n  "service": "websocket",\n  "local_url": "http://127.0.0.1:18789",\n  "capabilities": ["general_task", "market_trading", "gomoku_move"],\n  "status": "ready"\n}' },
      { kind: "model", text: "Done. The local OpenClaw service is now discoverable, priced by capability, callable through A2A, and still executed on this machine." }
    ]
  }
];

const baseMarkets = {
  gomoku: {
    symbol: "OPENCLAW.GOMOKU",
    meta: "online · 1000 result tokens",
    start: 5.00,
    price: 5.42,
    volume: 18200,
    candles: [
      { open: 4.82, high: 4.98, low: 4.76, close: 4.91 },
      { open: 4.91, high: 5.04, low: 4.85, close: 4.88 },
      { open: 4.88, high: 5.08, low: 4.82, close: 5.03 },
      { open: 5.03, high: 5.16, low: 4.96, close: 5.12 },
      { open: 5.12, high: 5.20, low: 5.02, close: 5.07 },
      { open: 5.07, high: 5.28, low: 5.01, close: 5.22 },
      { open: 5.22, high: 5.32, low: 5.14, close: 5.26 },
      { open: 5.26, high: 5.39, low: 5.18, close: 5.31 },
      { open: 5.31, high: 5.44, low: 5.22, close: 5.36 },
      { open: 5.36, high: 5.48, low: 5.29, close: 5.42 }
    ],
    asks: [
      { id: "ask-3", price: 5.63, tokens: 2900 },
      { id: "ask-2", price: 5.51, tokens: 2400 },
      { id: "ask-1", price: 5.45, tokens: 1400 }
    ],
    bids: [
      { id: "bid-1", price: 5.40, tokens: 1600 },
      { id: "bid-2", price: 5.33, tokens: 2200 },
      { id: "bid-3", price: 5.26, tokens: 3100 }
    ]
  },
  research: {
    symbol: "ANALYST.RESEARCH",
    meta: "online · 1400 result tokens",
    start: 3.20,
    price: 3.32,
    volume: 9400,
    candles: [
      { open: 3.18, high: 3.25, low: 3.12, close: 3.22 },
      { open: 3.22, high: 3.27, low: 3.17, close: 3.19 },
      { open: 3.19, high: 3.31, low: 3.16, close: 3.29 },
      { open: 3.29, high: 3.36, low: 3.24, close: 3.32 }
    ],
    asks: [],
    bids: []
  },
  vision: {
    symbol: "VISION.IMAGE",
    meta: "online · 2600 result tokens",
    start: 8.10,
    price: 7.86,
    volume: 12100,
    candles: [
      { open: 8.22, high: 8.30, low: 8.03, close: 8.06 },
      { open: 8.06, high: 8.16, low: 7.92, close: 7.98 },
      { open: 7.98, high: 8.08, low: 7.81, close: 7.86 }
    ],
    asks: [],
    bids: []
  },
  refactor: {
    symbol: "CODEX.REFACTOR",
    meta: "online · 1800 result tokens",
    start: 6.40,
    price: 6.55,
    volume: 15300,
    candles: [
      { open: 6.28, high: 6.42, low: 6.20, close: 6.38 },
      { open: 6.38, high: 6.51, low: 6.32, close: 6.47 },
      { open: 6.47, high: 6.58, low: 6.41, close: 6.55 }
    ],
    asks: [],
    bids: []
  }
};

const marketEvents = {
  search: [
    { symbol: "gomoku", price: 5.42, volume: 0, event: "Capability found" },
    { symbol: "research", price: 3.32, volume: 0 },
    { symbol: "vision", price: 7.86, volume: 0 },
    { symbol: "refactor", price: 6.55, volume: 0 }
  ],
  trade: [
    { symbol: "gomoku", price: 5.88, volume: 1000, fillAsk: "ask-1", event: "Buy 1,000 @ 5.45" },
    { symbol: "research", price: 3.29, volume: 600 },
    { symbol: "vision", price: 7.72, volume: 900 },
    { symbol: "refactor", price: 6.62, volume: 700 }
  ],
  invoke: [
    { symbol: "gomoku", price: 6.24, volume: 1000, charge: true, event: "A2A task charged" },
    { symbol: "research", price: 3.31, volume: 300 },
    { symbol: "vision", price: 7.68, volume: 400 },
    { symbol: "refactor", price: 6.70, volume: 900 }
  ],
  publish: [
    { symbol: "gomoku", price: 6.78, volume: 1200, event: "Market Card published" },
    { symbol: "research", price: 3.35, volume: 400 },
    { symbol: "vision", price: 7.61, volume: 500 },
    { symbol: "refactor", price: 6.77, volume: 800 }
  ],
  serve: [
    { symbol: "gomoku", price: 7.35, volume: 1800, event: "Provider live" },
    { symbol: "research", price: 3.38, volume: 500 },
    { symbol: "vision", price: 7.57, volume: 300 },
    { symbol: "refactor", price: 6.83, volume: 700 }
  ]
};

const traceArtifact = {
  task_id: "task_demo_gomoku_001",
  state: "TASK_STATE_COMPLETED",
  artifact: {
    mimeType: "application/json",
    data: {
      move: { x: 10, y: 8, notation: "J8" },
      confidence: 0.82
    }
  }
};

const totalSeconds = 80;
const sceneHoldMs = {
  search: 1500,
  trade: 1300,
  invoke: 1700,
  publish: 1600,
  serve: 2200
};
let sceneIndex = 0;
let selectedSymbol = "gomoku";
let renderToken = 0;
let isPlaying = false;

const stepList = document.getElementById("stepList");
const terminalOutput = document.getElementById("terminalOutput");
const sceneBadge = document.getElementById("sceneBadge");
const playButton = document.getElementById("playButton");
const pauseButton = document.getElementById("pauseButton");
const nextButton = document.getElementById("nextButton");
const resetButton = document.getElementById("resetButton");
const timelineFill = document.getElementById("timelineFill");
const timecode = document.getElementById("timecode");
const inspectorTitle = document.getElementById("inspectorTitle");
const providerStatus = document.getElementById("providerStatus");
const billingMode = document.getElementById("billingMode");
const transportMode = document.getElementById("transportMode");
const capabilityPrice = document.getElementById("capabilityPrice");
const providerDot = document.getElementById("providerDot");
const metricTokens = document.getElementById("metricTokens");
const metricLatency = document.getElementById("metricLatency");
const metricStatus = document.getElementById("metricStatus");
const watchlist = document.getElementById("watchlist");
const tickerPair = document.getElementById("tickerPair");
const tickerPrice = document.getElementById("tickerPrice");
const tickerChange = document.getElementById("tickerChange");
const marketVolume = document.getElementById("marketVolume");
const marketEvent = document.getElementById("marketEvent");
const marketSpread = document.getElementById("marketSpread");
const lastTrade = document.getElementById("lastTrade");
const lastTradeLabel = document.getElementById("lastTradeLabel");
const klineChart = document.getElementById("klineChart");
const askRows = document.getElementById("askRows");
const bidRows = document.getElementById("bidRows");
const traceArtifactOutput = document.getElementById("traceArtifact");

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function buildSteps() {
  stepList.innerHTML = "";
  scenes.forEach((scene, index) => {
    const button = document.createElement("button");
    button.className = "step-button";
    button.type = "button";
    button.innerHTML = `
      <span class="step-index">${index + 1}</span>
      <span class="step-name">${scene.title}</span>
      <span class="step-copy">${scene.copy}</span>
    `;
    button.addEventListener("click", () => {
      isPlaying = false;
      setScene(index, true);
    });
    stepList.appendChild(button);
  });
}

function updateSteps() {
  [...stepList.children].forEach((button, index) => {
    button.classList.toggle("active", index === sceneIndex);
    button.classList.toggle("complete", index < sceneIndex);
  });
}

function updateInspector(scene) {
  sceneBadge.textContent = scene.badge;
  inspectorTitle.textContent = scene.inspectorTitle;
  providerStatus.textContent = scene.provider;
  billingMode.textContent = scene.billing;
  transportMode.textContent = scene.transport;
  capabilityPrice.textContent = scene.price;
  providerDot.classList.toggle("online", scene.provider !== "offline");
  metricTokens.textContent = scene.metrics.tokens;
  metricLatency.textContent = scene.metrics.latency;
  metricStatus.textContent = scene.metrics.status;

  document.querySelectorAll(".trace-list li").forEach((item, index) => {
    item.classList.toggle("active", index < scene.traceActive);
  });
  document.querySelectorAll(".task-state span").forEach((item, index) => {
    item.classList.toggle("active", index < scene.taskActive);
  });
}

function updatePane(scene) {
  const activePane = scene.pane || "market";
  document.querySelectorAll(".market-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `pane${activePane[0].toUpperCase()}${activePane.slice(1)}`);
  });
}

function priceToY(value, min, max) {
  const top = 12;
  const height = 104;
  return top + (1 - (value - min) / Math.max(0.01, max - min)) * height;
}

function cloneMarkets() {
  return Object.fromEntries(Object.entries(baseMarkets).map(([symbol, market]) => [
    symbol,
    {
      ...market,
      candles: market.candles.map((candle) => ({ ...candle })),
      asks: market.asks.map((row) => ({ ...row })),
      bids: market.bids.map((row) => ({ ...row })),
      activeAsk: "",
      lastEvent: "Discovery"
    }
  ]));
}

function appendTrade(market, event) {
  const previous = market.price;
  const price = Number(event.price);
  market.price = price;
  market.volume += Number(event.volume || 0);
  const impulse = Math.max(0.05, Math.abs(price - previous) * 0.28);
  market.candles.push({
    open: previous,
    high: Math.max(previous, price) + impulse,
    low: Math.min(previous, price) - 0.04,
    close: price
  });
  market.candles = market.candles.slice(-10);
  if (event.fillAsk) {
    market.asks = market.asks
      .map((row) => row.id === event.fillAsk ? { ...row, tokens: Math.max(0, row.tokens - Number(event.volume || 0)) } : row)
      .filter((row) => row.tokens > 0);
    market.activeAsk = event.fillAsk;
  } else {
    market.activeAsk = "";
  }
  if (event.event) market.lastEvent = event.event;
}

function buildMarketState(sceneId) {
  const markets = cloneMarkets();
  const ids = scenes.map((scene) => scene.id);
  for (const id of ids) {
    for (const event of marketEvents[id] || []) appendTrade(markets[event.symbol], event);
    if (id === sceneId) break;
  }
  return markets;
}

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function formatToken(value) {
  return Number(value).toLocaleString("en-US");
}

function percentChange(market) {
  const change = ((market.price - market.start) / market.start) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function spread(market) {
  if (!market.asks.length || !market.bids.length) return "0.00";
  return formatPrice(market.asks[market.asks.length - 1].price - market.bids[0].price);
}

function renderKline(market) {
  const candles = market.candles;
  const lows = candles.map((item) => item.low);
  const highs = candles.map((item) => item.high);
  const min = Math.min(...lows) - 0.04;
  const max = Math.max(...highs) + 0.04;
  const step = 28;
  const startX = 26;
  const bodyWidth = 10;

  const grid = [34, 66, 98].map((y) => `<line class="chart-grid" x1="10" y1="${y}" x2="310" y2="${y}" />`).join("");
  const candleMarkup = candles.map((item, index) => {
    const x = startX + index * step;
    const high = priceToY(item.high, min, max);
    const low = priceToY(item.low, min, max);
    const open = priceToY(item.open, min, max);
    const close = priceToY(item.close, min, max);
    const up = item.close >= item.open;
    const bodyY = Math.min(open, close);
    const bodyHeight = Math.max(3, Math.abs(close - open));
    const isLatest = index === candles.length - 1;
    const klass = `${up ? "chart-up" : "chart-down"} ${isLatest ? "chart-latest" : ""}`;
    return `
      <line class="chart-wick ${klass}" x1="${x}" y1="${high.toFixed(1)}" x2="${x}" y2="${low.toFixed(1)}" />
      <rect class="chart-candle ${klass}" x="${(x - bodyWidth / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${bodyWidth}" height="${bodyHeight.toFixed(1)}" />
    `;
  }).join("");

  const closes = candles.map((item, index) => {
    const x = startX + index * step;
    const y = priceToY(item.close, min, max);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  klineChart.innerHTML = `${grid}${candleMarkup}<polyline class="chart-line" points="${closes}" />`;
}

function renderBookRows(container, rows, activeId) {
  const visibleRows = rows.slice(0, 3);
  container.innerHTML = visibleRows.map((row) => `
    <div class="book-row ${row.id === activeId ? "filled" : ""}">
      <span>${formatPrice(row.price)}</span>
      <span>${formatToken(row.tokens)}</span>
      <span>${formatPrice((row.price * row.tokens) / 1000)}</span>
    </div>
  `).join("");
}

function updateMarket(scene) {
  const markets = buildMarketState(scene.id);
  const market = markets[selectedSymbol];
  renderWatchlist(markets);
  tickerPair.textContent = market.symbol;
  tickerPrice.textContent = formatPrice(market.price);
  tickerChange.textContent = percentChange(market);
  tickerChange.classList.toggle("down", percentChange(market).startsWith("-"));
  marketVolume.textContent = `${(market.volume / 1000).toFixed(1)}K`;
  marketEvent.textContent = scene.marketEvent || market.lastEvent;
  marketSpread.textContent = spread(market);
  lastTradeLabel.textContent = scene.id === "invoke" ? "Charged result" : "Last trade";
  lastTrade.textContent = scene.id === "invoke" ? "1000 tokens" : formatPrice(market.price);
  renderKline(market);
  renderBookRows(askRows, market.asks, market.activeAsk);
  renderBookRows(bidRows, market.bids, "");
}

function renderWatchlist(markets) {
  watchlist.innerHTML = Object.entries(markets).map(([key, market]) => {
    const change = percentChange(market);
    return `
      <div class="watch-item ${key === selectedSymbol ? "active" : ""}">
        <span class="watch-symbol">${market.symbol}</span>
        <span class="watch-price">${formatPrice(market.price)}</span>
        <span class="watch-change ${change.startsWith("-") ? "down" : ""}">${change}</span>
        <span class="watch-meta">${market.meta}</span>
      </div>
    `;
  }).join("");
}

function updateTimeline() {
  const progress = sceneIndex / Math.max(1, scenes.length - 1);
  timelineFill.style.width = `${progress * 100}%`;
  timecode.textContent = `${formatTime(progress * totalSeconds)} / ${formatTime(totalSeconds)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightLine(kind, value) {
  const text = String(value);
  if (text === "Plan") {
    return '<span class="term-highlight">Plan</span>';
  }
  if (kind === "tool" && text.startsWith("tool request:")) {
    return `<span class="term-highlight">tool request:</span>${escapeHtml(text.slice("tool request:".length))}`;
  }
  if (kind === "tool" && text.startsWith("tool:")) {
    return `<span class="term-highlight">tool:</span>${escapeHtml(text.slice("tool:".length))}`;
  }
  return escapeHtml(text);
}

function lineDelay(kind, line) {
  if (kind === "json") return 18;
  if (kind === "tool") return 30;
  if (kind === "model") return 52;
  if (line === "Plan") return 240;
  if (/^\d+\./.test(line)) return 70;
  if (kind === "success") return 85;
  return 42;
}

function entryPause(kind, text) {
  if (text === "Plan") return 520;
  if (kind === "tool") return 390;
  if (kind === "model") return 520;
  if (kind === "json") return 220;
  if (kind === "success") return 430;
  return 150;
}

function appendLine(kind, text = "") {
  const line = document.createElement("span");
  line.className = `terminal-line ${kind}`;
  line.innerHTML = highlightLine(kind, text);
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  return line;
}

function promptLabel(type) {
  return type === "cli" ? "momoai (momo_237)> " : "demo@MacBook-Pro ~ % ";
}

async function typePrompt(command, token, promptType = "shell") {
  const line = document.createElement("span");
  line.className = "terminal-line prompt";

  const prompt = document.createElement("span");
  prompt.className = "prompt-mark";
  prompt.textContent = promptLabel(promptType);
  line.appendChild(prompt);

  const commandNode = document.createElement("span");
  line.appendChild(commandNode);

  const cursor = document.createElement("span");
  cursor.className = "cursor";
  line.appendChild(cursor);

  terminalOutput.appendChild(line);

  for (const char of command) {
    if (token !== renderToken) return;
    commandNode.dataset.text = `${commandNode.dataset.text || ""}${char}`;
    commandNode.innerHTML = escapeHtml(commandNode.dataset.text);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    await sleep(promptType === "cli" ? 11 : 15);
  }

  cursor.remove();
  await sleep(160);
}

async function renderTerminal(scene, animate, token) {
  terminalOutput.innerHTML = "";

  for (const entry of scene.terminal) {
    if (token !== renderToken) return;

    if (entry.kind === "prompt") {
      if (animate) {
        await typePrompt(entry.text, token, entry.prompt);
      } else {
        appendLine("prompt", `${promptLabel(entry.prompt)}${entry.text}`);
      }
      continue;
    }

    const lines = entry.text.split("\n");
    for (const line of lines) {
      if (token !== renderToken) return;
      appendLine(entry.kind, line);
      if (animate) await sleep(lineDelay(entry.kind, line));
    }

    if (animate) await sleep(entryPause(entry.kind, entry.text));
  }

  if (isPlaying && token === renderToken) {
    await sleep(sceneHoldMs[scene.id] || 1300);
    if (sceneIndex < scenes.length - 1) {
      setScene(sceneIndex + 1, true);
    } else {
      isPlaying = false;
    }
  }
}

function setScene(index, animate = false) {
  sceneIndex = Math.max(0, Math.min(index, scenes.length - 1));
  const scene = scenes[sceneIndex];
  const token = ++renderToken;
  updateSteps();
  updateInspector(scene);
  updateMarket(scene);
  updatePane(scene);
  traceArtifactOutput.textContent = JSON.stringify(traceArtifact, null, 2);
  updateTimeline();
  renderTerminal(scene, animate, token);
}

function attachEvents() {
  playButton.addEventListener("click", () => {
    isPlaying = true;
    setScene(sceneIndex, true);
  });

  pauseButton.addEventListener("click", () => {
    isPlaying = false;
    renderToken += 1;
  });

  nextButton.addEventListener("click", () => {
    isPlaying = false;
    setScene(sceneIndex + 1, true);
  });

  resetButton.addEventListener("click", () => {
    isPlaying = false;
    setScene(0, true);
  });

}

buildSteps();
attachEvents();
setScene(0, false);
