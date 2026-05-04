const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const { parsePaginationParams } = require('../lib/helpers');
const testRateSchemas = require('../validation/v_test_rates');
const service = require('../services/s_test_rates');

// ===============================
// Test Rates Routes
// ===============================

router.get('/test-rates', verifyToken, asyncHandler(async (req, res) => {
    const { page, limit, search } = parsePaginationParams(req.query);

    const result = await service.listTestRates({ page, limit, search });
    return ApiResponse.paginated(res, result.data, result.pagination);
}));

router.get('/test-rates/clients', verifyToken, asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    const result = await service.getTestClients({
        page,
        limit,
        search,
        sortBy,
        sortOrder
    });
    return ApiResponse.paginated(res, result.data, result.pagination);
}));

// Get test rate by ID
router.get('/test-rates/:id', verifyToken, asyncHandler(async (req, res) => {
    const row = await service.getTestRate(req.params.id);
    if (!row) {
        return ApiResponse.notFound(res, 'Test rate not found');
    }
    return ApiResponse.success(res, row);
}));

// Create new test rate with approval
router.post('/test-rates', verifyToken, requirePermission('test_rates.create'), validateRequest(testRateSchemas.testRateSchema), asyncHandler(async (req, res) => {
    const { createWithApproval } = require('../lib/approvalHelper');
    const result = await createWithApproval({
        entity_type: 'test_rate',
        createFunction: async (data) => {
            return await service.createTestRate(data);
        },
        data: { ...req.body, created_by: req.user.id },
        user: req.user,
        notes: req.body.notes || '',
        priority: req.body.priority || 'medium'
    });
    
    logger.info('Test rate creation requested', { 
        testRateId: result.entity_id || result.ids, 
        createdBy: req.user.id,
        needsApproval: result.needsApproval 
    });
    
    const response = {
        id: result.entity_id || result.ids?.[0],
        needsApproval: result.needsApproval,
        approvalId: result.approvalId
    };
    
    return ApiResponse.success(
        res, 
        response, 
        result.needsApproval ? 'Test rate creation submitted for approval' : 'Test rate created successfully',
        result.needsApproval ? 202 : 201
    );
}));

