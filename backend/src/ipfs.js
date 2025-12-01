/**
 * IPFS/Pinata Integration Module (SDK v2.5.1)
 *
 * Handles pinning and fetching content from IPFS via Pinata.
 * Also propagates content to public IPFS gateways for redundancy.
 */

import { PinataSDK } from "pinata";

let pinata = null;
let gatewayUrl = null;
let isDedicatedGateway = false;

// Public IPFS gateways for propagation and fallback access
const PUBLIC_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://w3s.link/ipfs",
];

// Content size limits (DoS protection)
const MAX_JSON_SIZE = 1024 * 1024; // 1MB for JSON metadata
const MAX_RAW_SIZE = 10 * 1024 * 1024; // 10MB for raw content (images)

// Metadata schema validation
const PROPOSAL_METADATA_SCHEMA = {
  requiredFields: ["version", "body"],
  maxBodyLength: 100000, // 100KB of text
  allowedVersions: [1],
};

const COMMENT_METADATA_SCHEMA = {
  requiredFields: ["version", "body", "createdAt"],
  maxBodyLength: 10000, // 10KB for comments
  allowedVersions: [1],
};

/**
 * Sanitize string content to prevent XSS
 * Removes script tags and event handlers
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== "string") return str;

  // Remove script tags and their content
  let sanitized = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "");
  sanitized = sanitized.replace(/\bon\w+\s*=\s*[^\s>]*/gi, "");

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, "");

  // Remove data: URLs that could contain scripts
  sanitized = sanitized.replace(/data:\s*text\/html/gi, "data:blocked");

  return sanitized;
}

/**
 * Validate metadata against a schema
 * @param {object} data - Data to validate
 * @param {object} schema - Schema to validate against
 * @returns {{valid: boolean, error?: string}}
 */
function validateMetadataSchema(data, schema) {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Metadata must be an object" };
  }

  // Check required fields
  for (const field of schema.requiredFields) {
    if (!(field in data)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate version
  if ("version" in data && !schema.allowedVersions.includes(data.version)) {
    return { valid: false, error: `Invalid version: ${data.version}` };
  }

  // Validate body length
  if ("body" in data) {
    if (typeof data.body !== "string") {
      return { valid: false, error: "Body must be a string" };
    }
    if (data.body.length > schema.maxBodyLength) {
      return { valid: false, error: `Body exceeds maximum length of ${schema.maxBodyLength}` };
    }
  }

  // Validate createdAt format if present
  if ("createdAt" in data && typeof data.createdAt === "string") {
    const date = new Date(data.createdAt);
    if (isNaN(date.getTime())) {
      return { valid: false, error: "Invalid createdAt date format" };
    }
  }

  return { valid: true };
}

/**
 * Sanitize metadata object recursively
 * @param {object} data - Data to sanitize
 * @returns {object} Sanitized data
 */
function sanitizeMetadata(data) {
  if (typeof data === "string") {
    return sanitizeString(data);
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeMetadata);
  }

  if (data && typeof data === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      // Sanitize both keys and values
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeMetadata(value);
    }
    return sanitized;
  }

  return data;
}

/**
 * Initialize the Pinata client (SDK v2.x)
 * @param {string} jwt - Pinata JWT token
 * @param {string} gateway - Optional Pinata gateway URL
 */
export function initPinata(jwt, gateway) {
  if (!jwt) {
    throw new Error("PINATA_JWT is required");
  }

  gatewayUrl = gateway || "https://gateway.pinata.cloud";
  // Dedicated gateways use .mypinata.cloud domain and require signed URLs
  isDedicatedGateway = gatewayUrl.includes(".mypinata.cloud");

  pinata = new PinataSDK({
    pinataJwt: jwt,
    pinataGateway: gatewayUrl
  });

  console.log("Pinata client initialized" + (isDedicatedGateway ? " (dedicated gateway)" : ""));
}

/**
 * Propagate content to public IPFS gateways (fire and forget)
 * This triggers public gateways to fetch and cache the content,
 * ensuring it's accessible even if our Pinata gateway goes down.
 * @param {string} cid - IPFS CID to propagate
 */
async function propagateToPublicGateways(cid) {
  // Fire off requests to public gateways in parallel (don't wait)
  const propagationPromises = PUBLIC_GATEWAYS.map(async (gateway) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(`${gateway}/${cid}`, {
        method: "HEAD", // Just request headers to trigger caching
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        console.log(`[IPFS] Content propagated to ${gateway}/${cid}`);
      }
    } catch (err) {
      // Ignore errors - this is best-effort propagation
      // Gateway might be slow or temporarily unavailable
    }
  });

  // Don't wait for all - just fire and forget
  Promise.allSettled(propagationPromises).then((results) => {
    const successful = results.filter(r => r.status === "fulfilled").length;
    console.log(`[IPFS] Propagation complete: ${successful}/${PUBLIC_GATEWAYS.length} gateways reached for ${cid}`);
  });
}

/**
 * Pin JSON data to public IPFS (SDK v2.x)
 * @param {object} data - JSON data to pin
 * @param {string} name - Optional name for the pin
 * @returns {Promise<{cid: string, size: number, publicUrl: string}>}
 */
