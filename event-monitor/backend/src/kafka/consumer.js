// consumer.js — processes events from Kafka
//
// Pipeline per message:
//   1. Insert into Postgres (idempotent via ON CONFLICT)
//   2. Update Redis aggregations
//   3. Broadcast to WebSocket clients
//   4. Push to SSE streams
//   5. Commit Kafka offset (only after everything above succeeds)

const { Kafka, logLevel } = require("kafkajs");
const pool = require("../db/pool");
const initDB = require("../db/init");
const { redis, updateAggregations } = require("../redis/client");
const { broadcastEvent } = require("../websocket/server");
const { pushSSE } = require("../routes/sse");

process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

const BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const TOPIC = "events";
const GROUP_ID = "event-processors";

const kafka = new Kafka({
    clientId: "event-consumer",
    brokers: [BROKER],
    logLevel: logLevel.WARN,
});

const consumer = kafka.consumer({
    groupId: GROUP_ID,
    autoCommit: false,
    fromBeginning: true,
});

// --- db insert (idempotent) ---

const INSERT_SQL = `
    INSERT INTO events (event_id, type, service, timestamp, payload)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (event_id) DO NOTHING
`;

async function processEvent(event, topic, partition, offset) {
    await pool.query(INSERT_SQL, [
        event.eventId,
        event.type,
        event.service,
        event.timestamp,
        JSON.stringify(event.payload),
    ]);

    await updateAggregations(event);
    await broadcastEvent(event);
    pushSSE(event);

    console.log(
        `[${event.type}] ${event.eventId} | p=${partition} o=${offset} | done`
    );
}

// --- start / stop (exported for index.js) ---

async function startConsumer() {
    await initDB();

    await consumer.connect();
    console.log(`Consumer connected | group="${GROUP_ID}" topic="${TOPIC}"\n`);

    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
            try {
                const event = JSON.parse(message.value.toString());
                await processEvent(event, topic, partition, message.offset);

                // commit only after full pipeline succeeds
                await consumer.commitOffsets([{
                    topic,
                    partition,
                    offset: (Number(message.offset) + 1).toString(),
                }]);

                await heartbeat();
            } catch (err) {
                console.error(
                    `Error at p=${partition} o=${message.offset}:`,
                    err.message
                );
            }
        },
    });
}

// --- event listeners ---

consumer.on("consumer.crash", ({ payload }) => {
    console.error("Consumer crashed:", payload.error.message);
    setTimeout(() => {
        console.log("Restarting consumer...");
        startConsumer().catch((err) => {
            console.error("Restart failed:", err.message);
            process.exit(1);
        });
    }, 5000);
});

consumer.on("consumer.group_join", ({ payload }) => {
    console.log(
        `Joined group "${payload.groupId}" | member=${payload.memberId} | leader=${payload.isLeader}`
    );
});

consumer.on("consumer.rebalancing", () => {
    console.log("Rebalancing in progress...");
});

async function stopConsumer() {
    await consumer.disconnect();
}

module.exports = { startConsumer, stopConsumer };

// --- standalone mode (node src/kafka/consumer.js) ---

if (require.main === module) {
    let isShuttingDown = false;

    async function shutdown() {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log("\nShutting down...");
        try {
            await stopConsumer();
            await pool.end();
            await redis.quit();
        } catch (err) {
            console.error("Shutdown error:", err.message);
        }
        process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    startConsumer().catch((err) => {
        console.error("Consumer failed:", err.message);
        process.exit(1);
    });
}
