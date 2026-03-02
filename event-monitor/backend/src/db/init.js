// init.js — creates the events table if it doesn't exist

const pool = require("./pool");

const CREATE_TABLE = `
    CREATE TABLE IF NOT EXISTS events (
        id          SERIAL PRIMARY KEY,
        event_id    VARCHAR(64) UNIQUE NOT NULL,
        type        VARCHAR(32) NOT NULL,
        service     VARCHAR(64) NOT NULL,
        timestamp   BIGINT NOT NULL,
        payload     JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_service ON events(service);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
`;

async function initDB() {
    await pool.query(CREATE_TABLE);
    console.log("Events table ready");
}

module.exports = initDB;

if (require.main === module) {
    initDB()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("DB init failed:", err.message);
            process.exit(1);
        });
}
