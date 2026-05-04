/**
 * Display Builder
 * Builds display-friendly change information for approval UI
 */

const db = require('../../../lib/dbconnection');
const { areValuesEqual, isEmptyLike } = require('./changeDetector');
const { createFieldResolver, getTestNamesByIds, enrichNotesWithIdentifiers } = require('./displayEnricher');
const { shouldIgnoreField } = require('../config/entityConfig');

const parseSelectedItems = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
};

/**
 * Build display changes for approval modal
 * @param {Object} approval - Approval object
 * @returns {Promise<Array>} Array of change objects
 */
const buildDisplayChanges = async (approval) => {
    const changes = [];
    const oldData = approval.old_data || {};
    const newData = approval.new_data || {};

    // Special handling for test_rate_import bulk_create
    if (approval.entity_type === 'test_rate_import' && approval.action_type === 'bulk_create' &&
        Array.isArray(newData)) {

        for (let i = 0; i < newData.length; i++) {
            const record = newData[i];
            const tpaName = record.tpa_name || record.client_name || '';
            const insurerName = record.insurer_name || '';

            const parts = [];
            parts.push(`Rate: ₹${record.rate}`);
            if (tpaName) parts.push(`TPA: ${tpaName}`);
            if (insurerName) parts.push(`Insurer: ${insurerName}`);
            parts.push(record.description || 'No description');

            changes.push({
                field: `${record.item_type === 'test' ? 'Test' : 'Category'}: ${record.item_name}`,
                oldValue: null,
                newValue: parts.join(' | '),
                type: 'text'
            });
        }

        return changes;
    }

    // Special handling for bulk test_rate updates
    if (approval.entity_type === 'test_rate' && approval.action_type === 'bulk_update' &&
        Array.isArray(oldData) && Array.isArray(newData)) {

        // Get insurer names for all unique insurer_ids
        const insurerIds = [...new Set(oldData.map(r => r.insurer_id).filter(Boolean))];
        const insurerMap = {};
        if (insurerIds.length > 0) {
            const placeholders = insurerIds.map(() => '?').join(',');
            const insurers = await db.query(`SELECT id, insurer_name FROM insurers WHERE id IN (${placeholders})`, insurerIds);
            insurers.forEach(ins => insurerMap[ins.id] = ins.insurer_name);
        }

        // Build display for each test rate
        for (let i = 0; i < oldData.length; i++) {
            const old = oldData[i];
            const newItem = newData[i];
            const insurerName = insurerMap[old.insurer_id] || 'Unknown Insurer';

            // Find what changed
            const itemChanges = [];
            for (const key in newItem) {
                if (key === 'id' || key === 'client_id' || key === 'test_id' || key === 'insurer_id' ||
                    key === 'item_name' || key === 'item_type' || key === 'item_code' || key === 'category_id') continue;

                const oldVal = old[key] === null || old[key] === undefined || old[key] === '' ? null : String(old[key]);
                const newVal = newItem[key] === null || newItem[key] === undefined || newItem[key] === '' ? null : String(newItem[key]);

                if (oldVal !== newVal) {
                    itemChanges.push(`${key}: ${oldVal} → ${newVal}`);
                }
            }

            if (itemChanges.length > 0) {
                changes.push({
                    field: `${old.item_name} (${insurerName})`,
                    oldValue: itemChanges.map(c => c.split(' → ')[0].split(': ')[1]).join(', '),
                    newValue: itemChanges.map(c => c.split(' → ')[1]).join(', '),
                    type: 'test_rate_bulk',
                    details: itemChanges.join('; ')
                });
            }
        }

        return changes;
    }

    // Standard single-record change detection
    const fields = new Set(Object.keys(newData));
    const resolver = createFieldResolver(approval.entity_type);
    
    // Computed fields that should not appear in change display
    // Keep amount visible for approvals (it's not a computed field for appointments)
    // Note: selected_items is handled specially below, not skipped
    const COMPUTED_FIELDS = new Set(['total_amount', 'test_ids']);

    for (const field of fields) {
        if (shouldIgnoreField(field)) continue;
        if (COMPUTED_FIELDS.has(field)) continue; // Skip computed fields
        
        let oldVal = oldData[field];
        let newVal = newData[field];

        // Special handling for selected_items: parse stringified JSON and always show enriched assignments
        if (field === 'selected_items') {
            const parsedOld = parseSelectedItems(oldVal);
            const parsedNew = parseSelectedItems(newVal);

            if (parsedOld.length === 0 && parsedNew.length === 0) continue;

            // Collect all unique center IDs and technician IDs
            const centerIds = [...new Set(parsedNew.map(item => item.assigned_center_id).filter(Boolean))];
            const technicianIds = [...new Set(parsedNew.map(item => item.assigned_technician_id).filter(Boolean))];

            const centerMap = {};
            if (centerIds.length > 0) {
                const placeholders = centerIds.map(() => '?').join(',');
                const centers = await db.query(`SELECT id, center_name FROM diagnostic_centers WHERE id IN (${placeholders})`, centerIds);
                centers.forEach(center => centerMap[center.id] = center.center_name);
            }

            const technicianMap = {};
            if (technicianIds.length > 0) {
                const placeholders = technicianIds.map(() => '?').join(',');
                const technicians = await db.query(`SELECT id, full_name FROM technicians WHERE id IN (${placeholders})`, technicianIds);
                technicians.forEach(tech => technicianMap[tech.id] = tech.full_name);
            }

            const describe = (items) => items.map(item => {
                const parts = [`${item.name} (${item.type})`];
                if (item.assigned_center_id) parts.push(`Center: ${centerMap[item.assigned_center_id] || item.assigned_center_id}`);
                if (item.assigned_technician_id) parts.push(`Technician: ${technicianMap[item.assigned_technician_id] || item.assigned_technician_id}`);
                if (item.visit_subtype) parts.push(`Visit: ${item.visit_subtype}`);
                return parts.join(' | ');
            });

            changes.push({
                field: 'Selected Tests & Assignments',
                oldValue: parsedOld.length ? describe(parsedOld) : null,
                newValue: describe(parsedNew),
                type: 'selected_items'
            });

            continue;
        }

        if (areValuesEqual(oldVal, newVal, field, { oldData, newData })) continue;
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

        // Special handling for test_ids: convert IDs to test names
        if (field === 'test_ids' && Array.isArray(newVal)) {
            const tests = await getTestNamesByIds(newVal);
            const testMap = Object.fromEntries(tests.map(t => [t.id, t.test_name]));

            const oldNames = Array.isArray(oldVal)
                ? oldVal.map(id => testMap[id] || id)
                : null;

            const newNames = newVal.map(id => testMap[id] || id);

            changes.push({
                field,
                oldValue: oldNames && oldNames.length > 0 ? oldNames : null,
                newValue: newNames,
                type: 'text'
            });

            continue;
        }

        // Special handling for selected_items: enrich with center and technician names
        if (field === 'selected_items' && Array.isArray(newVal)) {
            // Collect all unique center IDs and technician IDs
            const centerIds = [...new Set(newVal.map(item => item.assigned_center_id).filter(Boolean))];
            const technicianIds = [...new Set(newVal.map(item => item.assigned_technician_id).filter(Boolean))];

            // Fetch center names
            const centerMap = {};
            if (centerIds.length > 0) {
                const placeholders = centerIds.map(() => '?').join(',');
                const centers = await db.query(`SELECT id, center_name FROM diagnostic_centers WHERE id IN (${placeholders})`, centerIds);
                centers.forEach(center => centerMap[center.id] = center.center_name);
            }

            // Fetch technician names
            const technicianMap = {};
            if (technicianIds.length > 0) {
                const placeholders = technicianIds.map(() => '?').join(',');
                const technicians = await db.query(`SELECT id, full_name FROM technicians WHERE id IN (${placeholders})`, technicianIds);
                technicians.forEach(tech => technicianMap[tech.id] = tech.full_name);
            }

            // Enrich items with names
            const enrichedItems = newVal.map(item => ({
                ...item,
                assigned_center_name: item.assigned_center_id ? centerMap[item.assigned_center_id] || `Center ${item.assigned_center_id}` : null,
                assigned_technician_name: item.assigned_technician_id ? technicianMap[item.assigned_technician_id] || `Technician ${item.assigned_technician_id}` : null
            }));

            changes.push({
                field: 'Selected Tests & Assignments',
                oldValue: Array.isArray(oldVal) && oldVal.length > 0 ? `${oldVal.length} test(s)` : null,
                newValue: enrichedItems.map(item => {
                    const parts = [`${item.name} (${item.type})`];
                    if (item.assigned_center_name) parts.push(`Center: ${item.assigned_center_name}`);
                    if (item.assigned_technician_name) parts.push(`Technician: ${item.assigned_technician_name}`);
                    if (item.visit_subtype) parts.push(`Visit: ${item.visit_subtype}`);
                    return parts.join(' | ');
                }),
                type: 'selected_items'
            });

            continue;
        }

        // Special handling for friendly field names
        let displayField = field;
        if (field === 'reschedule_reason') {
            displayField = 'Reschedule Remarks';
        } else if (field === 'medical_remarks') {
            displayField = 'Medical Remarks';
        } else if (field === 'aadhaar_number') {
            displayField = 'Aadhaar Number';
        } else if (field === 'pan_number') {
            displayField = 'PAN Number';
        }
        
        const [oldDisplay, oldType] = await resolver(field, oldVal);
        const [newDisplay, newType] = await resolver(field, newVal);

        changes.push({
            field: displayField,
            oldValue: oldDisplay,
            newValue: newDisplay,
            type: newType || oldType || 'text'
        });
    }
    
    return changes;
};

