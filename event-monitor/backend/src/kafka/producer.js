// producer.js — generates random events, publishes to Kafka

const { Kafka, logLevel } = require("kafkajs");
const crypto = require("crypto");

process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

const BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const TOPIC = "events";

const kafka = new Kafka({
    clientId: "event-producer",
    brokers: [BROKER],
    logLevel: logLevel.WARN,
});

const producer = kafka.producer();

// --- event data pools ---

const EVENT_TYPES = ["ERROR", "LOGIN", "PAYMENT", "LOCATION"];

const SERVICES = {
    ERROR: "auth-service",
    LOGIN: "auth-service",
    PAYMENT: "payment-service",
    LOCATION: "tracking-service",
};

const USER_IDS = ["user-1", "user-2", "user-3", "user-4", "user-5"];

const ERROR_MESSAGES = [
    "Connection timeout",
    "Null pointer exception",
    "Out of memory",
    "Disk full",
    "Service unavailable",
];

// --- helpers ---

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildPayload(type, userId) {
    switch (type) {
        case "ERROR":
            return { message: pick(ERROR_MESSAGES), userId };
        case "LOGIN":
            return { userId, action: "login" };
        case "PAYMENT":
            return { userId, amount: +(Math.random() * 500).toFixed(2), currency: "USD" };
        case "LOCATION":
            return { userId, lat: +(28 + Math.random()).toFixed(4), lng: +(77 + Math.random()).toFixed(4) };
    }
}

function generateEvent() {
    const type = pick(EVENT_TYPES);
    const userId = pick(USER_IDS);
    return {
        eventId: crypto.randomUUID(),
        type,
        service: SERVICES[type],
        timestamp: Date.now(),
        payload: buildPayload(type, userId),
    };
}

// --- main ---

let intervalId = null;

async function start() {
    // ensure topic exists
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();

    if (!topics.includes(TOPIC)) {
        await admin.createTopics({
            topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }],
        });
        console.log(`Topic "${TOPIC}" created with 3 partitions`);
    }

    await admin.disconnect();
    await producer.connect();

    const RATE = parseInt(process.env.EVENTS_PER_SEC || "1");
    console.log(`Producer connected | ${RATE} event(s)/sec -> "${TOPIC}"\n`);

    intervalId = setInterval(async () => {
        const messages = [];
        for (let i = 0; i < RATE; i++) {
            const event = generateEvent();
            messages.push({ key: event.payload.userId, value: JSON.stringify(event) });
        }

        try {
            await producer.send({ topic: TOPIC, messages });
            if (RATE <= 5) {
                messages.forEach((m) => {
                    const e = JSON.parse(m.value);
                    console.log(`[${e.type}] ${e.eventId} -> key=${m.key}`);
                });
            } else {
                process.stdout.write(`\rSent batch of ${RATE} events`);
            }
        } catch (err) {
            console.error("Send failed:", err.message);
        }
    }, 1000);
}

// --- shutdown ---

let isShuttingDown = false;

async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nShutting down producer...");
    if (intervalId) clearInterval(intervalId);
    try {
        await producer.disconnect();
    } catch (err) {
        console.error("Shutdown error:", err.message);
    }
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
    console.error("Producer failed to start:", err.message);
    process.exit(1);
});
