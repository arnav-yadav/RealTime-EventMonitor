// polling.js — REST fallback endpoints (Redis-only reads)
//
//   GET /events/latest  -> latest event per type
//   GET /events/stats   -> counters + ranking

const express = require("express");
const { redis } = require("../redis/client");
const router = express.Router();

const EVENT_TYPES = ["ERROR", "LOGIN", "PAYMENT", "LOCATION"];

router.get("/latest", async (_req, res) => {
    try {
        const pipeline = redis.pipeline();
        EVENT_TYPES.forEach((type) => pipeline.get(`latest_event:${type}`));
        const results = await pipeline.exec();

        const latest = {};
        EVENT_TYPES.forEach((type, i) => {
            const raw = results[i][1];
            latest[type] = raw ? JSON.parse(raw) : null;
        });

        res.json({ latest });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/stats", async (_req, res) => {
    try {
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

        res.json({ counters, ranking });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
