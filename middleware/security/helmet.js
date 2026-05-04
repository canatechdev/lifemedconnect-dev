const helmet = require('helmet');

/**
 * Helmet Security Headers Configuration
 * Sets secure HTTP headers to protect against common attacks
 * 
 * Industry Standard Configuration for Healthcare Applications
 */

const helmetConfig = helmet({
    // Content Security Policy (CSP)
    // Prevents XSS by controlling which resources can be loaded
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            scriptSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://*.google.com', 'https://*.gstatic.com'],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://*.google.com', 'https://*.gstatic.com'],
            fontSrc: ["'self'", "data:", 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://*.google.com', 'https://*.gstatic.com'],
            upgradeInsecureRequests: [], // Upgrade HTTP to HTTPS
        },
    },
    
    // HTTP Strict Transport Security (HSTS)
    // Forces HTTPS connections for 1 year
    hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true, // Apply to all subdomains
        preload: true // Allow browser preload list inclusion
    },
    
    // X-Frame-Options
    // Prevents clickjacking attacks
    frameguard: { 
        action: 'deny' // Don't allow site to be framed
    },
    
    // X-Content-Type-Options
    // Prevents MIME type sniffing
    noSniff: true,
    
    // X-XSS-Protection
    // Enables browser's XSS filter
    xssFilter: true,
    
    // Referrer-Policy
    // Controls referrer information
    referrerPolicy: { 
        policy: 'strict-origin-when-cross-origin' 
    },
    
    // Hide X-Powered-By header
    // Don't reveal we're using Express
    hidePoweredBy: true,
    
    // Cross-Origin-Resource-Policy
    // Allow cross-origin requests (needed for frontend)
    crossOriginResourcePolicy: { 
        policy: 'cross-origin' 
    },
    
    // Cross-Origin-Embedder-Policy
    crossOriginEmbedderPolicy: false, // Disabled for compatibility
    
    // Cross-Origin-Opener-Policy
    crossOriginOpenerPolicy: { 
        policy: 'same-origin-allow-popups' 
    },
    
    // Permissions-Policy (formerly Feature-Policy)
    // Disable unnecessary browser features
    permittedCrossDomainPolicies: { 
        permittedPolicies: 'none' 
    }
});

/**
 * Development-friendly Helmet configuration
 * Less strict for local development
 */
const helmetDevConfig = helmet({
    contentSecurityPolicy: false, // Disable CSP in development
    hsts: false, // No HTTPS enforcement in dev
    crossOriginResourcePolicy: false,
});

// Export appropriate config based on environment
module.exports = process.env.NODE_ENV === 'production' 
    ? helmetConfig 
    : helmetDevConfig;