/**
 * Enrich approval with display data
 * @param {Object} approval - Approval object
 * @returns {Promise<Object>} Enriched approval
 */
const enrichApprovalForDisplay = async (approval) => {
    // Enrich notes with human-readable identifiers for bulk operations
    approval.enriched_notes = await enrichNotesWithIdentifiers(approval);

    // Special enrichment for test_rate_import bulk uploads: attach client and insurer names
    if (approval.entity_type === 'test_rate_import' && Array.isArray(approval.new_data)) {
        try {
            const clientIds = [...new Set(approval.new_data.map(r => r.client_id).filter(Boolean))];
            const insurerIds = [...new Set(approval.new_data.map(r => r.insurer_id).filter(Boolean))];

            const clientMap = {};
            const insurerMap = {};

            if (clientIds.length > 0) {
                const placeholders = clientIds.map(() => '?').join(',');
                const clients = await db.query(`SELECT id, client_name FROM clients WHERE id IN (${placeholders})`, clientIds);
                clients.forEach(c => {
                    clientMap[c.id] = c.client_name;
                });
            }

            if (insurerIds.length > 0) {
                const placeholders = insurerIds.map(() => '?').join(',');
                const insurers = await db.query(`SELECT id, insurer_name FROM insurers WHERE id IN (${placeholders})`, insurerIds);
                insurers.forEach(i => {
                    insurerMap[i.id] = i.insurer_name;
                });
            }

            approval.new_data = approval.new_data.map(record => ({
                ...record,
                tpa_name: record.client_id ? (clientMap[record.client_id] || null) : null,
                client_name: record.client_id ? (clientMap[record.client_id] || null) : null,
                insurer_name: record.insurer_id ? (insurerMap[record.insurer_id] || null) : null
            }));
        } catch (e) {
        }
    }

    // Special enrichment for appointment medical completion:
    // attach any appointment_medical_files so approver can see uploaded documents
    try {
        if (
            approval.entity_type === 'appointment' &&
            approval.action_type === 'update' &&
            approval.new_data &&
            approval.new_data.medical_status === 'completed'
        ) {
            const files = await db.query(
                `SELECT 
                    id,
                    appointment_id,
                    file_path,
                    file_name,
                    file_size,
                    uploaded_by,
                    uploaded_at,
                    is_deleted
                 FROM appointment_medical_files
                 WHERE appointment_id = ? AND is_deleted = 0
                 ORDER BY uploaded_at DESC`,
                [approval.entity_id]
            );

            approval.related_files = files || [];
        }
    } catch (e) {
        // Do not block approval details if file lookup fails
    }

    // Build friendly display changes for modal
    approval.display_changes = await buildDisplayChanges(approval);

    return approval;
};

module.exports = {
    buildDisplayChanges,
    enrichApprovalForDisplay
};