// Bulk update test rates with approval - groups by client_id
router.put('/test-rates/bulk-update', verifyToken, requirePermission('test_rates.update'), asyncHandler(async (req, res) => {
    const { needsApproval, submitForApproval } = require('../lib/approvalHelper');
    const { rates } = req.body; // Array of {id, ...updateData}
    
    if (!rates || !Array.isArray(rates) || rates.length === 0) {
        return ApiResponse.error(res, 'rates array is required', 400);
    }
    
    // Fetch all current data
    const ids = rates.map(r => r.id);
    const oldRates = [];
    for (const id of ids) {
        const rate = await service.getTestRate(id);
        if (rate) oldRates.push(rate);
    }
    
    // Filter only changed records and group by client_id
    const changedByClient = {};
    for (let i = 0; i < oldRates.length; i++) {
        const oldRate = oldRates[i];
        const newRate = rates.find(r => r.id === oldRate.id);
        
        if (!newRate) continue;
        
        // Check for actual changes - only compare relevant fields
        const fieldsToCompare = ['rate', 'is_active', 'item_name', 'item_code'];
        let hasChanges = false;
        
        for (const key of fieldsToCompare) {
            if (!(key in newRate)) continue;
            
            let oldVal = oldRate[key];
            let newVal = newRate[key];
            
            // Special handling for numeric fields like 'rate'
            if (key === 'rate') {
                oldVal = oldVal === null || oldVal === undefined || oldVal === '' ? null : parseFloat(oldVal);
                newVal = newVal === null || newVal === undefined || newVal === '' ? null : parseFloat(newVal);
                
                if (oldVal !== newVal) {
                    hasChanges = true;
                    break;
                }
            } else {
                // String comparison for other fields
                oldVal = oldVal === null || oldVal === undefined || oldVal === '' ? null : String(oldVal);
                newVal = newVal === null || newVal === undefined || newVal === '' ? null : String(newVal);
                
                if (oldVal !== newVal) {
                    hasChanges = true;
                    break;
                }
            }
        }
        
        if (hasChanges) {
            const clientId = oldRate.client_id;
            if (!changedByClient[clientId]) {
                changedByClient[clientId] = {
                    client_name: oldRate.client_name,
                    old_data: [],
                    new_data: [],
                    ids: []
                };
            }
            changedByClient[clientId].old_data.push(oldRate);
            changedByClient[clientId].new_data.push(newRate);
            changedByClient[clientId].ids.push(oldRate.id);
        }
    }
    
    // If no changes at all, return early
    if (Object.keys(changedByClient).length === 0) {
        return ApiResponse.success(res, {
            updated: 0,
            needsApproval: false,
            skipped: true
        }, 'No changes detected. No approval needed.');
    }
    
    // If user has approval permission, apply changes directly
    if (!needsApproval(req.user.role_id, req.user.permissions)) {
        for (const clientId in changedByClient) {
            const group = changedByClient[clientId];
            for (let i = 0; i < group.ids.length; i++) {
                await service.updateTestRate(group.ids[i], group.new_data[i]);
            }
        }
        return ApiResponse.success(res, {
            updated: Object.values(changedByClient).reduce((sum, g) => sum + g.ids.length, 0),
            needsApproval: false
        }, 'Test rates updated successfully');
    }
    
    // Create ONE approval per client_id
    const approvalIds = [];
    for (const clientId in changedByClient) {
        const group = changedByClient[clientId];
        const result = await submitForApproval({
            entity_type: 'test_rate',
            entity_id: group.ids[0], // First ID as reference
            action_type: 'bulk_update',
            old_data: group.old_data,
            new_data: group.new_data,
            requested_by: req.user.id,
            notes: `Bulk update for ${group.client_name}: ${group.ids.length} test rate(s) changed. ${req.body.notes || ''}`,
            priority: req.body.priority || 'medium'
        });
        approvalIds.push(result.approvalId);
    }
    
    logger.info('Bulk test rates update requested', { 
        totalChanges: Object.values(changedByClient).reduce((sum, g) => sum + g.ids.length, 0),
        clientGroups: Object.keys(changedByClient).length,
        updatedBy: req.user.id
    });
    
    return ApiResponse.success(res, {
        updated: Object.values(changedByClient).reduce((sum, g) => sum + g.ids.length, 0),
        needsApproval: true,
        approvalIds: approvalIds,
        clientGroups: Object.keys(changedByClient).length
    }, `Test rates update submitted for approval (${Object.keys(changedByClient).length} client group(s))`);
}));

// Update test rate with approval
router.put('/test-rates/:id', verifyToken, requirePermission('test_rates.update'), validateRequest(testRateSchemas.testRateUpdateSchema), asyncHandler(async (req, res) => {
    const { updateWithApproval } = require('../lib/approvalHelper');
    const testRateId = parseInt(req.params.id);
    
    const result = await updateWithApproval({
        entity_type: 'test_rate',
        entity_id: testRateId,
        getFunction: async (id) => await service.getTestRate(id),
        updateFunction: async (id, data) => {
            const dataObj = data.toJSON ? data.toJSON() : data;
            const affected = await service.updateTestRate(id, dataObj);
            return affected ? { id, ...dataObj } : null;
        },
        new_data: req.body,
        user: req.user,
        notes: req.body.notes || '',
        priority: req.body.priority || 'medium'
    });
    
    logger.info('Test rate update requested', { 
        testRateId, 
        updatedBy: req.user.id,
        needsApproval: result.needsApproval,
        skipped: result.skipped
    });
    
    const response = {
        updated: result.skipped ? 0 : (result.entity_id ? 1 : 0),
        needsApproval: result.needsApproval,
        approvalId: result.approvalId,
        skipped: result.skipped
    };
    
    return ApiResponse.success(
        res, 
        response, 
        result.skipped ? result.message : (result.needsApproval ? 'Test rate update submitted for approval' : 'Test rate updated successfully')
    );
}));

