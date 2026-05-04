const db = require('../lib/dbconnection');
const logger = require('../lib/logger');

function safe(value, fallback = null) {
    return value === undefined || value === '' ? fallback : value;
}

// Create a new test rate in bulk_test_rates table
async function createTestRate(row) {
    try {
        logger.info('Creating test rate', { row });

        // Validate required fields
        // if (!row.client_id || row.client_id === null || row.client_id === undefined || row.client_id === '' || row.client_id <= 0 || isNaN(row.client_id)) {
        //     throw new Error('client_id is required and must be a positive number');
        // }
        // if (!row.item_name || row.item_name === null || row.item_name === undefined || row.item_name === '') {
        //     throw new Error('item_name is required and cannot be null or empty');
        // }
        // if (row.rate === null || row.rate === undefined || row.rate === '' || row.rate < 0 || isNaN(row.rate)) {
        //     throw new Error('rate is required and must be a non-negative number');
        // }
        // if (!row.test_id || row.test_id === null || row.test_id === undefined || row.test_id === '' || row.test_id <= 0 || isNaN(row.test_id)) {
        //     throw new Error('test_id is required and must be a positive number');
        // }

        // Fetch test name if test_id is provided
        let itemName = row.item_name;
        let itemCode = row.item_code;

        if (row.test_id && (!itemName || !itemCode)) {
            const testResult = await db.query(
                'SELECT test_name, test_code FROM tests WHERE id = ?',
                [row.test_id]
            );
            if (testResult && testResult.length > 0) {
                if (!itemName) itemName = testResult[0].test_name;
                if (!itemCode) itemCode = testResult[0].test_code;
            }
        }

        const sql = `
            INSERT INTO bulk_test_rates (
                client_id, insurer_id, item_type, item_name, item_code,
                rate, test_id, category_id,
                is_active, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        const params = [
            safe(row.client_id),
            safe(row.insurer_id || null),
            'test', // Always 'test' since we removed categories
            safe(itemName),
            safe(itemCode),
            safe(row.rate),
            safe(row.test_id),
            null, // category_id is always null
            safe(row.is_active ?? 1),
            safe(row.created_by || null),
        ];
        const result = await db.query(sql, params);

        logger.info('Test rate created successfully', { id: result.insertId });
        return result.insertId;
    } catch (error) {
        logger.error('Error creating test rate', {
            error: error.message,
            stack: error.stack,
            row
        });
        throw new Error(`Failed to create test rate: ${error.message}`);
    }
}

// List test rates from bulk_test_rates table
async function listTestRates({ page = 1, limit = 0, search = '' }) {
    try {
        logger.info('Listing test rates', { page, limit, search });

        const searchColumns = ['rate', 'clients.client_name', 'item_name', 'item_code'];
        const searchParams = [];
        let whereClause = '';

        if (search && search.trim() !== '') {
            const conditions = searchColumns.map(col => `${col} LIKE ?`).join(' OR ');
            whereClause = ` WHERE (${conditions})`;
            searchColumns.forEach(() => searchParams.push(`%${search}%`));
        }

        // Count total
        const countSql = `
            SELECT COUNT(*) as total
            FROM bulk_test_rates
            JOIN clients ON bulk_test_rates.client_id = clients.id
            ${whereClause ? whereClause + ' AND' : ' WHERE'} bulk_test_rates.is_deleted = 0
            AND bulk_test_rates.item_type = 'test'
        `;
        const countRows = await db.query(countSql, searchParams);
        const total = countRows[0].total;

        // Paginated data
        let dataSql = `
            SELECT 
                bulk_test_rates.*, 
                clients.client_name,
                item_name as test_name
            FROM bulk_test_rates
            JOIN clients ON bulk_test_rates.client_id = clients.id
            ${whereClause ? whereClause + ' AND' : ' WHERE'} bulk_test_rates.is_deleted = 0 
            AND bulk_test_rates.has_pending_approval = 0
            AND bulk_test_rates.item_type = 'test'
            ORDER BY bulk_test_rates.id DESC
        `;

        const dataParams = [...searchParams];

        const numericLimit = Number(limit);
        const numericPage = Number(page);

        if (!isNaN(numericLimit) && numericLimit > 0) {
            const offset = (numericPage - 1) * numericLimit;
            dataSql += ` LIMIT ${numericLimit} OFFSET ${offset}`;
        }

        const rows = await db.query(dataSql, dataParams);

        logger.info('Test rates listed successfully', { total, count: rows.length });
        return {
            data: rows,
            pagination: {
                total,
                page: numericPage,
                limit: numericLimit,
                pages: numericLimit > 0 ? Math.ceil(total / numericLimit) : 1,
            },
        };
    } catch (error) {
        logger.error('Error listing test rates', {
            error: error.message,
            stack: error.stack,
            options: { page, limit, search }
        });
        throw new Error(`Failed to list test rates: ${error.message}`);
    }
}

// List clients with pagination + search
async function getTestClients({ page = 1, limit = 10, search = '', sortBy = 'id', sortOrder = 'DESC' }) {
    try {
        logger.info('Getting test clients', { page, limit, search, sortBy, sortOrder });

        const searchColumns = [
            'c.client_code',
            'c.client_name',
            'c.client_type',
            'c.contact_person_name',
            'c.contact_person_no',
            'c.email_id',
            'i.insurer_name'
        ];
        const searchParams = [];

        let whereClause = ' WHERE c.is_deleted = 0';

        if (search && search.trim() !== '') {
            const conditions = searchColumns.map(col => `${col} LIKE ?`).join(' OR ');
            whereClause += ` AND (${conditions})`;
            searchColumns.forEach(() => searchParams.push(`%${search}%`));
        }

        // Validate sortBy
        const allowedSortColumns = [
            'c.id',
            'c.client_code',
            'c.client_name',
            'c.client_type',
            'c.created_at',
            'c.contact_person_no'
        ];
        const validSortBy = allowedSortColumns.includes(`c.${sortBy}`) ? `c.${sortBy}` : 'c.id';
        const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Count total
        const countSql = `
            SELECT COUNT(DISTINCT c.id) as total 
            FROM clients c
            LEFT JOIN client_insurers ci ON c.id = ci.client_id
            LEFT JOIN insurers i ON ci.insurer_id = i.id AND i.is_deleted = 0
            ${whereClause}
        `;
        const countRows = await db.query(countSql, searchParams);
        const total = countRows[0].total;

        const numericLimit = Number(limit);
        const numericPage = Number(page);

        // Build the main query with optional LIMIT
        const limitClause = (!isNaN(numericLimit) && numericLimit > 0)
            ? ` LIMIT ${numericLimit} OFFSET ${(numericPage - 1) * numericLimit}`
            : '';

        const dataSql = `
            SELECT 
                c.*,
                GROUP_CONCAT(DISTINCT i.insurer_name ORDER BY i.insurer_name SEPARATOR ', ') as insurer_names,
                GROUP_CONCAT(DISTINCT i.id ORDER BY i.id SEPARATOR ', ') as insurer_ids
            FROM clients c
            LEFT JOIN client_insurers ci ON c.id = ci.client_id
            LEFT JOIN insurers i ON ci.insurer_id = i.id AND i.is_deleted = 0
            ${whereClause}
            GROUP BY c.id
            ORDER BY ${validSortBy} ${validSortOrder}
            ${limitClause}
        `;

        const rows = await db.query(dataSql, searchParams);

        // Transform the data
        const transformedRows = rows.map(row => {
            const insurers = [];
            if (row.insurer_names && row.insurer_ids) {
                const insurerNames = row.insurer_names.split(', ');
                const insurerIds = row.insurer_ids.split(', ').map(id => parseInt(id));

                insurerNames.forEach((name, index) => {
                    if (name && insurerIds[index]) {
                        insurers.push({
                            id: insurerIds[index],
                            insurer_name: name
                        });
                    }
                });
            }

            return {
                ...row,
                insurers: insurers
            };
        });

        logger.info('Test clients retrieved successfully', {
            total,
            count: transformedRows.length,
            page: numericPage,
            limit: numericLimit
        });

        return {
            data: transformedRows,
            pagination: {
                total,
                page: numericPage,
                limit: numericLimit,
                pages: numericLimit > 0 ? Math.ceil(total / numericLimit) : 1,
            },
        };
    } catch (error) {
        logger.error('Error getting test clients', {
            error: error.message,
            stack: error.stack,
            options: { page, limit, search, sortBy, sortOrder }
        });
        throw new Error(`Failed to get test clients: ${error.message}`);
    }
}

// Get test rate by ID
async function getTestRate(id) {
    try {
        logger.info('Getting test rate', { id });

        const sql = `
            SELECT 
                bulk_test_rates.*,
                clients.client_name,
                insurers.insurer_name
            FROM bulk_test_rates
            JOIN clients ON bulk_test_rates.client_id = clients.id
            LEFT JOIN insurers ON bulk_test_rates.insurer_id = insurers.id
            WHERE bulk_test_rates.id = ? AND bulk_test_rates.is_deleted = 0
        `;
        const rows = await db.query(sql, [id]);

        if (rows.length === 0) {
            logger.warn('Test rate not found', { id });
            return null;
        }

        logger.info('Test rate retrieved successfully', { id });
        return rows[0];
    } catch (error) {
        logger.error('Error getting test rate', {
            error: error.message,
            stack: error.stack,
            id
        });
        throw new Error(`Failed to get test rate: ${error.message}`);
    }
}

// Update test rate
async function updateTestRate(id, updates) {
    try {
        logger.info('Updating test rate', { id, updates });

        const fields = [];
        const values = [];

        Object.entries(updates).forEach(([k, v]) => {
            if (v !== undefined) {
                fields.push(`${k} = ?`);
                values.push(v);
            }
        });

        if (!fields.length) {
            logger.warn('No fields to update', { id });
            return 0;
        }

        const sql = `UPDATE bulk_test_rates SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
        values.push(id);

        const result = await db.query(sql, values);

        if (result.affectedRows === 0) {
            logger.warn('No test rate updated - not found or no changes', { id });
        } else {
            logger.info('Test rate updated successfully', { id, affectedRows: result.affectedRows });
        }

        return result.affectedRows;
    } catch (error) {
        logger.error('Error updating test rate', {
            id,
            error: error.message,
            stack: error.stack,
            updates
        });
        throw new Error(`Failed to update test rate: ${error.message}`);
    }
}

