/**
 * Event Indexer for DaoVote
 *
 * Polls Soroban RPC for contract events and stores them in memory.
 * Events are indexed by DAO ID for efficient querying.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Event types we index
const EVENT_TYPES = {
  // DAO Registry
  DaoCreateEvent: 'dao_create',
  AdminXferEvent: 'admin_transfer',
  // Membership SBT
  SbtMintEvent: 'member_added',
  SbtRevokeEvent: 'member_revoked',
  SbtLeaveEvent: 'member_left',
  // Membership Tree
  TreeInitEvent: 'tree_init',
  CommitEvent: 'voter_registered',
  RemovalEvent: 'voter_removed',
  ReinstatementEvent: 'voter_reinstated',
  // Voting
  VKSetEvent: 'vk_updated',
  ProposalEvent: 'proposal_created',
  ProposalClosedEvent: 'proposal_closed',
  ProposalArchivedEvent: 'proposal_archived',
  VoteEvent: 'vote_cast',
};

// In-memory event store indexed by DAO ID
// Structure: { [daoId]: Event[] }
let eventStore = {};
let lastLedger = 0;
let isPolling = false;

// Persistence file path
const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

// Logger
const log = (level, event, meta = {}) => {
  console.log(JSON.stringify({ level, event, ts: new Date().toISOString(), ...meta }));
};

/**
 * Load events from disk on startup
 */
export function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
      eventStore = data.events || {};
      lastLedger = data.lastLedger || 0;
      log('info', 'events_loaded', {
        daoCount: Object.keys(eventStore).length,
        lastLedger
      });
    }
  } catch (err) {
    log('warn', 'events_load_failed', { error: err.message });
  }
}

/**
 * Save events to disk
 */
function saveEvents() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(EVENTS_FILE, JSON.stringify({
      events: eventStore,
      lastLedger,
      savedAt: new Date().toISOString()
    }, null, 2));
  } catch (err) {
    log('warn', 'events_save_failed', { error: err.message });
  }
}

/**
 * Parse contract event data
 */
function parseEventData(event) {
  try {
    // Event topic contains event type
    const topics = event.topic || [];
    const data = event.value;

    // Try to identify event type from topic
    let eventType = 'unknown';
    let daoId = null;
    let parsed = {};

    // Topics are usually: [event_name, ...indexed_fields]
    if (topics.length > 0) {
      const eventName = StellarSdk.scValToNative(topics[0]);
      eventType = EVENT_TYPES[eventName] || eventName;

      // Extract DAO ID from first indexed field if present
      if (topics.length > 1) {
        try {
          daoId = Number(StellarSdk.scValToNative(topics[1]));
        } catch {
          // Not a DAO ID
        }
      }
    }

    // Parse event data
    if (data) {
      try {
        parsed = StellarSdk.scValToNative(data);
      } catch {
        // Keep raw
      }
    }

    return {
      type: eventType,
      daoId,
      data: parsed,
      ledger: event.ledger,
      txHash: event.txHash,
      timestamp: event.timestamp || null,
    };
  } catch (err) {
    log('warn', 'event_parse_failed', { error: err.message });
    return null;
  }
}

/**
 * Add event to store
 */
function addEvent(event) {
  if (!event || event.daoId === null) return;

  const daoId = String(event.daoId);
  if (!eventStore[daoId]) {
    eventStore[daoId] = [];
  }

  // Check for duplicates (by ledger + txHash + type)
  const isDuplicate = eventStore[daoId].some(e =>
    e.ledger === event.ledger &&
    e.txHash === event.txHash &&
    e.type === event.type
  );

  if (!isDuplicate) {
    eventStore[daoId].push(event);
    // Keep events sorted by ledger (newest first)
    eventStore[daoId].sort((a, b) => b.ledger - a.ledger);
    // Limit to 1000 events per DAO
    if (eventStore[daoId].length > 1000) {
      eventStore[daoId] = eventStore[daoId].slice(0, 1000);
    }
  }
}

