// sse.js — Server-Sent Events endpoint (GET /events/stream)

const express = require("express");
const router = express.Router();

const clients = new Set();

router.get("/stream", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });

    res.write("event: connected\ndata: {\"status\":\"connected\"}\n\n");

    clients.add(res);
    console.log(`SSE client connected (total: ${clients.size})`);

    // heartbeat keeps the connection alive through proxies
    const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
    }, 15000);

    req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
        console.log(`SSE client disconnected (total: ${clients.size})`);
    });
});

// --- push to all SSE clients ---

let eventCounter = 0;

function pushSSE(event) {
    eventCounter++;
    const data = JSON.stringify(event);

    clients.forEach((res) => {
        res.write(`id: ${eventCounter}\n`);
        res.write(`event: event\n`);
        res.write(`data: ${data}\n\n`);
    });
}

module.exports = { sseRouter: router, pushSSE };
