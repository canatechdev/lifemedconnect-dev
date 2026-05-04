const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../lib/logger');
const ApiResponse = require('../lib/response');
const { asyncHandler }= require('../middleware/errorHandler');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const  validateRequest  = require('../middleware/validateRequest');
const { createWithApproval, updateWithApproval, deleteWithApproval, formatApprovalResponse } = require('../lib/approvalHelper');
const { toMySqlDate } = require('../lib/normalizers');
const { parsePaginationParams } = require('../lib/helpers');
const db = require('../lib/dbconnection');
const { processSingleFile } = require('../lib/fileUpload');
const { mixedUpload } = require('../lib/multer');
const { createClientSchema, updateClientSchema, deleteClientsSchema } = require('../validation/v_clients');
const service = require('../services/s_clients');

//  NEW: Import security middleware
const { uploadLimiter } = require('../middleware/security');

async function processInvoiceFile(file, clientCode = '') {
  if (!file) return null;
  return await processSingleFile(file, 'clients', clientCode);
}

// Helper: Look up client_code for file organization
async function getClientCode(clientId) {
    try {
        const rows = await db.query('SELECT client_code FROM clients WHERE id = ?', [clientId]);
        return rows?.[0]?.client_code || '';
    } catch { return ''; }
}

const uploadSingle = mixedUpload.single('invoice_format_upload');

// GET /clients - List clients with pagination and search
router.get('/clients', verifyToken, asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    const result = await service.listClients({ 
        page, 
        limit, 
        search,
        sortBy,
        sortOrder
    });
    return ApiResponse.paginated(res, result.data, result.pagination);
}));

// GET /clients/:id - Get single client
router.get('/clients/:id', verifyToken, asyncHandler(async (req, res) => {
    const row = await service.getClient(req.params.id);
    if (!row) {
        return ApiResponse.notFound(res, 'Client not found');
    }
    return ApiResponse.success(res, row);
}));

// POST /clients - Create new client
router.post(
  '/clients',
  verifyToken,
  requirePermission('clients.create'),
  uploadLimiter,
  uploadSingle,
  validateRequest(createClientSchema),
  asyncHandler(async (req, res) => {
    logger.info(' [CLIENT-CREATE] Starting client creation', {
      userId: req.user.id,
      hasFile: !!req.file,
      bodyKeys: Object.keys(req.body)
    });

    const invoicePath = await processInvoiceFile(req.file, req.body.client_code || '');

    const clientData = {
      ...req.body,
      ...(req.body.onboarding_date && { onboarding_date: toMySqlDate(req.body.onboarding_date) }),
      ...(req.body.validity_period_start && { validity_period_start: toMySqlDate(req.body.validity_period_start) }),
      ...(req.body.validity_period_end && { validity_period_end: toMySqlDate(req.body.validity_period_end) }),
      invoice_format_upload: invoicePath,
      created_by: req.user.id
    };

    logger.info(' [CLIENT-CREATE] Client data prepared', {
      clientName: clientData.client_name,
      hasInvoice: !!invoicePath,
      insurerIds: clientData.insurer_ids
    });

    const result = await createWithApproval({
      entity_type: 'client',
      createFunction: async (data) => await service.createClient(data),
      data: clientData,
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Client creation request', { 
      clientId: response.id, 
      needsApproval: response.approval_required,
      userId: req.user.id 
    });

    return ApiResponse.success(res, response, response.message, 201);
  })
);

// PUT /clients/:id - Update client
router.put(
  '/clients/:id',
  verifyToken,
  requirePermission('clients.update'),
  uploadLimiter,
  uploadSingle,
  validateRequest(updateClientSchema),
  asyncHandler(async (req, res) => {
    logger.info(' [CLIENT-UPDATE] Starting client update', {
      clientId: req.params.id,
      userId: req.user.id,
      hasFile: !!req.file,
      bodyKeys: Object.keys(req.body)
    });

    delete req.body.client_code; // immutable
    const clientCode = await getClientCode(req.params.id);
    const invoicePath = await processInvoiceFile(req.file, clientCode);

    const updateData = {
      ...req.body,
      ...(req.body.onboarding_date && { onboarding_date: toMySqlDate(req.body.onboarding_date) }),
      ...(req.body.validity_period_start && { validity_period_start: toMySqlDate(req.body.validity_period_start) }),
      ...(req.body.validity_period_end && { validity_period_end: toMySqlDate(req.body.validity_period_end) }),
      // Handle user_id: convert empty string to null for clearing assignment
      ...(req.body.user_id !== undefined && { user_id: req.body.user_id === '' ? null : parseInt(req.body.user_id) || null }),
      invoice_format_upload: invoicePath || req.body.invoice_format_upload,
      updated_by: req.user.id
    };

    logger.info(' [CLIENT-UPDATE] Update data prepared', {
      clientId: req.params.id,
      hasNewInvoice: !!invoicePath,
      insurerIds: updateData.insurer_ids
    });

    const result = await updateWithApproval({
      entity_type: 'client',
      entity_id: parseInt(req.params.id),
      getFunction: async (id) => await service.getClient(id),
      updateFunction: async (id, data) => await service.updateClient(id, data),
      new_data: updateData,
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Client update request', { 
      clientId: req.params.id, 
      needsApproval: response.approval_required,
      userId: req.user.id 
    });

    return ApiResponse.success(res, response, response.message);
  })
);

// POST /clients/delete - Soft delete clients
router.post(
  '/clients/delete',
  verifyToken,
  requirePermission('clients.delete'),
  validateRequest(deleteClientsSchema),
  asyncHandler(async (req, res) => {
    logger.info(' [CLIENT-DELETE] Starting client deletion', {
      userId: req.user.id,
      clientIds: req.body.ids
    });

    const results = [];

    for (const id of req.body.ids) {
      try {
        const result = await deleteWithApproval({
          entity_type: 'client',
          entity_id: id,
          getFunction: async (ids) => {
            // Handle both single ID and array of IDs
            if (Array.isArray(ids)) {
              return await service.getClientsByIds(ids);
            }
            return await service.getClient(ids);
          },
          deleteFunction: async (id) => await service.softDeleteClients([id], req.user.id),
          user: req.user,
          notes: req.body.approval_notes || '',
          priority: req.body.priority || 'high'
        });
        results.push({ id, ...formatApprovalResponse(result) });
      } catch (error) {
        results.push({ id, error: error.message });
      }
    }

    const needsApproval = results.some(r => r.approval_required);
    const message = needsApproval 
      ? 'Delete requests submitted for Super Admin approval'
      : 'Clients deleted successfully';

    logger.info('Clients deletion request', { 
      count: results.length, 
      needsApproval,
      userId: req.user.id 
    });

    return ApiResponse.success(res, { results }, message);
  })
);

// DELETE /clients/:id - Hard delete client (admin only)
router.delete('/clients/:id', verifyToken, requirePermission('clients.delete'), asyncHandler(async (req, res) => {
    const affected = await service.deleteClient(req.params.id);
    if (!affected) {
        return ApiResponse.notFound(res, 'Client not found');
    }

    logger.info('Client deleted', { clientId: req.params.id, deletedBy: req.user.id });
    return ApiResponse.success(res, { deleted: affected }, 'Client deleted successfully');
}));

module.exports = router;
