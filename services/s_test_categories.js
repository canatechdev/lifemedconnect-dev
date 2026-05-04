const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');

/**
 * Service layer for test categories management
 * Extends BaseService for standard CRUD operations
 */
class TestCategoriesService extends BaseService {
    constructor() {
        super('test_categories', 'id', ['category_name', 'description'], ['id', 'category_name', 'created_at'], { hasPendingApproval: true });
    }

    parseReportType(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
            } catch (e) {
                return value ? [value] : [];
            }
        }
        return value ? [value] : [];
    }

    async createCategory(category, createdBy = null, connection = null) {
        let useConnection = connection;
        let shouldReleaseConnection = false;

        try {
            // Create connection if not provided
            if (!useConnection) {
                useConnection = await db.pool.getConnection();
                await useConnection.beginTransaction();
                shouldReleaseConnection = true;
            }

            // 1️ Insert into test_categories
            const categorySql = `
                INSERT INTO test_categories (
                    category_name, description, is_active, created_by, created_at, report_type
                ) VALUES (?, ?, ?, ?, NOW(), ?)
            `;
            const normalizedReportType = Array.isArray(category.report_type)
                ? JSON.stringify(category.report_type)
                : category.report_type || null;

            const [categoryResult] = await useConnection.execute(categorySql, [
                category.category_name,
                category.description || null,
                category.is_active ?? 1,
                createdBy,
                normalizedReportType
            ]);
            const categoryId = categoryResult.insertId;

            // 2️ Insert category-test mapping
            if (Array.isArray(category.test_ids) && category.test_ids.length > 0) {
                const validIds = category.test_ids.filter(id => !isNaN(Number(id)));
                if (validIds.length > 0) {
                    const values = validIds.map(testId => [categoryId, testId, 1, 0]);
                    const placeholders = values.map(() => '(?, ?, ?, ?)').join(', ');
                    await useConnection.execute(
                        `INSERT INTO category_test_mapping (category_test_id, single_test_id, is_mandatory, display_order)
                         VALUES ${placeholders}`,
                        values.flat()
                    );
                }
            }

            // 3️ Optional bulk rate insert
            if (category.client_id || category.insurer_id || category.rate) {
                const sql = `
                    INSERT INTO bulk_test_rates (
                        client_id, insurer_id, item_type, item_name, description,
                        rate, is_active, created_by, created_at, category_id
                    )
                    VALUES (?, ?, 'category', ?, ?, ?, 1, ?, NOW(), ?)
                `;
                await useConnection.execute(sql, [
                    category.client_id || null,
                    category.insurer_id || null,
                    category.category_name,
                    category.description || null,
                    category.rate || 0.0,
                    createdBy,
                    categoryId,
                ]);
            }

            // Commit transaction if we created it
            if (shouldReleaseConnection) {
                await useConnection.commit();
            }

            logger.info('Test category created successfully', {
                categoryId,
                categoryName: category.category_name,
                testIdsCount: category.test_ids?.length || 0,
                hasRate: !!(category.client_id || category.insurer_id || category.rate),
                createdBy
            });

            return categoryId;
        } catch (error) {
            // Rollback transaction if we created it
            if (shouldReleaseConnection) {
                await useConnection.rollback();
            }

            logger.error('Failed to create test category', {
                error: error.message,
                categoryData: category,
                createdBy
            });
            throw error;
        } finally {
            if (shouldReleaseConnection) {
                useConnection.release();
            }
        }
    }

    async updateCategory(id, updates, updatedBy = null, connection = null) {
        let useConnection = connection;
        let shouldReleaseConnection = false;

        try {
            if (!useConnection) {
                useConnection = await db.pool.getConnection();
                await useConnection.beginTransaction();
                shouldReleaseConnection = true;
            }

            const { test_ids, ...fieldsToUpdate } = updates;
            let affectedRows = 0;

            const fields = [];
            const values = [];
            for (const [key, value] of Object.entries(fieldsToUpdate)) {
                if (value !== undefined && key !== 'client_id' && key !== 'insurer_id' && key !== 'rate' && key !== 'priority' && key !== 'approval_notes') {
                    const normalizedValue = key === 'report_type'
                        ? (Array.isArray(value) ? JSON.stringify(value) : value)
                        : value;
                    fields.push(`${key} = ?`);
                    values.push(normalizedValue);
                }
            }

            if (fields.length > 0) {
                fields.push('updated_by = ?', 'updated_at = NOW()');
                values.push(updatedBy);
                values.push(id);
                const [res] = await useConnection.execute(
                    `UPDATE test_categories SET ${fields.join(', ')} WHERE id = ?`,
                    values
                );
                affectedRows = res.affectedRows;
            } else {
                affectedRows = 1;
            }

            if (test_ids !== undefined) {
                await useConnection.execute('DELETE FROM category_test_mapping WHERE category_test_id = ?', [id]);
                const validIds = Array.isArray(test_ids)
                    ? test_ids.filter(v => v && !isNaN(Number(v)))
                    : [];
                if (validIds.length > 0) {
                    const values = validIds.map(testId => [id, Number(testId), 1, 0]);
                    const placeholders = values.map(() => '(?, ?, ?, ?)').join(', ');
                    await useConnection.execute(
                        `INSERT INTO category_test_mapping (category_test_id, single_test_id, is_mandatory, display_order)
                         VALUES ${placeholders}`,
                        values.flat()
                    );
                }
            }

            if (updates.client_id !== undefined || updates.insurer_id !== undefined || updates.rate !== undefined) {
                const [existing] = await useConnection.execute(
                    'SELECT id FROM bulk_test_rates WHERE category_id = ? AND item_type = "category"',
                    [id]
                );

                if (existing.length > 0) {
                    const updateFields = [];
                    const updateValues = [];
                    if (updates.client_id !== undefined) {
                        updateFields.push('client_id = ?');
                        updateValues.push(updates.client_id);
                    }
                    if (updates.insurer_id !== undefined) {
                        updateFields.push('insurer_id = ?');
                        updateValues.push(updates.insurer_id);
                    }
                    if (updates.rate !== undefined) {
                        updateFields.push('rate = ?');
                        updateValues.push(updates.rate);
                    }
                    if (updates.category_name !== undefined) {
                        updateFields.push('item_name = ?');
                        updateValues.push(updates.category_name);
                    }
                    if (updates.description !== undefined) {
                        updateFields.push('description = ?');
                        updateValues.push(updates.description);
                    }
                    updateFields.push('updated_by = ?', 'updated_at = NOW()');
                    updateValues.push(updatedBy);
                    updateValues.push(existing[0].id);
                    await useConnection.execute(
                        `UPDATE bulk_test_rates SET ${updateFields.join(', ')} WHERE id = ?`,
                        updateValues
                    );
                } else {
                    const [cat] = await useConnection.execute(
                        'SELECT category_name, description FROM test_categories WHERE id = ?',
                        [id]
                    );
                    const category = cat[0];
                    const insertSql = `
                        INSERT INTO bulk_test_rates (
                            client_id, insurer_id, item_type, item_name, description,
                            rate, is_active, created_by, created_at, category_id
                        ) VALUES (?, ?, 'category', ?, ?, ?, 1, ?, NOW(), ?)
                    `;
                    await useConnection.execute(insertSql, [
                        updates.client_id || null,
                        updates.insurer_id || null,
                        category.category_name,
                        category.description || null,
                        updates.rate || 0.0,
                        updatedBy,
                        id,
                    ]);
                }
            }

            if (shouldReleaseConnection) {
                await useConnection.commit();
            }

            logger.info('Test category updated successfully', {
                categoryId: id,
                updatedFields: Object.keys(updates),
                updatedBy
            });

            return affectedRows;
        } catch (error) {
            if (shouldReleaseConnection) {
                await useConnection.rollback();
            }

            logger.error('Failed to update test category', {
                error: error.message,
                categoryId: id,
                updates,
                updatedBy
            });
            throw error;
        } finally {
            if (shouldReleaseConnection) {
                useConnection.release();
            }
        }
    }

    async softDeleteCategory(ids, updatedBy = null) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return 0;
        }

        try {
            const placeholders = ids.map(() => '?').join(', ');
            const sql = `
                UPDATE test_categories
                SET is_deleted = 1, updated_by = ?, updated_at = NOW()
                WHERE id IN (${placeholders})
            `;
            const result = await db.query(sql, [updatedBy, ...ids]);

            logger.info('Test categories soft deleted', {
                categoryIds: ids,
                affectedRows: result.affectedRows,
                updatedBy
            });

            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to soft delete test categories', {
                error: error.message,
                categoryIds: ids,
                updatedBy
            });
            throw error;
        }
    }

    async listCategories({ page = 1, limit = 0, search = '', sortBy = 'id', sortOrder = 'DESC' }) {
        try {
            // Use BaseService.list() for basic pagination and search
            const result = await this.list({
                page,
                limit,
                search,
                sortBy,
                sortOrder
            });

            // Enrich results with test_ids and rates for each category
            for (const row of result.data) {
                row.report_type = this.parseReportType(row.report_type);
                // Get test mappings
                const tests = await db.query(
                    'SELECT single_test_id FROM category_test_mapping WHERE category_test_id = ?',
                    [row.id]
                );
                row.test_ids = tests.map(t => t.single_test_id);

                // Get rates
                const rates = await db.query(
                    `SELECT btr.id, btr.client_id, btr.insurer_id, btr.rate, btr.description,
                            c.client_name, i.insurer_name
                     FROM bulk_test_rates btr
                     LEFT JOIN clients c ON btr.client_id = c.id
                     LEFT JOIN insurers i ON btr.insurer_id = i.id
                     WHERE btr.category_id = ? AND btr.item_type = 'category' AND btr.is_deleted = 0
                     ORDER BY c.client_name, i.insurer_name`,
                    [row.id]
                );
                row.rates = rates || [];

                // Backward compatibility - set first rate as default
                if (rates.length > 0) {
                    row.client_id = rates[0].client_id;
                    row.insurer_id = rates[0].insurer_id;
                    row.rate = rates[0].rate;
                }
            }

            return result;

        } catch (error) {
            logger.error('Error listing categories', { error: error.message, stack: error.stack });
            throw new Error(`Failed to list categories: ${error.message}`);
        }
    }

    async getCategory(id) {
        try {
            const rows = await db.query('SELECT * FROM test_categories WHERE id = ?', [id]);
            if (rows.length === 0) {
                return null;
            }

            const category = rows[0];
            category.report_type = this.parseReportType(category.report_type);

            const tests = await db.query(
                'SELECT single_test_id FROM category_test_mapping WHERE category_test_id = ?',
                [id]
            );
            category.test_ids = tests.map(t => t.single_test_id);

            const rates = await db.query(
                `SELECT btr.id, btr.client_id, btr.insurer_id, btr.rate, btr.description,
                        c.client_name, i.insurer_name
                 FROM bulk_test_rates btr
                 LEFT JOIN clients c ON btr.client_id = c.id
                 LEFT JOIN insurers i ON btr.insurer_id = i.id
                 WHERE btr.category_id = ? AND btr.item_type = 'category' AND btr.is_deleted = 0
                 ORDER BY c.client_name, i.insurer_name`,
                [id]
            );
            category.rates = rates || [];

            if (rates.length > 0) {
                category.client_id = rates[0].client_id;
                category.insurer_id = rates[0].insurer_id;
                category.rate = rates[0].rate;
            }

            return category;
        } catch (error) {
            logger.error('Failed to get test category', {
                error: error.message,
                categoryId: id
            });
            throw error;
        }
    }

    async getCategoriesByIds(ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        try {
            const placeholders = ids.map(() => '?').join(', ');
            const sql = `SELECT * FROM test_categories WHERE id IN (${placeholders})`;
            const rows = await db.query(sql, ids);

            for (const row of rows) {
                const tests = await db.query(
                    'SELECT single_test_id FROM category_test_mapping WHERE category_test_id = ?',
                    [row.id]
                );
                row.test_ids = tests.map(t => t.single_test_id);

                const rates = await db.query(
                    'SELECT client_id, insurer_id, rate FROM bulk_test_rates WHERE category_id = ? AND item_type = "category"',
                    [row.id]
                );
                if (rates.length > 0) {
                    row.client_id = rates[0].client_id;
                    row.insurer_id = rates[0].insurer_id;
                    row.rate = rates[0].rate;
                }
            }

            return rows;
        } catch (error) {
            logger.error('Failed to get test categories by IDs', {
                error: error.message,
                categoryIds: ids
            });
            throw error;
        }
    }

    async deleteCategory(id) {
        try {
            await db.query('DELETE FROM category_test_mapping WHERE category_test_id = ?', [id]);
            const result = await db.query('DELETE FROM test_categories WHERE id = ?', [id]);

            logger.info('Test category deleted', {
                categoryId: id,
                affectedRows: result.affectedRows
            });

            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to delete test category', {
                error: error.message,
                categoryId: id
            });
            throw error;
        }
    }
}

// Create and export service instance
const testCategoriesService = new TestCategoriesService();

// Export both instance and class for flexibility
module.exports = {
    TestCategoriesService,
    testCategoriesService,
    // Backward compatibility - export methods bound to instance
    createCategory: testCategoriesService.createCategory.bind(testCategoriesService),
    updateCategory: testCategoriesService.updateCategory.bind(testCategoriesService),
    listCategories: testCategoriesService.listCategories.bind(testCategoriesService),
    getCategory: testCategoriesService.getCategory.bind(testCategoriesService),
    getCategoriesByIds: testCategoriesService.getCategoriesByIds.bind(testCategoriesService),
    softDeleteCategory: testCategoriesService.softDeleteCategory.bind(testCategoriesService),
    deleteCategory: testCategoriesService.deleteCategory.bind(testCategoriesService),
};
