/**
 * Test Category Entity Handler
 * Handles test_category-specific approval logic including test mappings and rates
 */

const BaseEntityHandler = require('./BaseEntityHandler');
const logger = require('../../../lib/logger');

class TestCategoryHandler extends BaseEntityHandler {
    constructor() {
        super('test_category', 'test_categories');
    }

    /**
     * Handle test category update with test_ids and rates
     * @param {Object} connection - Database connection
     * @param {number} entityId - Category ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context
     * @returns {Promise<void>}
     */
    async update(connection, entityId, newData, context = {}) {
        // Update test_ids mapping
        if (Object.prototype.hasOwnProperty.call(newData, 'test_ids')) {
            await this.updateTestMapping(connection, entityId, newData.test_ids);
        }

        // Update rate, client_id, insurer_id in bulk_test_rates
        if (Object.prototype.hasOwnProperty.call(newData, 'rate') ||
            Object.prototype.hasOwnProperty.call(newData, 'client_id') ||
            Object.prototype.hasOwnProperty.call(newData, 'insurer_id')) {
            await this.updateRates(connection, entityId, newData);
        }
    }

    /**
     * Update test mapping for category
     * @param {Object} connection - Database connection
     * @param {number} entityId - Category ID
     * @param {*} testIds - Test IDs (array or comma-separated string)
     * @returns {Promise<void>}
     */
    async updateTestMapping(connection, entityId, testIds) {
        const ids = Array.isArray(testIds) 
            ? testIds 
            : String(testIds || '').split(',').filter(Boolean).map(Number);

        // Delete existing mappings
        await connection.execute(
            'DELETE FROM category_test_mapping WHERE category_test_id = ?',
            [entityId]
        );

        // Insert new mappings
        if (ids.length > 0) {
            const values = ids.map((testId) => [entityId, testId, 1, 0]);
            const placeholders = values.map(() => '(?, ?, ?, ?)').join(',');
            await connection.execute(
                `INSERT INTO category_test_mapping (category_test_id, single_test_id, is_mandatory, display_order) VALUES ${placeholders}`,
                values.flat()
            );
        }

        logger.info('Test category mapping updated', { entityId, testCount: ids.length });
    }

    /**
     * Update rates for category
     * @param {Object} connection - Database connection
     * @param {number} entityId - Category ID
     * @param {Object} newData - New data containing rate fields
     * @returns {Promise<void>}
     */
    async updateRates(connection, entityId, newData) {
        // Check if rate record exists
        const [existing] = await connection.execute(
            'SELECT id FROM bulk_test_rates WHERE category_id = ? AND item_type = "category"',
            [entityId]
        );

        if (existing.length > 0) {
            // Update existing rate record
            const updateFields = [];
            const updateValues = [];

            if (Object.prototype.hasOwnProperty.call(newData, 'client_id')) {
                updateFields.push('client_id = ?');
                updateValues.push(newData.client_id);
            }
            if (Object.prototype.hasOwnProperty.call(newData, 'insurer_id')) {
                updateFields.push('insurer_id = ?');
                updateValues.push(newData.insurer_id);
            }
            if (Object.prototype.hasOwnProperty.call(newData, 'rate')) {
                updateFields.push('rate = ?');
                updateValues.push(newData.rate);
            }

            if (updateFields.length > 0) {
                updateFields.push('updated_at = NOW()');
                updateValues.push(existing[0].id);
                await connection.execute(
                    `UPDATE bulk_test_rates SET ${updateFields.join(', ')} WHERE id = ?`,
                    updateValues
                );
                logger.info('Test category rate updated', { entityId, rateId: existing[0].id });
            }
        } else if (Object.prototype.hasOwnProperty.call(newData, 'rate') ||
                   Object.prototype.hasOwnProperty.call(newData, 'client_id') ||
                   Object.prototype.hasOwnProperty.call(newData, 'insurer_id')) {
            // Create new rate record
            const [cat] = await connection.execute(
                'SELECT category_name, description FROM test_categories WHERE id = ?',
                [entityId]
            );

            if (cat.length > 0) {
                const category = cat[0];
                await connection.execute(
                    `INSERT INTO bulk_test_rates (
                        client_id, insurer_id, item_type, item_name, description,
                        rate, is_active, created_at, category_id
                    ) VALUES (?, ?, 'category', ?, ?, ?, 1, NOW(), ?)`,
                    [
                        newData.client_id || null,
                        newData.insurer_id || null,
                        category.category_name,
                        category.description || null,
                        newData.rate || 0.0,
                        entityId
                    ]
                );
                logger.info('Test category rate created', { entityId });
            }
        }
    }
}

module.exports = TestCategoryHandler;
