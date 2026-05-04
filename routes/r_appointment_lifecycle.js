const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const asyncHandler = require('../middleware/errorHandler').asyncHandler;
const ApiResponse = require('../lib/response');
const lifecycleService = require('../services/appointments/AppointmentLifecycleService');
const logger = require('../lib/logger');

/**
 * @route GET /api/appointment-lifecycle/search
 * @desc Search and retrieve complete appointment lifecycle
 * @param {string} q - Search term (case_number, application_number, or appointment ID)
 * @access Private
 */
router.get('/search', verifyToken, requirePermission('appointments.lifecycle'), asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim() === '') {
    return ApiResponse.error(res, 'Search term is required', 400);
  }

  logger.info('Searching appointment lifecycle', { 
    searchTerm: q,
    userId: req.user?.id 
  });

  const lifecycle = await lifecycleService.getAppointmentLifecycle(q.trim(), req.user?.id);

  if (!lifecycle) {
    return ApiResponse.notFound(res, 'Appointment not found');
  }

  logger.info('Appointment lifecycle retrieved', {
    case_number: lifecycle.appointment.case_number,
    timelineEvents: lifecycle.timeline.length
  });

  return ApiResponse.success(res, lifecycle, 'Appointment lifecycle retrieved successfully');
}));

/**
 * @route GET /api/appointment-lifecycle/:id
 * @desc Get appointment lifecycle by ID
 * @param {number} id - Appointment ID
 * @access Private
 */
router.get('/:id', verifyToken, requirePermission('appointments.lifecycle'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  logger.info('Fetching appointment lifecycle by ID', { 
    appointmentId: id,
    userId: req.user?.id 
  });

  const lifecycle = await lifecycleService.getAppointmentLifecycle(id, req.user?.id);

  if (!lifecycle) {
    return ApiResponse.notFound(res, 'Appointment not found');
  }

  return ApiResponse.success(res, lifecycle, 'Appointment lifecycle retrieved successfully');
}));

module.exports = router;
