/**
 * Security Middleware Index
 * Central export point for all security middleware
 * 
 * Usage:
 * const { loginLimiter, sanitizeInput, csrfProtection } = require('./middleware/security');
 */

const { loginLimiter, apiLimiter, strictLimiter, uploadLimiter } = require('./rateLimiter');
const { cookieParser, csrfProtection, conditionalCsrfProtection, getCsrfToken, csrfErrorHandler } = require('./csrf');
const { sanitizeInput, sanitizeString, sanitizeObject, sanitizeRichText, filterSensitiveData } = require('./sanitize');
const helmetConfig = require('./helmet');

module.exports = {
    // Rate limiting
    loginLimiter,
    apiLimiter,
    strictLimiter,
    uploadLimiter,
    
    // CSRF protection
    cookieParser,
    csrfProtection,
    conditionalCsrfProtection,
    getCsrfToken,
    csrfErrorHandler,
    
    // Input sanitization
    sanitizeInput,
    sanitizeString,
    sanitizeObject,
    sanitizeRichText,
    filterSensitiveData,
    
    // Helmet configuration
    helmetConfig
};