export async function pinJSON(data, name = "daovote-metadata") {
  if (!pinata) {
    throw new Error("Pinata client not initialized");
  }

  // SDK v2.x: pinata.upload.public.json() with chainable methods
  const result = await pinata.upload.public.json(data)
    .name(name)
    .keyvalues({
      app: "daovote",
      type: "proposal-metadata"
    });

  // Propagate to public gateways in background
  propagateToPublicGateways(result.cid);

  return {
    cid: result.cid,
    size: result.size || 0,
    publicUrl: `https://ipfs.io/ipfs/${result.cid}`,
  };
}

/**
 * Pin a file (image) to public IPFS (SDK v2.x)
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<{cid: string, size: number, publicUrl: string}>}
 */
export async function pinFile(buffer, filename, mimeType) {
  if (!pinata) {
    throw new Error("Pinata client not initialized");
  }

  // Create a File object from the buffer
  const file = new File([buffer], filename, { type: mimeType });

  // SDK v2.x: pinata.upload.public.file() with chainable methods
  const result = await pinata.upload.public.file(file)
    .name(filename)
    .keyvalues({
      app: "daovote",
      type: "proposal-image"
    });

  // Propagate to public gateways in background
  propagateToPublicGateways(result.cid);

  return {
    cid: result.cid,
    size: result.size || buffer.length,
    publicUrl: `https://ipfs.io/ipfs/${result.cid}`,
  };
}

/**
 * Fetch content from IPFS via Pinata gateway
 * @param {string} cid - IPFS CID
 * @returns {Promise<{data: any, contentType: string}>}
 */
export async function fetchContent(cid) {
  if (!gatewayUrl || !pinata) {
    throw new Error("Pinata client not initialized");
  }

  // Validate CID format
  if (!isValidCid(cid)) {
    throw new Error("Invalid CID format");
  }

  let url;

  if (isDedicatedGateway) {
    // SDK v2.x: Use gateways.private.createAccessLink for dedicated gateways
    try {
      const signedUrl = await pinata.gateways.private.createAccessLink({
        cid: cid,
        expires: 300 // 5 minutes
      });
      url = signedUrl;
    } catch (err) {
      throw new Error(`Failed to create signed URL: ${err.message}`);
    }
  } else {
    // Public gateway - direct URL
    url = `${gatewayUrl}/ipfs/${cid}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "application/json";

  let data;
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return {
    data,
    contentType
  };
}

/**
 * Validate CID format (CIDv0 or CIDv1)
 * @param {string} cid - CID to validate
 * @returns {boolean}
 */
export function isValidCid(cid) {
  if (!cid || typeof cid !== "string") {
    return false;
  }

  // CIDv0: Starts with "Qm" and is 46 characters
  if (cid.startsWith("Qm") && cid.length === 46) {
    return true;
  }

  // CIDv1: Starts with "bafy" (base32) or "bafk" and is variable length
  if ((cid.startsWith("bafy") || cid.startsWith("bafk")) && cid.length >= 50) {
    return true;
  }

  return false;
}

/**
 * Fetch raw content (e.g., image) from IPFS via Pinata gateway
 * Returns the raw buffer and content type for binary data
 * @param {string} cid - IPFS CID
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
export async function fetchRawContent(cid) {
  if (!gatewayUrl || !pinata) {
    throw new Error("Pinata client not initialized");
  }

  // Validate CID format
  if (!isValidCid(cid)) {
    throw new Error("Invalid CID format");
  }

  let url;

  if (isDedicatedGateway) {
    // SDK v2.x: Use gateways.private.createAccessLink for dedicated gateways
    try {
      const signedUrl = await pinata.gateways.private.createAccessLink({
        cid: cid,
        expires: 300 // 5 minutes
      });
      url = signedUrl;
    } catch (err) {
      throw new Error(`Failed to create signed URL: ${err.message}`);
    }
  } else {
    // Public gateway - direct URL
    url = `${gatewayUrl}/ipfs/${cid}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch from IPFS: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    contentType
  };
}

/**
 * Check if Pinata is initialized and healthy (SDK v2.x)
 * @returns {Promise<boolean>}
 */
export async function isHealthy() {
  if (!pinata) {
    return false;
  }

  try {
    // SDK v2.x: Test by listing public files
    await pinata.files.public.list().limit(1);
    return true;
  } catch (error) {
    console.error("Pinata health check failed:", error.message);
    return false;
  }
}

/**
 * Get public gateway URLs for a CID
 * These URLs are accessible without authentication and provide redundancy.
 * @param {string} cid - IPFS CID
 * @returns {{primary: string, fallbacks: string[]}}
 */
export function getPublicUrls(cid) {
  return {
    primary: `https://ipfs.io/ipfs/${cid}`,
    fallbacks: PUBLIC_GATEWAYS.map(gw => `${gw}/${cid}`),
  };
}

/**
 * Manually trigger propagation of a CID to public gateways
 * Use this to ensure older content is propagated.
 * @param {string} cid - IPFS CID to propagate
 */
export function ensurePublicAvailability(cid) {
  if (isValidCid(cid)) {
    propagateToPublicGateways(cid);
  }
}
