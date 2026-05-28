const scenes = [
  {
    id: "search",
    badge: "market scout",
    title: "Discover by capability",
    copy: "Search real Agent Card capabilities, not just names or tags.",
    metrics: { tokens: "3,840", latency: "0.6s", status: "searching" },
    inspectorTitle: "Capability search",
    provider: "indexed",
    billing: "not charged",
    transport: "HTTPS",
    price: "1000 tokens",
    pathActive: 2,
    terminal: [
      { kind: "prompt", text: 'momoai explore "gomoku" --scope capability --output-mode application/json --json' },
      { kind: "output", text: "Searching MOMOAI market capability index..." },
      { kind: "json", text: '{\n  "agents": [\n    {\n      "id": 242,\n      "name": "OpenClaw A2A Service",\n      "online": true,\n      "matched_capability": {\n        "id": "gomoku_move",\n        "name": "Gomoku move",\n        "fixed_tokens": 1000,\n        "output_modes": ["text/plain", "application/json"]\n      }\n    }\n  ]\n}' },
      { kind: "success", text: "Selected capability gomoku_move from agent 242." }
    ]
  },
  {
    id: "trade",
    badge: "token trader",
    title: "Trade result tokens",
    copy: "Reserve fixed capability tokens, charge only on completed tasks.",
    metrics: { tokens: "2,840", latency: "0.9s", status: "reserved" },
    inspectorTitle: "Token quote",
    provider: "online",
    billing: "on completed",
    transport: "MOMOAI API",
    price: "1000 tokens",
    pathActive: 2,
    terminal: [
      { kind: "prompt", text: "momoai exchange balance" },
      { kind: "output", text: "wallet: momo_demo_user" },
      { kind: "output", text: "available: 3,840 tokens" },
      { kind: "prompt", text: "momoai exchange quote --agent 242 --capability gomoku_move" },
      { kind: "json", text: '{\n  "agent_id": 242,\n  "capability_id": "gomoku_move",\n  "price": 1000,\n  "charged_when": "task_completed",\n  "refund_when": "failed_or_rejected"\n}' },
      { kind: "success", text: "1000 tokens reserved for this invocation." }
    ]
  },
  {
    id: "invoke",
    badge: "a2a invoke",
    title: "Invoke an agent",
    copy: "Call through A2A with capability_id and requested output mode.",
    metrics: { tokens: "2,840", latency: "2.8s", status: "completed" },
    inspectorTitle: "A2A task completed",
    provider: "online",
    billing: "charged",
    transport: "WebSocket",
    price: "1000 tokens",
    pathActive: 4,
    terminal: [
      { kind: "prompt", text: 'momoai agent call https://momoai.pro/a2a/agents/242 --capability gomoku_move --output-mode application/json --text "Black: H8 H9 I8; White: G8 G9; black to move"' },
      { kind: "output", text: "A2A-Version: 1.0.0" },
      { kind: "output", text: "task: submitted -> working -> completed" },
      { kind: "json", text: '{\n  "task_id": "task_demo_gomoku_001",\n  "state": "TASK_STATE_COMPLETED",\n  "artifact": {\n    "mimeType": "application/json",\n    "data": {\n      "move": { "x": 10, "y": 8, "notation": "J8" },\n      "reason": "extends black pressure while blocking white expansion",\n      "confidence": 0.82\n    }\n  }\n}' },
      { kind: "success", text: "Invocation succeeded. 1000 tokens charged." }
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
    terminal: [
      { kind: "prompt", text: "momoai agent profile openclaw --local-url http://127.0.0.1:18789" },
      { kind: "success", text: "Profile openclaw saved." },
      { kind: "prompt", text: "momoai agent openclaw install-a2a --service websocket --capability gomoku_move:1000" },
      { kind: "output", text: "standard A2A adapter: installed" },
      { kind: "output", text: "MOMOAI market adapter: installed" },
      { kind: "prompt", text: "momoai agent publish --profile openclaw" },
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
    terminal: [
      { kind: "prompt", text: "momoai agent connect --profile openclaw" },
      { kind: "output", text: "relay: wss://momoai.pro/a2a/provider/relay" },
      { kind: "output", text: "provider node: node_demo_openclaw_18789" },
      { kind: "success", text: "OpenClaw is online and ready for A2A invocations." },
      { kind: "prompt", text: "momoai agent health --profile openclaw" },
      { kind: "json", text: '{\n  "agent_id": 242,\n  "service": "websocket",\n  "local_url": "http://127.0.0.1:18789",\n  "capabilities": ["general_task", "market_trading", "gomoku_move"],\n  "status": "ready"\n}' }
    ]
  }
];

const agentCard = {
  name: "OpenClaw A2A Service",
  description: "OpenClaw standard A2A service with MOMOAI market adapter",
  protocolVersion: "1.0.0",
  url: "https://momoai.pro/a2a/agents/242",
  preferredTransport: "JSONRPC",
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  skills: [
    {
      id: "gomoku_move",
      name: "Gomoku move",
      description: "Normalize a Gomoku board and recommend the next legal move.",
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"]
    }
  ]
};

const marketCard = {
  billing_mode: "fixed_result",
  charged_when: "task_completed",
  service_type: "websocket",
  provider_execution: "local_machine",
  momoai_market: {
    capabilities: [
      {
        id: "gomoku_move",
        name: "Gomoku move",
        fixed_tokens: 1000,
        accepted_output_modes: ["text/plain", "application/json"],
        result_contract: {
          requested_output_mode: "application/json",
          result_location: "artifact"
        }
      }
    ]
  }
};

const totalSeconds = 80;
let sceneIndex = 0;
let selectedCard = "agent";
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
const cardOutput = document.getElementById("cardOutput");
const inspectorTitle = document.getElementById("inspectorTitle");
const providerStatus = document.getElementById("providerStatus");
const billingMode = document.getElementById("billingMode");
const transportMode = document.getElementById("transportMode");
const capabilityPrice = document.getElementById("capabilityPrice");
const providerDot = document.getElementById("providerDot");
const metricTokens = document.getElementById("metricTokens");
const metricLatency = document.getElementById("metricLatency");
const metricStatus = document.getElementById("metricStatus");

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

  document.querySelectorAll(".call-path li").forEach((item, index) => {
    item.classList.toggle("active", index < scene.pathActive);
  });
}

function updateTimeline() {
  const progress = sceneIndex / Math.max(1, scenes.length - 1);
  timelineFill.style.width = `${progress * 100}%`;
  timecode.textContent = `${formatTime(progress * totalSeconds)} / ${formatTime(totalSeconds)}`;
}

function updateCard() {
  const data = selectedCard === "agent" ? agentCard : marketCard;
  cardOutput.textContent = JSON.stringify(data, null, 2);
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.card === selectedCard);
  });
}

