// client.js — Redis connection + aggregation helpers

const Redis = require("ioredis");

const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

// Updates all three aggregations in a single pipeline (one round-trip):
//   1. Sliding window counter  (INCR + EXPIRE 60s)
//   2. Latest event per type   (SET)
//   3. All-time ranking        (ZINCRBY)
async function updateAggregations(event) {
    const pipeline = redis.pipeline();

    pipeline.incr(`event_count:${event.type}`);
    pipeline.expire(`event_count:${event.type}`, 60);

    pipeline.set(`latest_event:${event.type}`, JSON.stringify(event));

    pipeline.zincrby("event_ranking", 1, event.type);

    await pipeline.exec();
}

module.exports = { redis, updateAggregations };
