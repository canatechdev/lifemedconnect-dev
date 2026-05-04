const logger = require('../lib/logger');
const { filterSensitiveData } = require('./security/sanitize');

/**
 * Request logging middleware with sensitive data filtering
 * Redacts passwords, tokens, and healthcare data from logs (HIPAA compliance)
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();

    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        
        // Filter sensitive data from body
        const safeBody = req.body ? filterSensitiveData(req.body) : undefined;
        
        const logData = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            // Only log body for non-GET requests and if it exists
            ...(safeBody && Object.keys(safeBody).length > 0 && req.method !== 'GET' && { body: safeBody })
        };

        if (res.statusCode >= 400) {
            logger.warn('Request completed with error', logData);
        } else {
            logger.info('Request completed', logData);
        }
    });

    next();
};

module.exports = requestLogger;