function appendLine(kind, text = "") {
  const line = document.createElement("span");
  line.className = `terminal-line ${kind}`;
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  return line;
}

async function typePrompt(command, token) {
  const line = document.createElement("span");
  line.className = "terminal-line prompt";

  const prompt = document.createElement("span");
  prompt.className = "prompt-mark";
  prompt.textContent = "momo@MacBook-Pro ~ % ";
  line.appendChild(prompt);

  const commandNode = document.createTextNode("");
  line.appendChild(commandNode);

  const cursor = document.createElement("span");
  cursor.className = "cursor";
  line.appendChild(cursor);

  terminalOutput.appendChild(line);

  for (const char of command) {
    if (token !== renderToken) return;
    commandNode.textContent += char;
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    await sleep(14);
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
        await typePrompt(entry.text, token);
      } else {
        appendLine("prompt", `momo@MacBook-Pro ~ % ${entry.text}`);
      }
      continue;
    }

    const lines = entry.text.split("\n");
    for (const line of lines) {
      if (token !== renderToken) return;
      appendLine(entry.kind, line);
      if (animate) await sleep(45);
    }

    if (animate) await sleep(130);
  }

  if (isPlaying && token === renderToken) {
    await sleep(1100);
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

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCard = button.dataset.card;
      updateCard();
    });
  });
}

buildSteps();
attachEvents();
updateCard();
setScene(0, false);
