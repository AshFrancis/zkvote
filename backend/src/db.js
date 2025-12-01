/**
 * SQLite Database for DaoVote Event Storage
 *
 * Provides persistent storage for events with efficient querying.
 * Supports frontend notifications with on-chain verification.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'daovote.db');

// Logger
const log = (level, event, meta = {}) => {
  console.log(JSON.stringify({ level, event, ts: new Date().toISOString(), ...meta }));
};

let db = null;

/**
 * Initialize the database
 */
export function initDb() {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL'); // Better concurrency

  // Create tables
  db.exec(`
    -- Events table
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dao_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT, -- JSON
      ledger INTEGER,
      tx_hash TEXT,
      timestamp TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(dao_id, ledger, tx_hash, type)
    );

    -- Indexes for efficient querying
    CREATE INDEX IF NOT EXISTS idx_events_dao_id ON events(dao_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);

    -- Metadata table for tracking state
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  log('info', 'db_initialized', { path: DB_FILE });
  return db;
}

/**
 * Close the database
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    log('info', 'db_closed');
  }
}

/**
 * Get or set metadata
 */
export function getMetadata(key) {
  const db = initDb();
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setMetadata(key, value) {
  const db = initDb();
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

/**
 * Add an event to the database
 * Returns true if added, false if duplicate
 */
export function addEvent(event) {
  const db = initDb();
  try {
    db.prepare(`
      INSERT INTO events (dao_id, type, data, ledger, tx_hash, timestamp, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.daoId,
      event.type,
      JSON.stringify(event.data),
      event.ledger || null,
      event.txHash || null,
      event.timestamp || new Date().toISOString(),
      event.verified ? 1 : 0
    );
    return true;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return false; // Duplicate
    }
    throw err;
  }
}

/**
 * Add a pending (unverified) event from frontend notification
 * The event will be verified against the chain before being marked as verified
 */
export function addPendingEvent(daoId, type, data, txHash) {
  return addEvent({
    daoId,
    type,
    data,
    ledger: null,
    txHash,
    timestamp: new Date().toISOString(),
    verified: false,
  });
}

/**
 * Mark an event as verified
 */
export function verifyEvent(txHash, ledger) {
  const db = initDb();
  db.prepare('UPDATE events SET verified = 1, ledger = ? WHERE tx_hash = ?').run(ledger, txHash);
}

/**
 * Get events for a DAO
 */
export function getEventsForDao(daoId, options = {}) {
  const db = initDb();
  const { limit = 50, offset = 0, types = null, verifiedOnly = false } = options;

  let query = 'SELECT * FROM events WHERE dao_id = ?';
  const params = [daoId];

  if (types && types.length > 0) {
    query += ` AND type IN (${types.map(() => '?').join(',')})`;
    params.push(...types);
  }

  if (verifiedOnly) {
    query += ' AND verified = 1';
  }

  query += ' ORDER BY timestamp DESC, ledger DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const events = db.prepare(query).all(...params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) as total FROM events WHERE dao_id = ?';
  const countParams = [daoId];
  if (types && types.length > 0) {
    countQuery += ` AND type IN (${types.map(() => '?').join(',')})`;
    countParams.push(...types);
  }
  if (verifiedOnly) {
    countQuery += ' AND verified = 1';
  }
  const { total } = db.prepare(countQuery).get(...countParams);

  return {
    events: events.map(e => ({
      ...e,
      data: e.data ? JSON.parse(e.data) : null,
      verified: !!e.verified,
    })),
    total,
    daoId,
  };
}

/**
 * Get all indexed DAOs
 */
export function getIndexedDaos() {
  const db = initDb();
  const rows = db.prepare(`
    SELECT dao_id, COUNT(*) as event_count
    FROM events
    GROUP BY dao_id
    ORDER BY dao_id
  `).all();

  return rows.map(r => ({
    daoId: r.dao_id,
    eventCount: r.event_count,
  }));
}

/**
 * Get database status
 */
export function getDbStatus() {
  const db = initDb();
  const { total } = db.prepare('SELECT COUNT(*) as total FROM events').get();
  const { daoCount } = db.prepare('SELECT COUNT(DISTINCT dao_id) as daoCount FROM events').get();
  const lastLedger = getMetadata('lastLedger') || 0;

  return {
    totalEvents: total,
    daoCount,
    lastLedger,
  };
}

/**
 * Get unverified events that need chain verification
 */
export function getUnverifiedEvents(limit = 10) {
  const db = initDb();
  return db.prepare(`
    SELECT * FROM events
    WHERE verified = 0 AND tx_hash IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit).map(e => ({
    ...e,
    data: e.data ? JSON.parse(e.data) : null,
  }));
}

/**
 * Delete an unverified event (if verification fails)
 */
export function deleteUnverifiedEvent(txHash) {
  const db = initDb();
  db.prepare('DELETE FROM events WHERE tx_hash = ? AND verified = 0').run(txHash);
}

/**
 * Migrate events from JSON file to SQLite
 */
export function migrateFromJson(jsonPath) {
  const db = initDb();

  if (!fs.existsSync(jsonPath)) {
    log('info', 'no_json_to_migrate');
    return 0;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const events = data.events || {};
    let migrated = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO events (dao_id, type, data, ledger, tx_hash, timestamp, verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    db.transaction(() => {
      for (const [daoId, daoEvents] of Object.entries(events)) {
        for (const event of daoEvents) {
          try {
            insertStmt.run(
              Number(daoId),
              event.type,
              JSON.stringify(event.data),
              event.ledger || null,
              event.txHash || null,
              event.timestamp || new Date().toISOString()
            );
            migrated++;
          } catch (err) {
            // Skip duplicates
          }
        }
      }

      // Save last ledger
      if (data.lastLedger) {
        setMetadata('lastLedger', data.lastLedger);
      }
    })();

    log('info', 'json_migration_complete', { migrated });

    // Rename old file
    fs.renameSync(jsonPath, jsonPath + '.migrated');

    return migrated;
  } catch (err) {
    log('error', 'json_migration_failed', { error: err.message });
    return 0;
  }
}