// Get client test rates from bulk_test_rates table
async function getClientTestRates(clientId) {
    try {
        logger.info('Getting client test rates', { clientId });

        // Step 1: Get all insurer_ids linked to the client
        const insurerRows = await db.query(`
            SELECT ci.insurer_id, i.insurer_name, i.insurer_code, i.insurer_type
            FROM client_insurers ci
            JOIN insurers i ON ci.insurer_id = i.id AND i.is_deleted = 0
            WHERE ci.client_id = ?`, [clientId]);

        if (insurerRows.length === 0) {
            logger.warn('No insurers found for this client', { clientId });
            return { message: 'No insurers found for this client', data: [] };
        }

        // Step 2: Get test rates for these insurers from bulk_test_rates
        const insurerIds = insurerRows.map(row => row.insurer_id);
        const placeholders = insurerIds.map(() => '?').join(', ');
        const params = [clientId, ...insurerIds];

        const rateRows = await db.query(`
            SELECT 
                btr.id AS rate_id,
                btr.rate,
                btr.item_type as rate_type,
                btr.is_active AS rate_active,
                btr.insurer_id,
                btr.test_id,
                btr.item_name,
                btr.item_code,
                c.client_name
            FROM bulk_test_rates btr
            JOIN clients c ON btr.client_id = c.id AND c.is_deleted = 0
            WHERE btr.client_id = ?
            AND btr.insurer_id IN (${placeholders})
            AND btr.is_deleted = 0
            AND btr.item_type = 'test'
            ORDER BY btr.item_name ASC
        `, params);

        // Step 3: Organize results: group rates under each insurer
        const insurerMap = insurerRows.reduce((acc, row) => {
            acc[row.insurer_id] = {
                insurer_id: row.insurer_id,
                insurer_name: row.insurer_name,
                insurer_code: row.insurer_code,
                insurer_type: row.insurer_type,
                test_rates: []
            };
            return acc;
        }, {});

        rateRows.forEach(rate => {
            if (insurerMap[rate.insurer_id]) {
                insurerMap[rate.insurer_id].test_rates.push({
                    rate_id: rate.rate_id,
                    rate: rate.rate,
                    rate_type: rate.rate_type,
                    rate_active: rate.rate_active,
                    test_id: rate.test_id,
                    item_name: rate.item_name,
                    item_code: rate.item_code,
                    client_name: rate.client_name
                });
            }
        });

        const finalResult = Object.values(insurerMap);

        logger.info('Client test rates retrieved successfully', {
            clientId,
            insurerCount: finalResult.length,
            totalRates: rateRows.length
        });

        return { data: finalResult };
    } catch (error) {
        logger.error('Error getting client test rates', {
            error: error.message,
            stack: error.stack,
            clientId
        });
        throw new Error(`Failed to get client test rates: ${error.message}`);
    }
}

