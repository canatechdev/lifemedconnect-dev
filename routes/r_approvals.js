

/**
 * Approval Routes
 * Handles Super Admin approval workflow endpoints
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const service = require('../services/approvals'); // Updated to use new modular structure
const Joi = require('joi');
const db = require('../lib/dbconnection');

// Validation schemas
const approveRejectSchema = Joi.object({
    rejection_reason: Joi.string().when('action', {
        is: 'reject',
        then: Joi.required(),
        otherwise: Joi.optional()
    })
});

/**
 * GET /approvals/pending
 * Get all pending approvals (Super Admin only)
 */
router.get('/approvals/pending', 
    verifyToken, 
    requirePermission('approvals.view'),
    asyncHandler(async (req, res) => {
        try {
            // console.log('=== APPROVALS/PENDING API CALLED ===');
            // console.log('Query params:', req.query);
            // console.log('User:', req.user);
            
            const { entity_type, priority, limit, offset } = req.query;

            const filters = {
                entity_type,
                priority,
                limit: limit ? parseInt(limit) : 100,
                offset: offset ? parseInt(offset) : 0
            };

            // console.log('Filters being used:', filters);

            const approvals = await service.getPendingApprovals(filters);

            logger.info('Pending approvals fetched', { 
                count: approvals.length, 
                userId: req.user.id 
            });

            return ApiResponse.success(res, approvals, 'Pending approvals retrieved successfully');
        } catch (error) {
            // console.error('Error in approvals/pending:', error);
            logger.error('Error fetching pending approvals', { 
                error: error.message,
                stack: error.stack,
                userId: req.user.id 
            });
            return ApiResponse.error(res, 'Failed to retrieve pending approvals', 500);
        }
    })
);

/**
 * GET /approvals/my-requests
 * Get current user's pending requests
 */
router.get('/approvals/my-requests', 
    verifyToken,
    asyncHandler(async (req, res) => {
        const status = (req.query.status || 'pending').toString();
        const allowed = ['pending','approved','rejected','all'];
        const effective = allowed.includes(status) ? status : 'pending';
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const result = await service.getUserPendingRequests(
            req.user.id, 
            effective, 
            limit, 
            offset
        );

        return ApiResponse.success(
            res, 
            {
                data: result.data,  // This should match your frontend expectations
                pagination: {
                    total: result.total,
                    page,
                    limit,
                    pages: Math.ceil(result.total / limit)
                }
            },
            effective === 'pending' ? 'Your pending requests retrieved successfully' : 'Your requests retrieved successfully'
        );
    })
);

