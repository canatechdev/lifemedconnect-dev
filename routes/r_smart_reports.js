/**
 * Smart Reports Routes
 * Handles API endpoints for HealthVectors Smart Report integration
 * 
 * This module is self-contained and can be safely enabled/disabled
 * via SMART_REPORT_ENABLED env variable without impacting other modules.
 * 
 * Routes:
 *   POST /api/smart-reports/request/:appointmentId  - Request smart report generation (authenticated)
 *   GET  /api/smart-reports/status/:appointmentId   - Get smart report status (authenticated)
 *   POST /api/smart-reports/webhook/callback         - Webhook callback from HealthVectors (public)
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const smartReportService = require('../services/smart-reports/SmartReportService');

/**
 * Middleware to check if Smart Reports feature is enabled
 */
const checkSmartReportEnabled = (req, res, next) => {
    if (process.env.SMART_REPORT_ENABLED !== 'true') {
        return ApiResponse.error(res, 'Smart Report feature is disabled', 403);
    }
    next();
};

/**
 * @route   POST /api/smart-reports/request/:appointmentId
 * @desc    Request Smart Report generation for an appointment
 * @access  Private - Requires appointments.view permission
 */
router.post('/request/:appointmentId',
    verifyToken,
    requirePermission('appointments.view'),
    checkSmartReportEnabled,
    async (req, res) => {
        try {
            const appointmentId = parseInt(req.params.appointmentId);
            if (isNaN(appointmentId)) {
                return ApiResponse.error(res, 'Invalid appointment ID', 400);
            }

            const result = await smartReportService.requestSmartReport(appointmentId);

            if (!result.success) {
                return ApiResponse.error(res, result.message, result.statusCode || 500);
            }

            return ApiResponse.success(res, result);
        } catch (error) {
            logger.error('Error requesting smart report', { error: error.message });
            return ApiResponse.error(res, 'Failed to request Smart Report', 500);
        }
    }
);

/**
 * @route   GET /api/smart-reports/status/:appointmentId
 * @desc    Get Smart Report status for an appointment
 * @access  Private - Requires appointments.view permission
 */
router.get('/status/:appointmentId',
    verifyToken,
    requirePermission('appointments.view'),
    checkSmartReportEnabled,
    async (req, res) => {
        try {
            const appointmentId = parseInt(req.params.appointmentId);
            if (isNaN(appointmentId)) {
                return ApiResponse.error(res, 'Invalid appointment ID', 400);
            }

            const result = await smartReportService.getSmartReportStatus(appointmentId);

            if (!result.success) {
                return ApiResponse.error(res, result.message, result.statusCode || 500);
            }

            return ApiResponse.success(res, result);
        } catch (error) {
            logger.error('Error fetching smart report status', { error: error.message });
            return ApiResponse.error(res, 'Failed to fetch Smart Report status', 500);
        }
    }
);

/**
 * @route   POST /api/smart-reports/webhook/callback
 * @desc    Webhook callback from HealthVectors to receive generated Smart Report (base64 PDF)
 * @access  Public (external service callback - no auth token required)
 * 
 * NOTE: This endpoint is called by HealthVectors servers, NOT by our frontend.
 * Similar pattern to telephony webhook (/api/telephony/webhook/call-data).
 */
router.post('/webhook/callback', async (req, res) => {
    try {
        // Feature check
        if (process.env.SMART_REPORT_ENABLED !== 'true') {
            logger.warn('Smart Report webhook received but feature is disabled');
            return res.status(200).json({ success: true, message: 'Acknowledged (feature disabled)' });
        }

        // Optional: API key validation for webhook security
        const webhookSecret = process.env.SMART_REPORT_WEBHOOK_SECRET;
        if (webhookSecret) {
            const providedSecret = req.headers['x-api-key'] || req.headers['x-webhook-secret'] || req.query.secret;
            if (providedSecret !== webhookSecret) {
                logger.warn('Smart Report webhook - invalid secret', { ip: req.ip });
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
        }

        logger.info('Smart Report webhook callback received', {
            ip: req.ip,
            bodyKeys: Object.keys(req.body),
            patientId: req.body.PatientID || req.body.patientId
        });

        // Process the callback
        const result = await smartReportService.processWebhookCallback(req.body);

        // Always respond 200 to external webhook to prevent retries
        return res.status(200).json({
            success: result.success,
            message: result.message || 'Webhook processed'
        });

    } catch (error) {
        logger.error('Error processing Smart Report webhook', { error: error.message });
        // Still return 200 to prevent retries
        return res.status(200).json({
            success: false,
            message: 'Webhook received but processing failed'
        });
    }
});

module.exports = router;
