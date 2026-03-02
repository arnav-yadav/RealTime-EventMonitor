# 🔔 Real-Time Event Monitoring & Alert System

A production-grade, fully containerized event-driven system built with **Node.js**, **Apache Kafka**, **Redis**, **PostgreSQL**, and **WebSockets**. It demonstrates real-time event ingestion, persistent storage, in-memory aggregation, and live streaming to clients via multiple transport protocols.

---

## Architecture

```
┌──────────────┐     ┌─────────────────────────────────────────────────────────────┐
│   Producer   │     │                    Backend Service                          │
│ (event gen)  │     │                                                             │
│              │     │  ┌───────────┐   ┌────────────┐   ┌──────────────────────┐  │
│  EVENT_TYPES │     │  │  Kafka    │──▶│  Consumer   │──▶│  PostgreSQL (persist)│  │
│  ─ ERROR     │────▶│  │  Topic:   │   │  (group:    │   └──────────────────────┘  │
│  ─ LOGIN     │     │  │  "events" │   │  event-     │──▶┌──────────────────────┐  │
│  ─ PAYMENT   │     │  │  3 parts  │   │  processors)│   │  Redis (aggregation) │  │
│  ─ LOCATION  │     │  └───────────┘   │             │   │  ─ counters (60s TTL)│  │
│              │     │                  │             │   │  ─ latest per type   │  │
│ userId key   │     │                  │             │   │  ─ ranking (ZADD)    │  │
│ for partition│     │                  │             │   └──────────────────────┘  │
└──────────────┘     │                  │             │                             │
                     │                  │             │──▶┌──────────────────────┐  │
                     │                  │             │   │  WebSocket (/ws)     │  │
                     │                  │             │   │  ─ raw events        │  │
                     │                  │             │   │  ─ live metrics      │  │
                     │                  │             │   └──────────────────────┘  │
                     │                  │             │                             │
                     │                  │             │──▶┌──────────────────────┐  │
                     │                  └─────────────┘   │  SSE (/events/stream)│  │
                     │                                    │  ─ raw events        │  │
                     │                                    │  ─ heartbeat 15s     │  │
                     │                                    └──────────────────────┘  │
                     │                                                             │
                     │  ┌────────────────────────────────────────────────────────┐  │
                     │  │  Polling Fallback (Redis-only reads)                  │  │
                     │  │  GET /events/stats   → counters + ranking             │  │
                     │  │  GET /events/latest  → latest event per type          │  │
                     │  └────────────────────────────────────────────────────────┘  │
                     │                                                             │
                     │  Express HTTP Server (port 3000)                            │
                     └─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| Message Broker | Apache Kafka (Confluent 7.6.0) | Durable event ingestion with partitioning |
| Event Store | PostgreSQL 16 | Persistent storage (source of truth) |
| Cache / Aggregation | Redis 7 | Real-time counters, rankings, latest events |
| Backend | Node.js 22 + Express | HTTP API, consumer processing |
| Real-time (bi-directional) | WebSocket (`ws`) | Live dashboard with events + metrics |
| Real-time (uni-directional) | Server-Sent Events | Lightweight one-way streaming |
| Containerization | Docker + Docker Compose | Full orchestration |

---

## Quick Start

### Prerequisites
- Docker Desktop running

### Run

```bash
# Start the entire system (6 containers)
docker-compose up --build -d

# View logs
docker logs -f em-backend    # Consumer + API
docker logs -f em-producer   # Event generator
```

### Endpoints

| Endpoint | Protocol | Description |
|---|---|---|
| `http://localhost:3000/health` | HTTP | Health check |
| `http://localhost:3000/events/stats` | HTTP (Polling) | Counters + ranking from Redis |
| `http://localhost:3000/events/latest` | HTTP (Polling) | Latest event per type |
| `http://localhost:3000/events/stream` | SSE | One-way real-time event stream |
| `ws://localhost:3000/ws` | WebSocket | Bi-directional real-time (events + metrics) |

### Test Connectivity

```bash
# Health check
curl http://localhost:3000/health

# Polling
curl http://localhost:3000/events/stats
curl http://localhost:3000/events/latest

# SSE (Ctrl+C to stop)
curl -N http://localhost:3000/events/stream

# WebSocket (requires wscat: npm i -g wscat)
wscat -c ws://localhost:3000/ws
```

### Load Testing

```bash
# High throughput: 84 events/sec (5,040+/min)
EVENTS_PER_SEC=84 docker-compose up producer --build

# Or locally
cd backend && npm run produce:load
```

### Teardown

```bash
docker-compose down -v  # Stops containers + removes volumes
```

---

## Project Structure

```
event-monitor/
├── docker-compose.yml          # Full orchestration (6 services)
├── .env                        # Service connection config
├── backend/
│   ├── Dockerfile              # Node 22 Alpine multi-stage
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── index.js            # Entry point: Express + WS + Consumer
│       ├── kafka/
│       │   ├── producer.js     # Event generator (configurable rate)
│       │   └── consumer.js     # Event processor (DB + Redis + WS + SSE)
│       ├── db/
│       │   ├── pool.js         # PostgreSQL connection pool
│       │   └── init.js         # Schema migration (events table)
│       ├── redis/
│       │   └── client.js       # Redis client + aggregation helpers
│       ├── websocket/
│       │   └── server.js       # WebSocket server + broadcast
│       └── routes/
│           ├── sse.js          # SSE streaming endpoint
│           └── polling.js      # REST polling endpoints
```

