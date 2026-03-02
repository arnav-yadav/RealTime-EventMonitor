// index.js — entry point: Express + WebSocket + Kafka consumer

const path = require("path");
const http = require("http");
const express = require("express");

const pool = require("./db/pool");
const { redis } = require("./redis/client");
const { initWebSocket } = require("./websocket/server");
const { startConsumer, stopConsumer } = require("./kafka/consumer");
const { sseRouter } = require("./routes/sse");
const pollingRouter = require("./routes/polling");

process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- static frontend ---
app.use(express.static(path.join(__dirname, "public")));

// --- routes ---

app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/events", sseRouter);      // GET /events/stream
app.use("/events", pollingRouter);  // GET /events/latest, /events/stats

// --- server ---

const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, async () => {
    console.log(`\nEvent Monitor running on port ${PORT}`);
    console.log(`  Dashboard  http://localhost:${PORT}`);
    console.log(`  WebSocket  ws://localhost:${PORT}/ws`);
    console.log(`  SSE        http://localhost:${PORT}/events/stream`);
    console.log(`  Polling    http://localhost:${PORT}/events/stats\n`);

    try {
        await startConsumer();
    } catch (err) {
        console.error("Consumer failed to start:", err.message);
        process.exit(1);
    }
});

// --- graceful shutdown ---

let isShuttingDown = false;

async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("\nShutting down...");
    try {
        await stopConsumer();
        await pool.end();
        await redis.quit();
        server.close();
        console.log("All services disconnected");
    } catch (err) {
        console.error("Shutdown error:", err.message);
    }
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
