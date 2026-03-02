// pool.js — PostgreSQL connection pool

const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    user: process.env.PG_USER || "eventmonitor",
    password: process.env.PG_PASSWORD || "eventmonitor123",
    database: process.env.PG_DATABASE || "eventmonitor",
});

pool.on("error", (err) => {
    console.error("Unexpected pool error:", err.message);
});

module.exports = pool;
