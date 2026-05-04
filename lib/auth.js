const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const logger = require('./logger');

const SECRET_KEY = process.env.JWT_SECRET; 

const generateToken = (user) => {
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const payload = {
        id: user.id,
        role_id: user.role_id,
        diagnostic_center_id: user.diagnostic_center_id,
        permissions: user.permissions || []  // Include permissions in JWT
    };
    return jwt.sign(payload, SECRET_KEY, { expiresIn });
};



const verifyCaptcha = async (token) => {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify`, null, {
        params: {
            secret,
            response: token,
        },
    });

    return response.data; // { success, score, action, challenge_ts, hostname }
};


const verifyToken = (req, res, next) => {
    // Check token from Authorization header first
    let token = req.headers.authorization && req.headers.authorization.split(' ')[1];
    
    // If no header token, check query parameter (for PDF downloads in new tab)
    if (!token && req.query.token) {
        token = req.query.token;
        // Handle URL-encoded tokens
        if (token && typeof token === 'string') {
            token = decodeURIComponent(token);
        }
    }

    if (!token) {
        return res.status(401).json({ 
            status: 'error',
            message: 'Access Denied: No Token Provided!' 
        });
    }

    try {
        const verified = jwt.verify(token, SECRET_KEY);
        req.user = verified; // { id, role_id, permissions, diagnostic_center_id }
        next();
    } catch (err) {
        logger.warn('Token verification failed', { error: err.message, ip: req.ip });
        res.status(401).json({ 
            status: 'error',
            message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' 
        });
    }
};

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
    return bcrypt.compare(password, hashedPassword);
};

const verifyTokenOptional = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const verified = jwt.verify(token, SECRET_KEY);
        req.user = verified;
        next();
    } catch (err) {
        logger.warn('Optional token verification failed', { error: err.message, ip: req.ip });
        return res.status(401).json({
            status: 'error',
            message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'
        });
    }
};

module.exports = {
    generateToken,
    verifyToken,
    verifyTokenOptional,
    hashPassword,
    comparePassword,
    verifyCaptcha
};
