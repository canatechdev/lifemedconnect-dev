/**
 * Client Entity Handler
 * Handles client-specific approval logic including insurer relationships
 */

const BaseEntityHandler = require('./BaseEntityHandler');
const logger = require('../../../lib/logger');

class ClientHandler extends BaseEntityHandler {
    constructor() {
        super('client', 'clients');
    }

    /**
     * Handle client update with insurer_ids
     * @param {Object} connection - Database connection
     * @param {number} entityId - Client ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context
     * @returns {Promise<void>}
     */
    async update(connection, entityId, newData, context = {}) {
        // Handle insurer_ids relationship
        if (Object.prototype.hasOwnProperty.call(newData, 'insurer_ids')) {
            await this.updateInsurerRelationships(connection, entityId, newData.insurer_ids);
        }
    }

    /**
     * Update insurer relationships for client
     * @param {Object} connection - Database connection
     * @param {number} entityId - Client ID
     * @param {*} insurerIds - Insurer IDs (array or comma-separated string)
     * @returns {Promise<void>}
     */
    async updateInsurerRelationships(connection, entityId, insurerIds) {
        const ids = Array.isArray(insurerIds) 
            ? insurerIds 
            : String(insurerIds || '').split(',').filter(Boolean).map(Number);

        // Delete existing relationships
        await connection.execute(
            'DELETE FROM client_insurers WHERE client_id = ?',
            [entityId]
        );

        // Insert new relationships
        if (ids.length > 0) {
            const values = ids.map((iid) => [entityId, iid]);
            const placeholders = values.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT INTO client_insurers (client_id, insurer_id) VALUES ${placeholders}`,
                values.flat()
            );
        }

        logger.info('Client insurer relationships updated', { entityId, insurerCount: ids.length });
    }
}

module.exports = ClientHandler;
