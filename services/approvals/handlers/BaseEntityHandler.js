/**
 * Base Entity Handler
 * Base class for entity-specific approval handlers
 */

const logger = require('../../../lib/logger');

class BaseEntityHandler {
    /**
     * @param {string} entityType - Entity type (e.g., 'appointment', 'client')
     * @param {string} tableName - Database table name
     */
    constructor(entityType, tableName) {
        this.entityType = entityType;
        this.tableName = tableName;
    }

    /**
     * Handle entity activation (for CREATE approvals)
     * @param {Object} connection - Database connection
     * @param {number} entityId - Entity ID
     * @returns {Promise<void>}
     */
    async activate(connection, entityId) {
        await connection.execute(
            `UPDATE ${this.tableName} SET is_active = 1, has_pending_approval = 0 WHERE id = ?`,
            [entityId]
        );
        logger.info(`${this.entityType} activated`, { entityId });
    }

    /**
     * Handle entity soft delete (for DELETE approvals)
     * @param {Object} connection - Database connection
     * @param {number} entityId - Entity ID
     * @returns {Promise<void>}
     */
    async softDelete(connection, entityId) {
        await connection.execute(
            `UPDATE ${this.tableName} SET is_deleted = 1, updated_at = NOW() WHERE id = ?`,
            [entityId]
        );
        logger.info(`${this.entityType} soft deleted`, { entityId });
    }

    /**
     * Handle entity update (for UPDATE approvals)
     * Override this method in subclasses for custom update logic
     * @param {Object} connection - Database connection
     * @param {number} entityId - Entity ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context (oldData, etc.)
     * @returns {Promise<void>}
     */
    async update(connection, entityId, newData, context = {}) {
        // Default implementation - subclasses should override for custom logic
        logger.info(`${this.entityType} update - using default handler`, { entityId });
    }

    /**
     * Check if this handler should handle the entity
     * @param {string} entityType - Entity type to check
     * @returns {boolean}
     */
    canHandle(entityType) {
        return this.entityType === entityType;
    }

    /**
     * Get handler name for logging
     * @returns {string}
     */
    getName() {
        return this.constructor.name;
    }
}

module.exports = BaseEntityHandler;
