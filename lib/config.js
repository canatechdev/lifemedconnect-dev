/**
 * Configuration management and validation
 */

const requiredEnvVars = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'JWT_SECRET'
];

/**
 * Validate required environment variables
 */
function validateEnv() {
    const missing = [];
    
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            missing.push(envVar);
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}\n` +
            'Please check your .env file.'
        );
    }

    //  NEW: Production security checks
    if (process.env.NODE_ENV === 'production') {
        // Check for default/weak JWT secret
        const weakSecrets = [
            'your-super-secret-jwt-key-change-this-in-production',
            'secret',
            'jwt-secret',
            '12345',
            'test',
            'password'
        ];
        
        const jwtSecret = process.env.JWT_SECRET || '';
        
        if (weakSecrets.includes(jwtSecret) || jwtSecret.length < 32) {
            throw new Error(
                ' CRITICAL SECURITY ERROR: Use a strong JWT_SECRET (min 32 chars) in production!\n' +
                'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
            );
        }
        
        // Check for wildcard CORS
        if (process.env.CORS_ORIGIN === '*') {
            throw new Error(
                ' CRITICAL SECURITY ERROR: Set specific CORS_ORIGIN in production!\n' +
                'Example: CORS_ORIGIN=https://yourdomain.com'
            );
        }
        
        // Warn about HTTPS
        if (!process.env.FORCE_HTTPS) {
            console.warn('  WARNING: FORCE_HTTPS not set. Ensure your reverse proxy handles HTTPS.');
        }
        
        console.log(' Production security validation passed');
    }
}

/**
 * Get configuration object
 */
function getConfig() {
    return {
        // Server
        port: process.env.PORT || 3000,
        nodeEnv: process.env.NODE_ENV || 'development',
        corsOrigin: process.env.CORS_ORIGIN || '*',

        // Database
        database: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            name: process.env.DB_NAME,
            connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10
        },

        // JWT
        jwt: {
            secret: process.env.JWT_SECRET,
            expiresIn: process.env.JWT_EXPIRES_IN || '7d'
        },

        // reCAPTCHA
        recaptcha: {
            secretKey: process.env.RECAPTCHA_SECRET_KEY,
            enabled: process.env.RECAPTCHA_ENABLED === 'true'
        },

        // File Upload
        upload: {
            maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
            allowedImageTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
            allowedDocTypes: ['application/pdf']
        },

        // Logging
        logging: {
            level: process.env.LOG_LEVEL || 'info'
        },

        //  NEW: Security settings
        security: {
            rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 200,
            bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
            sessionSecret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
        },

        // Base URL for file serving
        baseUrl: process.env.BASE_URL || null
    };
}

module.exports = {
    validateEnv,
    getConfig
};
