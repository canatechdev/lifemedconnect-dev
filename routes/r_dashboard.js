const express = require('express');
const router = express.Router();
const ApiResponse = require('../lib/response');
const { asyncHandler } = require('../middleware/errorHandler');
const { verifyToken } = require('../lib/auth');
const service = require('../services/s_dashboard');

// GET /dashboard/sidebar-counts - Get pushback count for sidebar
router.get('/dashboard/sidebar-counts', verifyToken, asyncHandler(async (req, res) => {
  const counts = await service.getSidebarCounts(req.user);
  return ApiResponse.success(res, counts, 'Pushback count retrieved successfully');
}));

// GET /dashboard/stats - Get dashboard metrics with month-over-month growth
router.get('/dashboard/stats', verifyToken, asyncHandler(async (req, res) => {
  const stats = await service.getDashboardStats(req.user);
  return ApiResponse.success(res, stats, 'Dashboard stats retrieved successfully');
}));

// GET /dashboard/analytics - Get center/TPA breakdowns with month filter
router.get('/dashboard/analytics', verifyToken, asyncHandler(async (req, res) => {
  const { month } = req.query;
  const analytics = await service.getDashboardAnalytics(req.user, month);
  return ApiResponse.success(res, analytics, 'Dashboard analytics retrieved successfully');
}));

module.exports = router;