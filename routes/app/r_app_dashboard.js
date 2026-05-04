/**
 * App (Technician) Dashboard Routes
 */

const express = require('express');
const router = express.Router();

const { verifyToken } = require('../../lib/auth');
const ApiResponse = require('../../lib/response');
const logger = require('../../lib/logger');
const { getTechnicianDashboardCounts, getTechnicianStats } = require('../../services/app/s_app_dashboard');

// GET /api/app/dashboard/counts
router.get('/dashboard/counts', verifyToken, async (req, res) => {
    try {
        const counts = await getTechnicianDashboardCounts(req.user.id);
        return ApiResponse.appSuccess(res, 'Dashboard counts fetched', counts);
    } catch (error) {
        logger.error('App dashboard counts failed', { error: error.message, userId: req.user?.id });
        return ApiResponse.appError(res, 'Failed to fetch dashboard counts', 500);
    }
});

// GET /api/app/dashboard/stats
router.get('/dashboard/stats', verifyToken, async (req, res) => {
    try {
        const stats = await getTechnicianStats(req.user.id);
        return ApiResponse.appSuccess(res, 'Technician stats fetched', stats);
    } catch (error) {
        logger.error('App technician stats failed', { error: error.message, userId: req.user?.id });
        return ApiResponse.appError(res, 'Failed to fetch technician stats', 500);
    }
});

module.exports = router;