// Add this test route to debug the exact issue
router.get('/approvals/debug-query', asyncHandler(async (req, res) => {
    try {
        console.log('=== DEBUG QUERY TEST ===');
        
        // Test 1: Simple query without parameters
        console.log('Test 1: Simple query without params');
        const result1 = await db.query("SELECT COUNT(*) as count FROM approval_queue WHERE status = 'pending'");
        console.log('Test 1 result:', result1);
        
        // Test 2: Query with one parameter
        console.log('Test 2: Query with one parameter');
        const result2 = await db.query('SELECT COUNT(*) as count FROM approval_queue WHERE status = ?', ['pending']);
        console.log('Test 2 result:', result2);
        
        // Test 3: Query with LIMIT (string interpolation)
        console.log('Test 3: Query with LIMIT (string interpolation)');
        const result3 = await db.query('SELECT id FROM approval_queue LIMIT 5');
        console.log('Test 3 result:', result3);
        
        // Test 4: Query with LIMIT (parameter)
        console.log('Test 4: Query with LIMIT (parameter)');
        try {
            const result4 = await db.query('SELECT id FROM approval_queue LIMIT ?', [5]);
            console.log('Test 4 result:', result4);
        } catch (error) {
            console.log('Test 4 failed:', error.message);
        }
        
        // Test 5: Full query without LIMIT parameters
        console.log('Test 5: Full query without LIMIT parameters');
        const fullQuery = `
            SELECT 
                aq.*,
                u.full_name AS requested_by_name
            FROM approval_queue aq
            LEFT JOIN users u ON aq.requested_by = u.id
            WHERE aq.status = 'pending'
            ORDER BY aq.requested_at ASC
            LIMIT 5
        `;
        const result5 = await db.query(fullQuery);
        console.log('Test 5 result count:', result5.length);

        return res.json({
            success: true,
            tests: {
                test1: result1[0],
                test2: result2[0],
                test3: result3.length,
                test5: result5.length
            }
        });
    } catch (error) {
        console.error('Debug query error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}));

/**
 * GET /approvals/:id
 * Get specific approval details (Super Admin only)
 */
router.get('/approvals/:id', 
    verifyToken, 
    requirePermission('approvals.view'),
    asyncHandler(async (req, res) => {
        const approval = await service.getApprovalById(req.params.id);

        if (!approval) {
            return ApiResponse.notFound(res, 'Approval request not found');
        }

        return ApiResponse.success(res, approval, 'Approval details retrieved successfully');
    })
);

/**
 * POST /approvals/:id/approve
 * Approve a pending request (Super Admin only)
 */
router.post('/approvals/:id/approve', 
    verifyToken, 
    requirePermission('approvals.process'),
    asyncHandler(async (req, res) => {
        const approvalId = parseInt(req.params.id);

        try {
            await service.approveRequest(approvalId, req.user.id);

            logger.info('Approval request approved', { 
                approvalId, 
                approvedBy: req.user.id 
            });

            return ApiResponse.success(
                res, 
                { approvalId }, 
                'Request approved successfully. Changes have been applied.'
            );
        } catch (error) {
            logger.error('Error approving request', { 
                approvalId, 
                error: error.message 
            });
            return ApiResponse.error(res, error.message, 400);
        }
    })
);

/**
 * POST /approvals/:id/reject
 * Reject a pending request (Super Admin only)
 */
router.post('/approvals/:id/reject', 
    verifyToken, 
    requirePermission('approvals.process'),
    asyncHandler(async (req, res) => {
        const approvalId = parseInt(req.params.id);
        const { rejection_reason } = req.body;

        if (!rejection_reason || rejection_reason.trim() === '') {
            return ApiResponse.validationError(res, [
                { message: 'Rejection reason is required', path: ['rejection_reason'] }
            ]);
        }

        try {
            await service.rejectRequest(approvalId, req.user.id, rejection_reason);

            logger.info('Approval request rejected', { 
                approvalId, 
                rejectedBy: req.user.id,
                reason: rejection_reason
            });

            return ApiResponse.success(
                res, 
                { approvalId }, 
                'Request rejected successfully.'
            );
        } catch (error) {
            logger.error('Error rejecting request', { 
                approvalId, 
                error: error.message 
            });
            return ApiResponse.error(res, error.message, 400);
        }
    })
);





/**
 * GET /approvals/stats
 * Get approval statistics (Super Admin only)
 */
router.get('/approvals/stats', 
    verifyToken, 
    requirePermission('approvals.view'),
    asyncHandler(async (req, res) => {
        const stats = await service.getApprovalStats();

        // Transform stats into a more readable format
        const summary = {
            pending: 0,
            approved: 0,
            rejected: 0,
            by_entity: {}
        };

        stats.forEach(stat => {
            summary[stat.status] = (summary[stat.status] || 0) + stat.count;
            
            if (!summary.by_entity[stat.entity_type]) {
                summary.by_entity[stat.entity_type] = {
                    pending: 0,
                    approved: 0,
                    rejected: 0
                };
            }
            summary.by_entity[stat.entity_type][stat.status] = stat.count;
        });

        return ApiResponse.success(res, summary, 'Approval statistics retrieved successfully');
    })
);



/**
 * GET /approvals/dashboard
 * Get approval dashboard data (Super Admin only)
 */
router.get('/approvals/dashboard', 
    verifyToken, 
    requirePermission('approvals.view'),
    asyncHandler(async (req, res) => {
        // Get pending approvals
        const pending = await service.getPendingApprovals({ limit: 50 });
        
        // Get stats
        const stats = await service.getApprovalStats();

        // Transform stats
        const summary = {
            total_pending: 0,
            total_approved: 0,
            total_rejected: 0,
            by_entity: {},
            by_priority: {
                urgent: 0,
                high: 0,
                medium: 0,
                low: 0
            }
        };

        stats.forEach(stat => {
            if (stat.status === 'pending') summary.total_pending += stat.count;
            if (stat.status === 'approved') summary.total_approved += stat.count;
            if (stat.status === 'rejected') summary.total_rejected += stat.count;
            
            if (!summary.by_entity[stat.entity_type]) {
                summary.by_entity[stat.entity_type] = 0;
            }
            if (stat.status === 'pending') {
                summary.by_entity[stat.entity_type] += stat.count;
            }
        });

        // Count by priority
        pending.forEach(item => {
            summary.by_priority[item.priority]++;
        });

        const dashboard = {
            summary,
            recent_pending: pending.slice(0, 10), // Top 10 most recent
            urgent_items: pending.filter(item => item.priority === 'urgent')
        };

        return ApiResponse.success(res, dashboard, 'Dashboard data retrieved successfully');
    })
);

/**
 * POST /approvals/bulk-approve
 * Bulk approve multiple requests (Super Admin only)
 */
router.post('/approvals/bulk-approve', 
    verifyToken, 
    requirePermission('approvals.process'),
    asyncHandler(async (req, res) => {
        const { approval_ids } = req.body;

        if (!Array.isArray(approval_ids) || approval_ids.length === 0) {
            return ApiResponse.validationError(res, [
                { message: 'approval_ids must be a non-empty array', path: ['approval_ids'] }
            ]);
        }

        const results = {
            approved: [],
            failed: []
        };

        for (const approvalId of approval_ids) {
            try {
                await service.approveRequest(approvalId, req.user.id);
                results.approved.push(approvalId);
            } catch (error) {
                results.failed.push({
                    approvalId,
                    error: error.message
                });
            }
        }

        logger.info('Bulk approval completed', { 
            approved: results.approved.length,
            failed: results.failed.length,
            userId: req.user.id
        });

        return ApiResponse.success(
            res, 
            results, 
            `Bulk approval completed. ${results.approved.length} approved, ${results.failed.length} failed.`
        );
    })
);

/**
 * POST /approvals/bulk-reject
 * Bulk reject multiple requests (Super Admin only)
 */
router.post('/approvals/bulk-reject', 
    verifyToken, 
    requirePermission('approvals.process'),
    asyncHandler(async (req, res) => {
        const { approval_ids, rejection_reason } = req.body;

        if (!Array.isArray(approval_ids) || approval_ids.length === 0) {
            return ApiResponse.validationError(res, [
                { message: 'approval_ids must be a non-empty array', path: ['approval_ids'] }
            ]);
        }

        if (!rejection_reason || rejection_reason.trim() === '') {
            return ApiResponse.validationError(res, [
                { message: 'Rejection reason is required', path: ['rejection_reason'] }
            ]);
        }

        const results = {
            rejected: [],
            failed: []
        };

        for (const approvalId of approval_ids) {
            try {
                await service.rejectRequest(approvalId, req.user.id, rejection_reason);
                results.rejected.push(approvalId);
            } catch (error) {
                results.failed.push({
                    approvalId,
                    error: error.message
                });
            }
        }

        logger.info('Bulk rejection completed', { 
            rejected: results.rejected.length,
            failed: results.failed.length,
            userId: req.user.id
        });

        return ApiResponse.success(
            res, 
            results, 
            `Bulk rejection completed. ${results.rejected.length} rejected, ${results.failed.length} failed.`
        );
    })
);

module.exports = router;
