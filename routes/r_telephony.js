/**
 * Telephony Routes
 * Handles API endpoints for telephony integration
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const logger = require('../lib/logger');
const telephonyService = require('../services/telephony/TelephonyService');
const s_user = require('../services/s_user');
const Joi = require('joi');

/**
 * Validation schemas
 */
const makeCallSchema = Joi.object({
    appointmentId: Joi.number().integer().positive().required(),
    centerId: Joi.number().integer().positive().required(),
    customerNumber: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
    notes: Joi.string().max(500).allow(null, '')
});

const webhookSchema = Joi.object({
    callid: Joi.string().required(),
    'call-type': Joi.string().valid('incoming', 'outgoing').required(),
    disposition: Joi.string().valid('answered', 'missed', 'busy', 'failed', 'no_answer').required(),
    'call-duration': Joi.string().required(),
    'start-time': Joi.string().required(),
    'end-time': Joi.string().required(),
    'agent-number': Joi.string().required(),
    'customer-number': Joi.string().required(),
    'virtual-number': Joi.string().allow(null, ''),
    'service-id': Joi.string().allow(null, ''),
    'recording-url': Joi.string().uri().allow(null, ''),
    'received-by': Joi.string().allow(null, ''),
    'transfered-to': Joi.string().allow(null, ''),
    'handle-time': Joi.string().allow(null, ''),
    'hold-time': Joi.string().allow(null, ''),
    'hangup-by': Joi.string().allow(null, ''),
    'skill-id': Joi.string().allow(null, ''),
    ivr: Joi.string().allow(null, ''),
    param1: Joi.string().allow(null, '')
}).unknown(true); // Allow additional fields

/**
 * @route   POST /api/telephony/make-call
 * @desc    Initiate an outbound call to customer
 * @access  Private - Requires telephony:make_call permission
 */
