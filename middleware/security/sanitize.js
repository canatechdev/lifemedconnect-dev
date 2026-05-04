const xss = require('xss');
const logger = require('../../lib/logger');

/**
 * XSS Sanitization Middleware
 * Cleans all user inputs to prevent script injection attacks
 */

// Sensitive fields to redact from logs (HIPAA/Healthcare compliance)
const SENSITIVE_FIELDS = [
    'password', 
    'password_hash', 
    'token', 
    'secret', 
    'api_key',
    'confirmPassword',
    'new_password',
    'confirm_new_password',
    'aadhaar_number',  // Healthcare: Patient ID
    'pan_number',      // Healthcare: Tax ID
    'ssn',             // Healthcare: Social Security
    'medical_record',  // Healthcare: Medical records
    'diagnosis',       // Healthcare: Diagnosis info
    'prescription'     // Healthcare: Prescription data
];

/**
 * XSS sanitization for strings
 * Strips dangerous HTML/scripts while preserving safe content
 */
const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    return xss(str, {
        whiteList: {}, // No HTML allowed by default
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
    });
};

/**
 * Recursively sanitize objects and arrays
 * Handles nested structures in request data
 */
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    
    // Handle objects
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
};

/**
 * Middleware to sanitize all request inputs
 * Applied globally to clean body, query, and params
 */
const sanitizeInput = (req, res, next) => {
    try {
        if (req.body && Object.keys(req.body).length > 0) {
            req.body = sanitizeObject(req.body);
        }
        if (req.query && Object.keys(req.query).length > 0) {
            req.query = sanitizeObject(req.query);
        }
        if (req.params && Object.keys(req.params).length > 0) {
            req.params = sanitizeObject(req.params);
        }
        next();
    } catch (error) {
        logger.error('Error in sanitizeInput middleware', { 
            error: error.message,
            url: req.originalUrl 
        });
        next(error);
    }
};

/**
 * Filter sensitive data from logs (HIPAA compliance)
 * Redacts passwords, tokens, and healthcare data
 */
const filterSensitiveData = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const filtered = Array.isArray(obj) ? [...obj] : { ...obj };
    
    const redact = (data) => {
        if (!data || typeof data !== 'object') return data;
        
        if (Array.isArray(data)) {
            return data.map(item => redact(item));
        }
        
        const result = { ...data };
        SENSITIVE_FIELDS.forEach(field => {
            if (result[field] !== undefined) {
                result[field] = '[REDACTED]';
            }
        });
        
        // Recursively redact nested objects
        for (const key in result) {
            if (typeof result[key] === 'object' && result[key] !== null) {
                result[key] = redact(result[key]);
            }
        }
        
        return result;
    };
    
    return redact(filtered);
};

/**
 * Sanitize rich text content (for descriptions, notes, etc.)
 * Allows safe HTML tags while blocking dangerous ones
 */
const sanitizeRichText = (html) => {
    if (typeof html !== 'string') return html;
    
    return xss(html, {
        whiteList: {
            // Allow basic formatting
            p: [], br: [], strong: [], em: [], u: [], s: [],
            h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
            ul: [], ol: [], li: [],
            a: ['href', 'title', 'target'],
            // Block dangerous attributes
        },
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
    });
};

module.exports = {
    sanitizeInput,
    sanitizeString,
    sanitizeObject,
    sanitizeRichText,
    filterSensitiveData,
    SENSITIVE_FIELDS
};