---

## Design Decisions

### Why Kafka?

- **Durability**: Events are persisted to disk and replicated. If the consumer crashes, no events are lost — they're replayed from the last committed offset.
- **Ordering**: Per-partition ordering guarantees that events for the same `userId` are processed in-order (using userId as partition key).
- **Scalability**: Adding more partitions and consumer instances linearly scales throughput. We tested 3 partitions with 2 consumers and confirmed automatic rebalancing.
- **Decoupling**: Producer and consumer are fully decoupled. The producer doesn't know or care who consumes events, enabling future subscriber addition without code changes.

### Why Redis?

- **Speed**: Sub-millisecond reads for dashboard polling endpoints. No expensive DB queries on every poll request.
- **Sliding Windows**: `INCR` + `EXPIRE 60` gives a natural 60-second sliding window counter with zero application logic.
- **Ranking**: `ZINCRBY` on a sorted set provides O(log N) ranking that's always up-to-date.
- **Ephemeral by Design**: Redis data is disposable — it can be rebuilt from Kafka replay or Postgres queries. This separation lets us optimize for speed without compromising correctness.

### Why WebSocket vs SSE?

Both are implemented to demonstrate the trade-offs:

| Feature | WebSocket | SSE |
|---|---|---|
| Direction | Bi-directional | Server → Client only |
| Protocol | Custom (ws://) | Standard HTTP |
| Reconnection | Manual | Built-in (Last-Event-ID) |
| Data Format | JSON messages | Event stream |
| Use Case | Interactive dashboards | Notification feeds |

**WebSocket** is used when the client needs to send data back (e.g., filter subscriptions, commands). **SSE** is ideal when you just need one-way push with automatic reconnection.

### Why Manual Offset Commits?

```
1. Read message from Kafka
2. Write to PostgreSQL
3. Update Redis aggregations
4. Broadcast to WS/SSE clients
5. COMMIT offset ← only now
```

If any step (1-4) fails, the offset is **not committed**. On restart, Kafka replays from the last committed offset, guaranteeing **at-least-once delivery**. The `ON CONFLICT (event_id) DO NOTHING` clause in PostgreSQL ensures idempotent writes, preventing duplicates on replay.

The alternative — auto-commit — would commit offsets periodically regardless of processing success, risking data loss.

---

## Event Schema

```json
{
  "eventId": "uuid-v4",
  "type": "ERROR | LOGIN | PAYMENT | LOCATION",
  "service": "auth-service | payment-service | tracking-service",
  "timestamp": 1772485512144,
  "payload": {
    "userId": "user-1",
    "message": "Connection timeout"   // ERROR
    // "action": "login"              // LOGIN
    // "amount": 163.39, "currency": "USD"  // PAYMENT
    // "lat": 28.5432, "lng": 77.1234      // LOCATION
  }
}
```

---

## Stress Test Results

Tested on MacBook with Docker Desktop. All services running in containers.

| Metric | Value |
|---|---|
| Producer Rate | 84 events/sec (5,040/min) |
| Consumer Throughput | Sustained processing with 0 errors |
| DB Inserts | 4,292 events in ~30 seconds |
| Consumer Instances | 2 (auto-rebalanced partitions [0,1] + [2]) |
| Redis Pipeline | 3 commands/event (INCR, SET, ZINCRBY) in single round-trip |
| WS Broadcast | Events + metrics to all connected clients per event |
| SSE Stream | 1 event per message with incremental ID |
| PostgreSQL Idempotency | `ON CONFLICT DO NOTHING` — safe on replay |
| Graceful Shutdown | All connections cleanly closed (Kafka, PG, Redis, HTTP) |

### Partition Distribution Under Load

```
Consumer 1 (backend):    partitions [0, 1] — leader
Consumer 2 (standalone): partition  [2]    — follower
```

Kafka automatically rebalanced when the second consumer joined the `event-processors` group.

---

## Docker Services

```bash
$ docker-compose ps
NAME           IMAGE                         STATUS
em-zookeeper   cp-zookeeper:7.6.0            Healthy
em-kafka       cp-kafka:7.6.0                Healthy
em-redis       redis:7-alpine                Healthy
em-postgres    postgres:16-alpine            Healthy
em-backend     event-monitor-backend         Running (Express + WS + Consumer)
em-producer    event-monitor-producer        Running (Event Generator)
```

---

## NPM Scripts

```bash
npm start          # Start backend (Express + WS + Consumer)
npm run produce    # Start producer (1 event/sec)
npm run produce:load  # Start producer (84 events/sec — load test)
npm run consume    # Start standalone consumer
npm run test:kafka # Test Kafka connectivity
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KAFKA_BROKER` | `localhost:9092` | Kafka bootstrap server |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `PG_HOST` | `localhost` | PostgreSQL host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_USER` | `eventmonitor` | PostgreSQL user |
| `PG_PASSWORD` | `eventmonitor123` | PostgreSQL password |
| `PG_DATABASE` | `eventmonitor` | PostgreSQL database |
| `PORT` | `3000` | HTTP server port |
| `EVENTS_PER_SEC` | `1` | Producer event rate |

> In Docker, service names (`kafka:29092`, `redis`, `postgres`) are used automatically via docker-compose environment config.