// Get available tests for a client
async function getAvailableTests(clientId) {
    try {
        logger.info('Getting available tests for client', { clientId });

        // Get all active tests
        const tests = await db.query(`
            SELECT id, test_name as name, test_code as code, 'test' as type
            FROM tests
            WHERE is_active = 1 AND is_deleted = 0
            ORDER BY test_name
        `);

        // Get existing rates to filter out already assigned tests
        const existingRates = await db.query(`
            SELECT test_id
            FROM bulk_test_rates
            WHERE client_id = ? AND is_deleted = 0 AND item_type = 'test'
        `, [clientId]);

        const existingTestIds = new Set(existingRates.map(rate => rate.test_id));

        // Filter out existing tests
        const availableTests = tests.filter(test => !existingTestIds.has(test.id));

        logger.info('Available tests retrieved successfully', {
            clientId,
            totalTests: tests.length,
            availableTests: availableTests.length,
            existingTests: existingTestIds.size
        });

        return availableTests;
    } catch (error) {
        logger.error('Error getting available tests', {
            error: error.message,
            stack: error.stack,
            clientId
        });
        throw new Error(`Failed to get available tests: ${error.message}`);
    }
}

// Soft delete test rates
async function softDeleteTestRate(ids) {
    try {
        logger.info('Soft deleting test rates', { ids });

        if (!ids.length) {
            logger.warn('No IDs provided for soft delete');
            return 0;
        }

        const placeholders = ids.map(() => '?').join(', ');
        const sql = `UPDATE bulk_test_rates SET is_deleted = 1, updated_at = NOW() WHERE id IN (${placeholders})`;

        const result = await db.query(sql, ids);

        logger.info('Test rates soft deleted successfully', {
            ids,
            affectedRows: result.affectedRows
        });

        return result.affectedRows;
    } catch (error) {
        logger.error('Error soft deleting test rates', {
            error: error.message,
            stack: error.stack,
            ids
        });
        throw new Error(`Failed to soft delete test rates: ${error.message}`);
    }
}

