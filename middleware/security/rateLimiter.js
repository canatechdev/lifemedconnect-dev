const rateLimit = require('express-rate-limit');
const logger = require('../../lib/logger');

/**
 * Rate Limiting Middleware
 * Protects against brute force and DDoS attacks
 * 
 * LESS STRICT CONFIGURATION 
 */

// Login rate limiter - Moderate 
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // max: 10, // 10 attempts (increased from 5)
    max: 10000, // for now
    message: { 
        status: 'error', 
        message: 'Too many login attempts from this IP. Please try again after 15 minutes.' 
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    skipSuccessfulRequests: true, // Don't count successful logins
    handler: (req, res) => {
        logger.warn('Login rate limit exceeded', { 
            ip: req.ip, 
            url: req.originalUrl 
        });
        res.status(429).json({
            status: 'error',
            message: 'Too many login attempts. Please try again after 15 minutes.'
        });
    }
});

// General API limiter - Lenient (200 requests per 15 min)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // max: 200, // 200 requests (increased from 100)
    max: 20000, // for now
    message: { 
        status: 'error', 
        message: 'Too many requests from this IP. Please slow down.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('API rate limit exceeded', { 
            ip: req.ip, 
            url: req.originalUrl 
        });
        res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please try again later.'
        });
    }
});

// Strict limiter for sensitive operations (20 per hour)
const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    // max: 20, // 20 attempts (increased from 10)
    max: 20000, // 20 attempts (increased from 10)
    message: { 
        status: 'error', 
        message: 'Too many attempts for this operation. Please try again after 1 hour.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('Strict rate limit exceeded', { 
            ip: req.ip, 
            url: req.originalUrl,
            user: req.user?.id 
        });
        res.status(429).json({
            status: 'error',
            message: 'Too many attempts. Please try again after 1 hour.'
        });
    }
});

// File upload limiter (30 per 15 min)
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // max: 30, // 30 uploads (increased from 20)
     max: 30000, // for now
    message: { 
        status: 'error', 
        message: 'Too many file uploads. Please try again later.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('Upload rate limit exceeded', { 
            ip: req.ip, 
            url: req.originalUrl,
            user: req.user?.id 
        });
        res.status(429).json({
            status: 'error',
            message: 'Too many upload requests. Please try again later.'
        });
    }
});

module.exports = {
    loginLimiter,
    apiLimiter,
    strictLimiter,
    uploadLimiter
};
