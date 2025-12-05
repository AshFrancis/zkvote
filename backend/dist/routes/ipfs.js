/**
 * IPFS Routes
 *
 * Handles IPFS uploads (images, metadata) and content retrieval.
 */
import { Router } from 'express';
import multer from 'multer';
import { config, LIMITS, ALLOWED_IMAGE_MIMES } from '../config.js';
import { log } from '../services/logger.js';
import * as ipfsService from '../services/ipfs.js';
import { queryLimiter, ipfsUploadLimiter, ipfsReadLimiter } from '../middleware/index.js';
const router = Router();
// ============================================
// MULTER CONFIGURATION (FILE UPLOADS)
// ============================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: LIMITS.MAX_IMAGE_SIZE,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        log('info', 'upload_file_filter', { mimetype: file.mimetype, originalname: file.originalname });
        if (ALLOWED_IMAGE_MIMES.includes(file.mimetype) || file.mimetype?.startsWith('image/')) {
            cb(null, true);
        }
        else {
            const err = new Error(`Unsupported file type: ${file.mimetype || 'unknown'}. Allowed: JPEG, PNG, GIF, WebP, AVIF, HEIC.`);
            err.code = 'INVALID_FILE_TYPE';
            cb(err);
        }
    },
});
const ipfsCache = new Map();
function getCachedContent(cid) {
    const cached = ipfsCache.get(cid);
    if (cached && Date.now() - cached.timestamp < LIMITS.IPFS_CACHE_TTL) {
        return cached.data;
    }
    ipfsCache.delete(cid);
    return null;
}
function setCachedContent(cid, data) {
    ipfsCache.set(cid, { data, timestamp: Date.now() });
    // Clean up old entries periodically
    if (ipfsCache.size > 1000) {
        const now = Date.now();
        for (const [key, value] of ipfsCache) {
            if (now - value.timestamp > LIMITS.IPFS_CACHE_TTL) {
                ipfsCache.delete(key);
            }
        }
    }
}
// ============================================
// ROUTES
// ============================================
/**
 * GET /ipfs/health - IPFS health check
 */
router.get('/ipfs/health', queryLimiter, (async (req, res) => {
    if (!config.ipfsEnabled) {
        return res.json({ enabled: false, status: 'not_configured' });
    }
    try {
        const healthy = await ipfsService.isHealthy();
        res.json({
            enabled: true,
            status: healthy ? 'healthy' : 'degraded',
        });
    }
    catch (err) {
        res.json({
            enabled: true,
            status: 'error',
            error: err.message,
        });
    }
}));
/**
 * POST /ipfs/image - Upload image to IPFS
 */
router.post('/ipfs/image', ipfsUploadLimiter, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
            }
            if (err.code === 'INVALID_FILE_TYPE' || err.message?.includes('file type')) {
                return res.status(400).json({ error: err.message });
            }
            log('error', 'multer_error', { code: err.code, message: err.message });
            return res.status(400).json({ error: err.message || 'File upload failed' });
        }
        next();
    });
}, (async (req, res) => {
    if (!config.ipfsEnabled) {
        return res.status(503).json({ error: 'IPFS service not configured' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }
    try {
        log('info', 'ipfs_upload_image', {
            filename: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
        });
        const result = await ipfsService.pinFile(req.file.buffer, req.file.originalname, req.file.mimetype);
        log('info', 'ipfs_upload_success', { cid: result.cid, type: 'image' });
        res.json({
            cid: result.cid,
            size: result.size,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
        });
    }
    catch (err) {
        log('error', 'ipfs_upload_failed', { error: err.message, type: 'image' });
        res.status(500).json({ error: 'Failed to upload image to IPFS' });
    }
}));
/**
 * POST /ipfs/metadata - Upload JSON metadata to IPFS
 */
router.post('/ipfs/metadata', ipfsUploadLimiter, (async (req, res) => {
    if (!config.ipfsEnabled) {
        return res.status(503).json({ error: 'IPFS service not configured' });
    }
    const metadata = req.body;
    const metadataSize = JSON.stringify(metadata).length;
    if (metadataSize > LIMITS.MAX_METADATA_SIZE) {
        return res.status(400).json({
            error: `Metadata too large: ${metadataSize} bytes (max ${LIMITS.MAX_METADATA_SIZE})`,
        });
    }
    if (!metadata.version || typeof metadata.version !== 'number') {
        return res.status(400).json({ error: 'metadata.version is required and must be a number' });
    }
    if (metadata.videoUrl) {
        const videoPattern = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/.+$/i;
        if (!videoPattern.test(metadata.videoUrl)) {
            return res.status(400).json({
                error: 'Invalid video URL. Only YouTube and Vimeo URLs are allowed.',
            });
        }
    }
    try {
        // Sanitize metadata to prevent XSS attacks
        const sanitizedMetadata = ipfsService.sanitizeMetadata(metadata);
        log('info', 'ipfs_upload_metadata', { size: metadataSize });
        const result = await ipfsService.pinJSON(sanitizedMetadata, 'zkvote-proposal-metadata');
        log('info', 'ipfs_upload_success', { cid: result.cid, type: 'metadata' });
        res.json({
            cid: result.cid,
            size: result.size,
        });
    }
    catch (err) {
        log('error', 'ipfs_upload_failed', { error: err.message, type: 'metadata' });
        res.status(500).json({ error: 'Failed to upload metadata to IPFS' });
    }
}));
/**
 * GET /ipfs/:cid - Fetch content from IPFS (JSON)
 */
router.get('/ipfs/:cid', ipfsReadLimiter, (async (req, res) => {
    if (!config.ipfsEnabled) {
        return res.status(503).json({ error: 'IPFS service not configured' });
    }
    const { cid } = req.params;
    if (!ipfsService.isValidCid(cid)) {
        return res.status(400).json({ error: 'Invalid CID format' });
    }
    const cached = getCachedContent(cid);
    if (cached) {
        log('info', 'ipfs_cache_hit', { cid });
        return res.json(cached);
    }
    try {
        log('info', 'ipfs_fetch', { cid });
        const result = await ipfsService.fetchContent(cid);
        setCachedContent(cid, result.data);
        log('info', 'ipfs_fetch_success', { cid });
        if (typeof result.data === 'object') {
            res.json(result.data);
        }
        else {
            res.json({ content: result.data, contentType: result.contentType });
        }
    }
    catch (err) {
        log('error', 'ipfs_fetch_failed', { cid, error: err.message });
        res.status(500).json({ error: 'Failed to fetch content from IPFS' });
    }
}));
/**
 * GET /ipfs/image/:cid - Fetch raw image from IPFS
 */
router.get('/ipfs/image/:cid', ipfsReadLimiter, (async (req, res) => {
    if (!config.ipfsEnabled) {
        return res.status(503).json({ error: 'IPFS service not configured' });
    }
    const { cid } = req.params;
    if (!ipfsService.isValidCid(cid)) {
        return res.status(400).json({ error: 'Invalid CID format' });
    }
    try {
        log('info', 'ipfs_fetch_image', { cid });
        const result = await ipfsService.fetchRawContent(cid);
        log('info', 'ipfs_fetch_image_success', { cid, contentType: result.contentType });
        res.set('Content-Type', result.contentType);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        res.send(result.buffer);
    }
    catch (err) {
        log('error', 'ipfs_fetch_image_failed', { cid, error: err.message });
        res.status(500).json({ error: 'Failed to fetch image from IPFS' });
    }
}));
export default router;
//# sourceMappingURL=ipfs.js.map