// Hard delete test rate
async function deleteTestRate(id) {
    try {
        logger.info('Hard deleting test rate', { id });

        const result = await db.query('DELETE FROM bulk_test_rates WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            logger.warn('No test rate deleted - not found', { id });
        } else {
            logger.info('Test rate hard deleted successfully', { id, affectedRows: result.affectedRows });
        }

        return result.affectedRows;
    } catch (error) {
        logger.error('Error hard deleting test rate', {
            error: error.message,
            stack: error.stack,
            id
        });
        throw new Error(`Failed to delete test rate: ${error.message}`);
    }
}

// Get all tests for selection
async function getTests() {
    try {
        logger.info('Getting all tests for selection');

        const tests = await db.query(`
            SELECT id, test_name, test_code
            FROM tests
            WHERE is_active = 1 AND is_deleted = 0
            ORDER BY test_name
        `);

        logger.info('Tests retrieved successfully', { count: tests.length });
        return tests;
    } catch (error) {
        logger.error('Error getting tests', {
            error: error.message,
            stack: error.stack
        });
        throw new Error(`Failed to get tests: ${error.message}`);
    }
}

module.exports = {
    createTestRate,
    listTestRates,
    getTestRate,
    updateTestRate,
    deleteTestRate,
    softDeleteTestRate,
    getClientTestRates,
    getAvailableTests,
    getTests,
    getTestClients
};