// Soft delete multiple test rates with approval
router.post('/test-rates/delete', verifyToken, requirePermission('test_rates.delete'), validateRequest(testRateSchemas.deleteTestRatesSchema), asyncHandler(async (req, res) => {
    const { deleteWithApproval } = require('../lib/approvalHelper');
    const ids = req.body.ids;
    
    // Build detailed notes with TPA, insurer, test names and prices
    const rates = [];
    for (const id of ids) {
        const rate = await service.getTestRate(id);
        if (rate) rates.push(rate);
    }
    
    let detailedNotes = req.body.notes || '';
    if (rates.length > 0) {
        const clientName = rates[0].client_name || 'Unknown Client';
        const details = rates.map(r => 
            `${r.item_name} (${r.insurer_name || 'Unknown Insurer'}) - Rate: ₹${r.rate}`
        ).join(', ');
        
        detailedNotes = `Delete ${rates.length} test rate(s) for ${clientName}: ${details}. ${req.body.notes || ''}`;
    }
    
    const result = await deleteWithApproval({
        entity_type: 'test_rate',
        entity_ids: ids,
        getFunction: async (ids) => {
            const rates = [];
            for (const id of ids) {
                const rate = await service.getTestRate(id);
                if (rate) rates.push(rate);
            }
            return rates;
        },
        deleteFunction: async (ids) => {
            return await service.softDeleteTestRate(ids);
        },
        user: req.user,
        notes: detailedNotes,
        priority: req.body.priority || 'medium'
    });
    
    logger.info('Bulk test rates deletion requested', { 
        count: ids.length, 
        deletedBy: req.user.id,
        needsApproval: result.needsApproval 
    });
    
    const response = {
        updated: result.entity_ids ? result.entity_ids.length : 0,
        needsApproval: result.needsApproval,
        approvalId: result.approvalId
    };
    
    return ApiResponse.success(
        res, 
        response, 
        result.needsApproval ? 'Test rates deletion submitted for approval' : 'Test rates deleted successfully'
    );
}));

// Hard delete a test rate with approval
router.delete('/test-rates/:id', verifyToken, requirePermission('test_rates.delete'), asyncHandler(async (req, res) => {
    const { deleteWithApproval } = require('../lib/approvalHelper');
    const testRateId = parseInt(req.params.id);
    
    const result = await deleteWithApproval({
        entity_type: 'test_rate',
        entity_id: testRateId,
        getFunction: async (id) => await service.getTestRate(id),
        deleteFunction: async (id) => {
            const affected = await service.deleteTestRate(id);
            return affected ? { id } : null;
        },
        user: req.user,
        notes: req.body.notes || '',
        priority: req.body.priority || 'medium'
    });
    
    logger.info('Test rate deletion requested', { 
        testRateId, 
        deletedBy: req.user.id,
        needsApproval: result.needsApproval 
    });
    
    const response = {
        deleted: result.entity_id ? 1 : 0,
        needsApproval: result.needsApproval,
        approvalId: result.approvalId
    };
    
    return ApiResponse.success(
        res, 
        response, 
        result.needsApproval ? 'Test rate deletion submitted for approval' : 'Test rate deleted successfully'
    );
}));



// Get test rates for a specific client
router.get('/test-rates/client/:clientId', verifyToken, asyncHandler(async (req, res) => {
    const clientId = parseInt(req.params.clientId);

    if (isNaN(clientId)) {
        return ApiResponse.error(res, 'Invalid client ID', 400);
    }

    const data = await service.getClientTestRates(clientId);
    return ApiResponse.success(res, data);
}));


// Get all available tests
router.get('/test-rates/tests', verifyToken, asyncHandler(async (req, res) => {
    const tests = await service.getTests();
    return ApiResponse.success(res, tests);
}));

// Get combined tests and categories
router.get('/test-rates/items/combined', verifyToken, asyncHandler(async (req, res) => {
    const items = await service.getAvailableItemsCombined();
    return ApiResponse.success(res, items);
}));







module.exports = router;
