// server.js — WebSocket server, broadcasts events + metrics to clients

const { WebSocketServer } = require("ws");
const { redis } = require("../redis/client");

const EVENT_TYPES = ["ERROR", "LOGIN", "PAYMENT", "LOCATION"];
let wss = null;

function initWebSocket(server) {
    wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws) => {
        console.log(`WS client connected (total: ${wss.clients.size})`);

        ws.on("close", () => {
            console.log(`WS client disconnected (total: ${wss.clients.size})`);
        });

        ws.on("error", (err) => {
            console.error("WS error:", err.message);
        });
    });

    console.log("WebSocket server ready on /ws");
}

// Sends the raw event + current Redis metrics to every connected client
async function broadcastEvent(event) {
    if (!wss || wss.clients.size === 0) return;

    // fetch current counters + ranking from Redis
    const pipeline = redis.pipeline();
    EVENT_TYPES.forEach((type) => pipeline.get(`event_count:${type}`));
    pipeline.zrevrange("event_ranking", 0, -1, "WITHSCORES");
    const results = await pipeline.exec();

    const counters = {};
    EVENT_TYPES.forEach((type, i) => {
        counters[type] = parseInt(results[i][1]) || 0;
    });

    const rankingRaw = results[EVENT_TYPES.length][1] || [];
    const ranking = [];
    for (let i = 0; i < rankingRaw.length; i += 2) {
        ranking.push({ type: rankingRaw[i], count: parseInt(rankingRaw[i + 1]) });
    }

    const eventMsg = JSON.stringify({ type: "event", data: event });
    const metricsMsg = JSON.stringify({ type: "metrics", data: { counters, ranking } });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(eventMsg);
            client.send(metricsMsg);
        }
    });
}

module.exports = { initWebSocket, broadcastEvent };
