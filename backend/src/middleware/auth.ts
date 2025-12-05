/**
 * Authentication Middleware
 *
 * Provides auth token verification for write endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { log } from '../services/logger.js';

/**
 * Extract auth token from request headers
 */
export function extractAuthToken(req: Request): string | undefined {
  const header = req.headers['x-relayer-auth'] || req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  return header as string | undefined;
}

/**
 * Authentication guard for write endpoints
 * Requires RELAYER_AUTH_TOKEN to be set and match
 */
export function authGuard(req: Request, res: Response, next: NextFunction): void | Response {
  const token = extractAuthToken(req);

  if (token !== config.relayerAuthToken) {
    log('warn', 'auth_failed', { path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
