/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting with IP hashing for privacy.
 */
/**
 * Rate limiter for vote submissions
 * 10 votes per minute per IP
 */
export declare const voteLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Rate limiter for general queries
 * 60 requests per minute per IP
 */
export declare const queryLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Rate limiter for IPFS uploads
 * 10 uploads per minute per IP
 */
export declare const ipfsUploadLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Rate limiter for IPFS reads (more generous, cached content)
 * 200 reads per minute per IP
 */
export declare const ipfsReadLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Rate limiter for comment submissions
 * 20 comments per minute per IP
 */
export declare const commentLimiter: import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rateLimit.d.ts.map