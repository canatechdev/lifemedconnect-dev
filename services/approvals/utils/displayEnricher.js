/**
 * Display Enricher
 * Enriches approval data with human-readable information for UI display
 */

const db = require('../../../lib/dbconnection');
const { isImagePath, isPdfPath, normalizePath } = require('./normalizers');
const { getEntityTable, getNameColumn, inferTableFromField } = require('../config/entityConfig');

/**
 * Get test names by IDs
 * @param {Array<number>} ids - Test IDs
 * @returns {Promise<Array>} Test records
 */
const getTestNamesByIds = async (ids) => {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const query = `SELECT id, test_name FROM tests WHERE id IN (${placeholders})`;
    const rows = await db.query(query, ids);
    return rows;
};

/**
 * Create field resolver for entity type
 * Resolves field values to human-readable display values
 * @param {string} entityType - Entity type
 * @returns {Function} Resolver function
 */
const createFieldResolver = (entityType) => {
    return async (field, value) => {
        if (value === null || value === undefined || value === '') return [null, 'text'];

        // Date formatting (DD/MM/YYYY)
        if (field.toLowerCase().includes('date') && !field.toLowerCase().includes('datetime')) {
            try {
                const d = new Date(value);
                if (!isNaN(d)) {
                    const day = String(d.getDate()).padStart(2, '0');
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const year = d.getFullYear();
                    return [`${day}/${month}/${year}`, 'text'];
                }
            } catch (e) {}
        }

        // Time formatting (HH:MM AM/PM)
        if (field.toLowerCase().includes('time') && typeof value === 'string') {
            try {
                const timeMatch = value.match(/^(\d{2}):(\d{2}):?(\d{2})?$/);
                if (timeMatch) {
                    let hours = parseInt(timeMatch[1]);
                    const minutes = timeMatch[2];
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12 || 12; // Convert to 12-hour format
                    return [`${hours}:${minutes} ${ampm}`, 'text'];
                }
            } catch (e) {}
        }

        // Media previews
        if (typeof value === 'string') {
            if (isImagePath(value)) return [normalizePath(value), 'image'];
            if (isPdfPath(value)) return [normalizePath(value), 'pdf'];
        }

        // User fields
        if (field === 'created_by' || field === 'updated_by' || field === 'requested_by' || field === 'reviewed_by') {
            const rows = await db.query('SELECT full_name FROM users WHERE id = ?', [value]);
            return [rows[0]?.full_name || String(value), 'text'];
        }

        // Common foreign keys
        if (field === 'client_id') {
            const rows = await db.query('SELECT client_name AS name FROM clients WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }
        if (field === 'center_id' || field === 'other_center_id') {
            const rows = await db.query('SELECT center_name AS name FROM diagnostic_centers WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }
        if (field === 'insurer_id') {
            const rows = await db.query('SELECT insurer_name AS name FROM insurers WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }
        if (field === 'assigned_technician_id') {
            const rows = await db.query('SELECT full_name AS name FROM technicians WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }
        if (field === 'test_id') {
            const rows = await db.query('SELECT test_name AS name FROM tests WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }
        if (field === 'category_id') {
            const rows = await db.query('SELECT category_name AS name FROM test_categories WHERE id = ?', [value]);
            return [rows[0]?.name || String(value), 'text'];
        }

        // Composite IDs array (e.g., insurer_ids)
        if (field === 'insurer_ids') {
            const ids = Array.isArray(value) ? value : String(value).split(',').filter(Boolean).map(Number);
            if (!ids.length) return [null, 'text'];
            const placeholders = ids.map(() => '?').join(',');
            const rows = await db.query(`SELECT insurer_name AS name FROM insurers WHERE id IN (${placeholders}) ORDER BY insurer_name`, ids);
            const names = rows.map(r => r.name).join(', ');
            return [names || ids.join(','), 'text'];
        }

        // Generic *_id resolver when table can be inferred (best-effort)
        if (field.endsWith('_id')) {
            const table = inferTableFromField(field) || getEntityTable(entityType);
            if (table) {
                const nameCol = getNameColumn(table);
                try {
                    const rows = await db.query(`SELECT ${nameCol} AS name FROM ${table} WHERE id = ?`, [value]);
                    if (rows && rows[0] && rows[0].name) return [rows[0].name, 'text'];
                } catch (e) {}
            }
        }

        return [value, 'text'];
    };
};

/**
 * Enrich notes with human-readable identifiers for bulk operations
 * @param {Object} approval - Approval object
 * @returns {Promise<string>} Enriched notes
 */
const enrichNotesWithIdentifiers = async (approval) => {
    const { notes, old_data, entity_type, action_type } = approval;

    // Only process bulk operations with old_data
    if (!notes || !action_type?.includes('bulk') || !old_data || !Array.isArray(old_data)) {
        return notes;
    }

    // Extract human-readable identifiers based on entity type
    const identifiers = old_data.map(item => {
        if (entity_type === 'appointment') {
            return item.case_number || item.application_number || `ID: ${item.id}`;
        } else if (entity_type === 'client') {
            return item.client_name || `ID: ${item.id}`;
        } else if (entity_type === 'center') {
            return item.center_name || `ID: ${item.id}`;
        } else if (entity_type === 'doctor') {
            return item.doctor_name || `ID: ${item.id}`;
        } else if (entity_type === 'insurer') {
            return item.insurer_name || `ID: ${item.id}`;
        } else if (entity_type === 'test') {
            return item.test_name || `ID: ${item.id}`;
        } else if (entity_type === 'test_category') {
            return item.category_name || `ID: ${item.id}`;
        } else if (entity_type === 'test_rate') {
            return `${item.item_name} (${item.client_name || 'Client'})`;
        } else if (entity_type === 'technician') {
            return item.technician_name || item.full_name || `ID: ${item.id}`;
        } else if (entity_type === 'user') {
            return item.full_name || item.email || `ID: ${item.id}`;
        } else {
            return `ID: ${item.id}`;
        }
    });

    // Replace "with IDs: x, y, z" with "records: Name1, Name2, Name3"
    const enrichedNotes = notes.replace(
        /with IDs: ([\d,\s]+)\./,
        `records: ${identifiers.join(', ')}.`
    );

    return enrichedNotes;
};

module.exports = {
    getTestNamesByIds,
    createFieldResolver,
    enrichNotesWithIdentifiers
};
