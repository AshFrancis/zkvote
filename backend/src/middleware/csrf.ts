/**
 * CSRF Protection Middleware
 *
 * Validates Origin header for write requests when CORS is configured.
 * This adds defense-in-depth beyond the auth token.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { log } from '../services/logger.js';

/**
 * CSRF guard middleware
 * Validates Origin header against allowed origins for write operations
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void | Response {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // If CORS is not configured (wildcard), skip origin check
  if (config.corsOrigins === '*') {
    return next();
  }

  // Get origin from headers
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const requestOrigin = origin || (referer ? new URL(referer).origin : null);

  // If no origin header (e.g., curl, server-to-server), require auth token only
  if (!requestOrigin) {
    return next();
  }

  // Validate origin against allowed origins
  const allowedOrigins = Array.isArray(config.corsOrigins) ? config.corsOrigins : [config.corsOrigins];
  if (!allowedOrigins.includes(requestOrigin)) {
    log('warn', 'csrf_origin_mismatch', {
      path: req.path,
      origin: requestOrigin,
      allowed: allowedOrigins
    });
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  next();
}
