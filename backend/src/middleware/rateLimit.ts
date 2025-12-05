/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting with IP hashing for privacy.
 */

import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

/**
 * Hash an IP address to avoid storing raw IPs
 */
function hashIp(ip: string | undefined): string {
  return crypto.createHash('sha256').update(ip || '').digest('hex');
}

/**
 * Key generator for rate limiters - uses hashed IP
 */
const keyGenerator = (req: Express.Request): string => hashIp((req as any).ip || '');

/**
 * Rate limiter for vote submissions
 * 10 votes per minute per IP
 */
export const voteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many vote requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

/**
 * Rate limiter for general queries
 * 60 requests per minute per IP
 */
export const queryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

/**
 * Rate limiter for IPFS uploads
 * 10 uploads per minute per IP
 */
export const ipfsUploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many upload requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

/**
 * Rate limiter for IPFS reads (more generous, cached content)
 * 200 reads per minute per IP
 */
export const ipfsReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

/**
 * Rate limiter for comment submissions
 * 20 comments per minute per IP
 */
export const commentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many comment requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});