/**
 * Poll for new events from Soroban RPC
 */
async function pollEvents(server, contractIds, startLedger) {
  try {
    // Get latest ledger
    const latestLedger = await server.getLatestLedger();
    const currentLedger = latestLedger.sequence;

    if (startLedger >= currentLedger) {
      return startLedger;
    }

    // Query events for each contract
    for (const contractId of contractIds) {
      try {
        const events = await server.getEvents({
          startLedger: startLedger + 1,
          filters: [{
            type: 'contract',
            contractIds: [contractId],
          }],
          limit: 100,
        });

        if (events.events && events.events.length > 0) {
          for (const event of events.events) {
            const parsed = parseEventData(event);
            if (parsed) {
              addEvent(parsed);
            }
          }
          log('info', 'events_indexed', {
            contract: contractId.slice(0, 8) + '...',
            count: events.events.length,
            latestLedger: currentLedger
          });
        }
      } catch (err) {
        // getEvents may fail if contract doesn't exist yet or no events
        if (!err.message.includes('not found')) {
          log('warn', 'poll_contract_failed', {
            contract: contractId.slice(0, 8) + '...',
            error: err.message
          });
        }
      }
    }

    return currentLedger;
  } catch (err) {
    log('error', 'poll_events_failed', { error: err.message });
    return startLedger;
  }
}

/**
 * Start the event indexer
 */
export async function startIndexer(server, contractIds, pollIntervalMs = 5000) {
  if (isPolling) {
    log('warn', 'indexer_already_running');
    return;
  }

  isPolling = true;
  loadEvents();

  log('info', 'indexer_started', {
    contracts: contractIds.length,
    pollInterval: pollIntervalMs,
    startLedger: lastLedger
  });

  // Initial poll
  lastLedger = await pollEvents(server, contractIds, lastLedger);
  saveEvents();

  // Periodic polling
  const poll = async () => {
    if (!isPolling) return;

    try {
      const newLedger = await pollEvents(server, contractIds, lastLedger);
      if (newLedger > lastLedger) {
        lastLedger = newLedger;
        saveEvents();
      }
    } catch (err) {
      log('error', 'poll_failed', { error: err.message });
    }

    setTimeout(poll, pollIntervalMs);
  };

  setTimeout(poll, pollIntervalMs);
}

/**
 * Stop the indexer
 */
export function stopIndexer() {
  isPolling = false;
  saveEvents();
  log('info', 'indexer_stopped');
}

/**
 * Get events for a specific DAO
 */
export function getEventsForDao(daoId, options = {}) {
  const { limit = 50, offset = 0, types = null } = options;
  const daoEvents = eventStore[String(daoId)] || [];

  let filtered = daoEvents;
  if (types && Array.isArray(types)) {
    filtered = daoEvents.filter(e => types.includes(e.type));
  }

  return {
    events: filtered.slice(offset, offset + limit),
    total: filtered.length,
    daoId,
  };
}

/**
 * Get all indexed DAOs
 */
export function getIndexedDaos() {
  return Object.keys(eventStore).map(id => ({
    daoId: Number(id),
    eventCount: eventStore[id].length,
  }));
}

/**
 * Get indexer status
 */
export function getIndexerStatus() {
  return {
    isRunning: isPolling,
    lastLedger,
    daoCount: Object.keys(eventStore).length,
    totalEvents: Object.values(eventStore).reduce((sum, events) => sum + events.length, 0),
  };
}

/**
 * Manually add an event (useful for testing or manual indexing)
 */
export function addManualEvent(daoId, type, data, ledger = 0) {
  addEvent({
    type,
    daoId: Number(daoId),
    data,
    ledger,
    txHash: 'manual-' + Date.now(),
    timestamp: new Date().toISOString(),
  });
  saveEvents();
}
