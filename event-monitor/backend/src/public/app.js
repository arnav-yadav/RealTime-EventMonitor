/**
 * app.js
 * Frontend logic for the Event Monitor dashboard.
 * Connects to the backend via WebSocket and renders:
 *   - Live event feed (newest first)
 *   - Real-time counters (60s sliding window from Redis)
 *   - All-time ranking bar chart
 */

// ─── State ──────────────────────────────────────────

let totalEvents = 0;
const MAX_FEED_ITEMS = 100; // keep the feed from growing forever

// ─── DOM References ─────────────────────────────────

const feedEl = document.getElementById("feed");
const eventCountEl = document.getElementById("event-count");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const rankingEl = document.getElementById("ranking");

// ─── WebSocket Connection ───────────────────────────
//
// We connect to the same host that served this page.
// In Docker, this is the em-backend container on port 3000.

function connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.addEventListener("open", () => {
        statusEl.className = "connection-status connected";
        statusTextEl.textContent = "Connected";
    });

    ws.addEventListener("close", () => {
        statusEl.className = "connection-status disconnected";
        statusTextEl.textContent = "Disconnected — retrying...";

        // Try to reconnect after 3 seconds
        setTimeout(connect, 3000);
    });

    ws.addEventListener("message", (msg) => {
        const { type, data } = JSON.parse(msg.data);

        if (type === "event") renderEvent(data);
        if (type === "metrics") renderMetrics(data);
    });
}

// ─── Render: Event Feed ─────────────────────────────
//
// Each new event slides in at the top of the feed.
// Old items are trimmed once we exceed MAX_FEED_ITEMS.

function renderEvent(event) {
    totalEvents++;
    eventCountEl.textContent = `${totalEvents} events`;

    const time = new Date(event.timestamp).toLocaleTimeString();
    const shortId = event.eventId.slice(0, 8);

    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerHTML = `
        <span class="feed-type ${event.type}">${event.type}</span>
        <span class="feed-service">${event.service}</span>
        <span class="feed-id">${shortId}</span>
        <span class="feed-time">${time}</span>
    `;

    // Newest events go to the top
    feedEl.prepend(item);

    // Don't let the feed grow unbounded
    while (feedEl.children.length > MAX_FEED_ITEMS) {
        feedEl.removeChild(feedEl.lastChild);
    }
}

// ─── Render: Counters ───────────────────────────────
//
// Counters show the 60-second sliding window from Redis.
// A brief color flash highlights when a value changes.

function renderMetrics({ counters, ranking }) {
    // Update each counter card
    for (const [type, value] of Object.entries(counters)) {
        const el = document.getElementById(`count-${type}`);
        if (!el) continue;

        const oldValue = el.textContent;
        el.textContent = value;

        // Flash the number when it changes
        if (oldValue !== String(value)) {
            el.classList.add("flash");
            setTimeout(() => el.classList.remove("flash"), 400);
        }
    }

    // Update the ranking bars
    renderRanking(ranking);
}

// ─── Render: Ranking Bars ───────────────────────────
//
// Simple horizontal bar chart, scaled relative to the
// highest count. Position number on the left, bar on right.

function renderRanking(ranking) {
    if (!ranking || ranking.length === 0) return;

    const maxCount = ranking[0].count || 1;

    rankingEl.innerHTML = ranking.map((item, i) => {
        const pct = Math.round((item.count / maxCount) * 100);
        return `
            <div class="ranking-item">
                <span class="ranking-position">${i + 1}</span>
                <div class="ranking-bar-wrapper">
                    <div class="ranking-type-label">
                        <span>${item.type}</span>
                        <span class="ranking-count">${item.count.toLocaleString()}</span>
                    </div>
                    <div class="ranking-bar">
                        <div class="ranking-bar-fill ${item.type}" style="width: ${pct}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// ─── Start ──────────────────────────────────────────

connect();