router.post('/make-call', verifyToken, requirePermission('telephony.make_call'), async (req, res) => {
    try {
        // Validate request body
        const { error, value } = makeCallSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(d => d.message)
            });
        }

        const { appointmentId, centerId, customerNumber, notes } = value;
        const userId = req.user.id;

        // Validate call permission
        const permission = await telephonyService.validateCallPermission(appointmentId, centerId);
        if (!permission.allowed) {
            return res.status(403).json({
                success: false,
                message: permission.reason
            });
        }

        // Get user's telephony credentials
        const user = await s_user.getUserById(userId);
        const userTelephonyUsername = user?.telephony_username || null;
        const userTelephonyPassword = user?.telephony_password || null;

        // Make the call to MOBILE with user credentials
        const result = await telephonyService.makeCallMobile({
            appointmentId,
            centerId,
            customerNumber,
            userId,
            notes,
            userTelephonyUsername,
            userTelephonyPassword
        });

        logger.info('Mobile call initiated via API', {
            userId,
            appointmentId,
            centerId,
            attemptId: result.attemptId
        });

        res.status(200).json(result);

    } catch (error) {
        logger.error('Error in make-call endpoint:', error);
        
        // Handle authentication errors with better status code and message
        if (error.isAuthError) {
            return res.status(401).json({
                success: false,
                message: 'Telephony credentials are invalid. Please contact administrator.',
                error: process.env.NODE_ENV === 'development' ? error.error : undefined
            });
        }
        
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate call',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   POST /api/telephony/make-call-browser
 * @desc    Initiate an outbound call to customer via BROWSER/WebRTC
 * @access  Private - Requires telephony:make_call permission
 */
router.post('/make-call-browser', verifyToken, requirePermission('telephony.make_call'), async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    logger.info('[TELEPHONY ROUTE] BROWSER CALL REQUEST', {
        requestId,
        userId: req.user?.id,
        userEmail: req.user?.email,
        body: req.body,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    try {
        // Validate request body
        const { error, value } = makeCallSchema.validate(req.body);
        if (error) {
            logger.warn('[TELEPHONY ROUTE] Validation failed', {
                requestId,
                errors: error.details.map(d => d.message),
                body: req.body
            });
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(d => d.message)
            });
        }

        const { appointmentId, centerId, customerNumber, notes } = value;
        const userId = req.user.id;

        logger.info('[TELEPHONY ROUTE] Processing browser call', {
            requestId,
            appointmentId,
            centerId,
            customerNumber,
            userId,
            notes
        });

        // Validate call permission
        const permission = await telephonyService.validateCallPermission(appointmentId, centerId);
        if (!permission.allowed) {
            return res.status(403).json({
                success: false,
                message: permission.reason
            });
        }

        // Get user's telephony credentials
        const user = await s_user.getUserById(userId);
        const userTelephonyUsername = user?.telephony_username || null;
        const userTelephonyPassword = user?.telephony_password || null;

        // Make the call to BROWSER/WebRTC with user credentials
        const result = await telephonyService.makeCallBrowser({
            appointmentId,
            centerId,
            customerNumber,
            userId,
            notes,
            userTelephonyUsername,
            userTelephonyPassword
        });

        logger.info('[TELEPHONY ROUTE] BROWSER CALL SUCCESS', {
            requestId,
            userId,
            appointmentId,
            centerId,
            customerNumber,
            attemptId: result.attemptId,
            callId: result.callId,
            responseTime: Date.now()
        });

        res.status(200).json(result);

    } catch (error) {
        logger.error('[TELEPHONY ROUTE] BROWSER CALL FAILED', {
            requestId,
            error: error.message,
            stack: error.stack,
            response: error.response?.data,
            status: error.response?.status,
            userId: req.user?.id,
            body: req.body
        });
        
        // Handle authentication errors with better status code and message
        if (error.isAuthError) {
            return res.status(401).json({
                success: false,
                message: 'Telephony credentials are invalid. Please contact administrator.',
                error: process.env.NODE_ENV === 'development' ? error.error : undefined
            });
        }
        
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate browser call',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/ongoing-calls
 * @desc    Get list of ongoing/active calls
 * @access  Private - Requires telephony:spy_call or telephony:whisper_call permission
 */
router.get('/ongoing-calls', verifyToken, async (req, res) => {
    try {
        const query = require('../lib/dbconnection').query;
        
        // Get active calls from ongoing_calls table
        const calls = await query(
            `SELECT 
                oc.call_id,
                oc.appointment_id,
                oc.center_id,
                oc.agent_number,
                oc.customer_number,
                oc.call_type,
                oc.created_at as start_time,
                oc.created_by,
                a.case_number,
                a.customer_first_name,
                a.customer_last_name,
                c.center_name as center_name,
                u.full_name as agent_name
            FROM ongoing_calls oc
            LEFT JOIN appointments a ON oc.appointment_id = a.id
            LEFT JOIN diagnostic_centers c ON oc.center_id = c.id
            LEFT JOIN users u ON oc.created_by = u.id
            WHERE oc.created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
            ORDER BY oc.created_at DESC
            LIMIT 50`
        );

        res.json({
            success: true,
            data: calls || [],
            count: calls ? calls.length : 0
        });
    } catch (error) {
        logger.error('Error fetching ongoing calls:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ongoing calls',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   POST /api/telephony/spy
 * @desc    Spy on an ongoing call
 * @access  Private - Requires telephony:spy_call permission
 */
router.post('/spy', verifyToken, requirePermission('telephony.spy_call'), async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    logger.info('[TELEPHONY ROUTE] SPY REQUEST', {
        requestId,
        userId: req.user?.id,
        userEmail: req.user?.email,
        body: req.body,
        timestamp: new Date().toISOString()
    });

    try {
        const { callId } = req.body;
        const userId = req.user.id;

        if (!callId) {
            return res.status(400).json({
                success: false,
                message: 'Call ID is required'
            });
        }

        // Get user mobile number from database
        const query = require('../lib/dbconnection').query;
        const users = await query('SELECT mobile FROM users WHERE id = ?', [userId]);
        
        if (!users || users.length === 0 || !users[0].mobile) {
            return res.status(400).json({
                success: false,
                message: 'User mobile number not found. Please update your profile.'
            });
        }

        const agentNumber = users[0].mobile;

        // Get telephony service
        const telephonyService = require('../services/telephony/TelephonyService');

        // Make spy request to SparkTG
        const result = await telephonyService.spyOnCall({ callId, agentNumber });

        res.json({
            success: true,
            message: 'Spy initiated successfully. Call will ring on your mobile.',
            data: result
        });
    } catch (error) {
        logger.error('Error in spy endpoint:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate spy',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   POST /api/telephony/whisper
 * @desc    Whisper during an ongoing call
 * @access  Private - Requires telephony:whisper_call permission
 */
router.post('/whisper', verifyToken, requirePermission('telephony.whisper_call'), async (req, res) => {
    try {
        const { callId } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!callId) {
            return res.status(400).json({
                success: false,
                message: 'Call ID is required'
            });
        }

        // Get user mobile number from database
        const query = require('../lib/dbconnection').query;
        const users = await query('SELECT mobile FROM users WHERE id = ?', [userId]);
        
        if (!users || users.length === 0 || !users[0].mobile) {
            return res.status(400).json({
                success: false,
                message: 'User mobile number not found. Please update your profile.'
            });
        }

        const agentNumber = users[0].mobile;

        // Get telephony service
        const telephonyService = require('../services/telephony/TelephonyService');

        // Make whisper request to SparkTG
        const result = await telephonyService.whisperToCall({ callId, agentNumber });

        res.json({
            success: true,
            message: 'Whisper initiated successfully. Call will ring on your mobile.',
            data: result
        });
    } catch (error) {
        logger.error('Error in whisper endpoint:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate whisper',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   POST /api/telephony/hangup
 * @desc    Hangup/End an ongoing call
 * @access  Private - Requires telephony:make_call permission
 */
router.post('/hangup', verifyToken, requirePermission('telephony.make_call'), async (req, res) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    logger.info('[TELEPHONY ROUTE] HANGUP REQUEST', {
        requestId,
        userId: req.user?.id,
        userEmail: req.user?.email,
        callId: req.body.callId,
        timestamp: new Date().toISOString()
    });

    try {
        const { callId } = req.body;

        if (!callId) {
            logger.warn('[TELEPHONY ROUTE] Hangup missing callId', { requestId, userId: req.user?.id });
            return res.status(400).json({
                success: false,
                message: 'Call ID is required'
            });
        }

        logger.info('[TELEPHONY ROUTE] Processing hangup', { requestId, callId, userId: req.user?.id });

        const result = await telephonyService.hangupCall({ callId });

        logger.info('[TELEPHONY ROUTE] HANGUP SUCCESS', {
            requestId,
            callId,
            userId: req.user?.id,
            apiHangupSuccess: result.apiHangupSuccess,
            result
        });

        // Broadcast call ended event via Socket.IO
        const io = req.app.get('io');
        if (io) {
            logger.debug('[TELEPHONY ROUTE] Broadcasting hangup event', { callId });
            io.emit('call_event', {
                callId,
                eventType: 'CallEnded',
                status: 'ended',
                message: 'Call ended by user',
                userId: req.user?.id
            });
        }

        res.json(result);
    } catch (error) {
        logger.error('[TELEPHONY ROUTE] HANGUP FAILED', {
            requestId,
            error: error.message,
            stack: error.stack,
            userId: req.user?.id,
            callId: req.body.callId
        });
        
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to hangup call',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/call-status/:callId
 * @desc    Get current status of a call
 * @access  Private
 */
router.get('/call-status/:callId', verifyToken, async (req, res) => {
    try {
        const { callId } = req.params;
        const query = require('../lib/dbconnection').query;

        // Check call_events for the latest event (most authoritative source)
        const events = await query(
            `SELECT event_type, created_at FROM call_events 
             WHERE call_id = ? ORDER BY id DESC LIMIT 5`,
            [callId]
        );

        const endEvents = ['CustomerHangup', 'AgentHangup', 'CallDetails'];
        const connectEvents = ['AgentUp', 'CustomerUp'];
        const ringEvents = ['CustomerRing', 'AgentRing'];

        if (events && events.length > 0) {
            const latestEvent = events[0].event_type;
            if (endEvents.includes(latestEvent)) {
                // Call has ended - clean up ongoing_calls
                await query('DELETE FROM ongoing_calls WHERE call_id = ?', [callId]).catch(() => {});
                return res.json({ success: true, status: 'completed', event: latestEvent });
            }
            if (connectEvents.includes(latestEvent)) {
                return res.json({ success: true, status: 'active', event: latestEvent });
            }
            if (ringEvents.includes(latestEvent)) {
                return res.json({ success: true, status: 'ringing', event: latestEvent });
            }
        }

        // Check call_logs for completed calls
        const [callLog] = await query(
            'SELECT id, call_id, disposition, call_duration FROM call_logs WHERE call_id = ?',
            [callId]
        );
        if (callLog) {
            await query('DELETE FROM ongoing_calls WHERE call_id = ?', [callId]).catch(() => {});
            return res.json({ success: true, status: 'completed', data: callLog });
        }

        // Check ongoing_calls
        const [ongoingCall] = await query(
            'SELECT call_id, created_at FROM ongoing_calls WHERE call_id = ?',
            [callId]
        );
        if (ongoingCall) {
            // If older than 2 hours, treat as stale/ended
            const ageMs = Date.now() - new Date(ongoingCall.created_at).getTime();
            if (ageMs > 2 * 60 * 60 * 1000) {
                await query('DELETE FROM ongoing_calls WHERE call_id = ?', [callId]).catch(() => {});
                return res.json({ success: true, status: 'completed', message: 'Stale call cleaned up' });
            }
            return res.json({ success: true, status: 'active', data: ongoingCall });
        }

        // Check call_attempts
        const [attempt] = await query(
            'SELECT attempt_status FROM call_attempts WHERE call_id = ?',
            [callId]
        );
        if (attempt) {
            return res.json({ success: true, status: attempt.attempt_status });
        }

        res.json({ success: true, status: 'unknown' });

    } catch (error) {
        logger.error('Error getting call status:', error);
        res.status(500).json({ success: false, message: 'Failed to get call status' });
    }
});

/**
 * @route   POST /api/telephony/webhook/call-data
 * @desc    Webhook endpoint to receive call data from SparkTG
 * @access  Public (but should be IP restricted in production)
 */
router.post('/webhook/call-data', async (req, res) => {
    try {
        // Validate webhook data
        const { error, value } = webhookSchema.validate(req.body);
        if (error) {
            logger.warn('Invalid webhook data received', {
                errors: error.details.map(d => d.message),
                body: req.body
            });
            return res.status(400).json({
                success: false,
                message: 'Invalid webhook data',
                errors: error.details.map(d => d.message)
            });
        }

        // Optional: IP whitelist check (toggle via env)
        const whitelistEnabled = (process.env.TELEPHONY_WEBHOOK_IP_WHITELIST_ENABLED === 'true');
        const allowedIPs = process.env.TELEPHONY_WEBHOOK_IPS?.split(',') || [];
        if (whitelistEnabled && allowedIPs.length > 0 && !allowedIPs.includes(req.ip)) {
            logger.warn('Webhook request from unauthorized IP', { ip: req.ip });
            return res.status(403).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Process webhook
        const result = await telephonyService.processCallWebhook(value);

        // Respond quickly to telephony system
        res.status(200).json({
            status: 'success',
            callId: value.callid,
            message: 'Webhook received and processed'
        });

    } catch (error) {
        logger.error('Error processing webhook:', error);
        // Still return 200 to prevent retries for processing errors
        res.status(200).json({
            status: 'error',
            message: 'Webhook received but processing failed'
        });
    }
});

/**
 * @route   GET /api/telephony/call-history
 * @desc    Get call history with filters (for dashboard)
 * @access  Private - Requires telephony:view_call_logs permission
 * @status  DISABLED - Dashboard removed, keeping per-appointment endpoint only
 */
// router.get('/call-history', verifyToken, requirePermission('telephony.view_call_logs'), async (req, res) => {
//     try {
//         const { centerId, status, startDate, endDate, page = 1, limit = 50 } = req.query;
//         const query = require('../lib/dbconnection').query;
//         
//         let whereConditions = [];
//         let queryParams = [];
//         
//         // Build WHERE clause
//         if (centerId) {
//             whereConditions.push('ca.center_id = ?');
//             queryParams.push(parseInt(centerId));
//         }
//         
//         if (status && status !== 'all') {
//             whereConditions.push('ca.attempt_status = ?');
//             queryParams.push(status);
//         }
//         
//         if (startDate) {
//             whereConditions.push(`ca.attempted_at >= '${startDate} 00:00:00'`);
//         }
//         
//         if (endDate) {
//             whereConditions.push(`ca.attempted_at <= '${endDate} 23:59:59'`);
//         }
//         
//         const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
//         
//         // Get total count - raw SQL
//         const countQuery = `
//             SELECT COUNT(*) as total
//             FROM call_attempts ca
//             ${whereClause}
//         `;
//         
//         // Debug: Log count query
//         logger.info('Count query:', { countQuery });
//         
//         const [countResult] = await query(countQuery);
//         const total = countResult.total;
//         
//         // Get paginated results - completely raw SQL
//         const offset = (parseInt(page) - 1) * parseInt(limit);
//         const dataQuery = `
//             SELECT 
//                 ca.id,
//                 ca.appointment_id,
//                 ca.center_id,
//                 ca.customer_number,
//                 ca.attempt_type,
//                 ca.attempt_status,
//                 ca.created_at
//             FROM call_attempts ca
//             ${whereClause}
//             ORDER BY ca.attempted_at DESC
//             LIMIT ${Number(limit)} OFFSET ${offset}
//         `;
//         
//         // Debug: Log the query being executed
//         logger.info('Executing raw query:', { dataQuery });
//         
//         const calls = await query(dataQuery);
//         
//         res.status(200).json({
//             success: true,
//             data: calls || [],
//             pagination: {
//                 page: parseInt(page),
//                 limit: parseInt(limit),
//                 total,
//                 totalPages: Math.ceil(total / parseInt(limit))
//             }
//         });
//         
//     } catch (error) {
//         logger.error('Error getting call history:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to retrieve call history',
//             error: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

/**
 * @route   GET /api/telephony/call-history/:appointmentId
 * @desc    Get call history for an appointment
 * @access  Private - Requires telephony:view_call_logs permission
 */
router.get('/call-history/:appointmentId', verifyToken, requirePermission('telephony.view_call_logs'), async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId);

        if (isNaN(appointmentId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid appointment ID'
            });
        }

        const result = await telephonyService.getCallHistory(appointmentId);
        res.status(200).json(result);

    } catch (error) {
        logger.error('Error getting call history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve call history',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/call-attempts/:appointmentId
 * @desc    Get call attempts for an appointment
 * @access  Private - Requires telephony:view_call_logs permission
 */
router.get('/call-attempts/:appointmentId', verifyToken, requirePermission('telephony.view_call_logs'), async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId);

        if (isNaN(appointmentId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid appointment ID'
            });
        }

        const result = await telephonyService.getCallAttempts(appointmentId);
        res.status(200).json(result);

    } catch (error) {
        logger.error('Error getting call attempts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve call attempts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/center-config/:centerId
 * @desc    Get telephony configuration for a center
 * @access  Private - Requires telephony:manage_config permission
 */
router.get('/center-config/:centerId', verifyToken, requirePermission('telephony.manage_config'), async (req, res) => {
    try {
        const centerId = parseInt(req.params.centerId);

        if (isNaN(centerId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid center ID'
            });
        }

        const config = await telephonyService.getCenterTelephonyConfig(centerId);
        
        res.status(200).json({
            success: true,
            data: config
        });

    } catch (error) {
        logger.error('Error getting center config:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to retrieve center configuration',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/validate-permission/:appointmentId/:centerId
 * @desc    Validate if center can make calls for appointment
 * @access  Private
 */
router.get('/validate-permission/:appointmentId/:centerId', verifyToken, async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId);
        const centerId = parseInt(req.params.centerId);

        if (isNaN(appointmentId) || isNaN(centerId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid appointment or center ID'
            });
        }

        const result = await telephonyService.validateCallPermission(appointmentId, centerId);
        
        res.status(200).json({
            success: true,
            ...result
        });

    } catch (error) {
        logger.error('Error validating call permission:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate permission',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/telephony/socket-status
 * @desc    Get SparkTG socket connection status
 * @access  Private
 */
router.get('/socket-status', verifyToken, async (req, res) => {
    try {
        const sparkTGSocketService = require('../services/telephony/SparkTGSocketService');
        const status = sparkTGSocketService.getStatus();
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        logger.error('Error getting socket status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get socket status'
        });
    }
});

/**
 * @route   GET /api/telephony/call-events/:callId
 * @desc    Get call events for a specific call
 * @access  Private
 */
router.get('/call-events/:callId', verifyToken, async (req, res) => {
    try {
        const { callId } = req.params;
        const query = require('../lib/dbconnection').query;
        
        const events = await query(
            `SELECT * FROM call_events WHERE call_id = ? ORDER BY created_at DESC LIMIT 50`,
            [callId]
        );
        
        res.json({
            success: true,
            data: events || []
        });
    } catch (error) {
        logger.error('Error getting call events:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get call events'
        });
    }
});

/**
 * @route   GET /api/telephony/call-events-by-appointment/:appointmentId
 * @desc    Get call events for an appointment
 * @access  Private
 */
router.get('/call-events-by-appointment/:appointmentId', verifyToken, async (req, res) => {
    try {
        const appointmentId = parseInt(req.params.appointmentId);
        
        if (isNaN(appointmentId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid appointment ID'
            });
        }
        
        const query = require('../lib/dbconnection').query;
        
        const events = await query(
            `SELECT ce.* FROM call_events ce
             INNER JOIN call_attempts ca ON ce.call_id = ca.call_id
             WHERE ca.appointment_id = ?
             ORDER BY ce.created_at DESC LIMIT 100`,
            [appointmentId]
        );
        
        res.json({
            success: true,
            data: events || []
        });
    } catch (error) {
        logger.error('Error getting call events by appointment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get call events'
        });
    }
});

/**
 * @route   GET /api/telephony/live-events
 * @desc    Get recent call events for live monitoring
 * @access  Private
 * @status  DISABLED - Dashboard removed, not used elsewhere
 */
// router.get('/live-events', verifyToken, async (req, res) => {
//     try {
//         const { centerId, limit = 50 } = req.query;
//         const query = require('../lib/dbconnection').query;
//         
//         let whereClause = '';
//         let queryParams = [];
//         
//         if (centerId) {
//             whereClause = 'WHERE ce.center_id = ?';
//             queryParams.push(parseInt(centerId));
//         }
//         
//         const events = await query(
//             `SELECT ce.*, 
//                     a.case_number,
//                     CONCAT(a.customer_first_name, ' ', a.customer_last_name) as customer_name,
//                     c.center_name
//              FROM call_events ce
//              LEFT JOIN call_attempts ca ON ce.call_id = ca.call_id
//              LEFT JOIN appointments a ON ca.appointment_id = a.id
//              LEFT JOIN diagnostic_centers c ON ce.center_id = c.id
//              ${whereClause}
//              ORDER BY ce.created_at DESC
//              LIMIT ?`,
//             [...queryParams, parseInt(limit)]
//         );
//         
//         res.json({
//             success: true,
//             data: events || []
//         });
//     } catch (error) {
//         logger.error('Error getting live events:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to get live events'
//         });
//     }
// });

/**
 * @route   GET /api/telephony/active-calls-status
 * @desc    Get real-time status of all active calls
 * @access  Private
 */
router.get('/active-calls-status', verifyToken, async (req, res) => {
    try {
        const query = require('../lib/dbconnection').query;
        
        // Get active calls with their latest event status
        const activeCalls = await query(`
            SELECT 
                oc.call_id,
                oc.appointment_id,
                oc.center_id,
                oc.agent_number,
                oc.customer_number,
                oc.call_type,
                oc.created_at as start_time,
                a.case_number,
                a.customer_first_name,
                a.customer_last_name,
                c.center_name,
                u.full_name as agent_name,
                (
                    SELECT ce.event_type 
                    FROM call_events ce 
                    WHERE ce.call_id = oc.call_id 
                    ORDER BY ce.created_at DESC 
                    LIMIT 1
                ) as latest_event
            FROM ongoing_calls oc
            LEFT JOIN appointments a ON oc.appointment_id = a.id
            LEFT JOIN diagnostic_centers c ON oc.center_id = c.id
            LEFT JOIN users u ON oc.created_by = u.id
            WHERE oc.created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
            ORDER BY oc.created_at DESC
        `);
        
        res.json({
            success: true,
            data: activeCalls || [],
            count: activeCalls?.length || 0
        });
    } catch (error) {
        logger.error('Error getting active calls status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get active calls status'
        });
    }
});

/**
 * @route   GET /api/telephony/webphone-config
 * @desc    Get SparkTG webphone configuration for browser calling
 * @access  Private
 */
router.get('/webphone-config', verifyToken, async (req, res) => {
    const host = process.env.TELEPHONY_SOCKET_HOST || 'telephonycloud.co.in';
    const serviceId = process.env.TELEPHONY_SERVICE_ID;
    const username = process.env.TELEPHONY_USERNAME;
    const password = process.env.TELEPHONY_PASSWORD;
    
    // Build authenticated webphone URL with service credentials
    let webphoneUrl = process.env.TELEPHONY_WEBPHONE_URL;
    
    if (!webphoneUrl && serviceId && username && password) {
        // Construct webphone URL with authentication
        webphoneUrl = `https://${host}/webphone?service_id=${serviceId}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    } else if (!webphoneUrl) {
        // Fallback without auth (may not work)
        webphoneUrl = `https://${host}/webphone`;
    }

    res.json({
        success: true,
        webphoneUrl,
        configured: !!(serviceId && username && password),
        socketEnabled: process.env.TELEPHONY_SOCKET_ENABLED === 'true'
    });
});

module.exports = router;
