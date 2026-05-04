/**
 * Appointment Entity Handler
 * Handles appointment-specific approval logic including test assignments
 */

const BaseEntityHandler = require('./BaseEntityHandler');
const logger = require('../../../lib/logger');

class AppointmentHandler extends BaseEntityHandler {
    constructor() {
        super('appointment', 'appointments');
    }

    /**
     * Handle appointment update with selected_items (test assignments)
     * @param {Object} connection - Database connection
     * @param {number} entityId - Appointment ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context
     * @returns {Promise<void>}
     */
    async update(connection, entityId, newData, context = {}) {
        // Handle selected_items (test assignments)
        if (Object.prototype.hasOwnProperty.call(newData, 'selected_items')) {
            await this.updateSelectedItems(connection, entityId, newData);
        }
    }

    /**
     * Update selected items (test assignments) for appointment
     * @param {Object} connection - Database connection
     * @param {number} entityId - Appointment ID
     * @param {Object} newData - New data containing selected_items
     * @returns {Promise<void>}
     */
    async updateSelectedItems(connection, entityId, newData) {
        console.log(' [APPOINTMENT-HANDLER] Processing selected_items for appointment:', {
            entityId,
            hasSelectedItems: true,
            selectedItemsType: typeof newData.selected_items,
            isArray: Array.isArray(newData.selected_items)
        });

        const selectedItems = newData.selected_items;

        if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
            console.log('[APPOINTMENT-HANDLER] No selected items to process');
            return;
        }

        console.log(' [APPOINTMENT-HANDLER] Selected items count:', selectedItems.length);

        // Get appointment details for center_id and other_center_id
        const [appointmentRows] = await connection.execute(
            'SELECT center_id, other_center_id FROM appointments WHERE id = ?',
            [entityId]
        );

        if (appointmentRows.length === 0) {
            console.error(' [APPOINTMENT-HANDLER] Appointment not found:', entityId);
            throw new Error('Appointment not found');
        }

        const appointment = appointmentRows[0];
        console.log(' [APPOINTMENT-HANDLER] Appointment centers:', {
            center_id: appointment.center_id,
            other_center_id: appointment.other_center_id
        });

        // SMART DELETION: Only delete tests for centers being updated
        const centersBeingUpdated = [...new Set(selectedItems.map(item => item.assigned_center_id).filter(Boolean))];
        console.log(' [APPOINTMENT-HANDLER] Centers being updated:', centersBeingUpdated);

        if (centersBeingUpdated.length > 0) {
            // Selective deletion - only delete tests for centers being updated
            const placeholders = centersBeingUpdated.map(() => '?').join(',');
            const [deleteResult] = await connection.execute(
                `DELETE FROM appointment_tests WHERE appointment_id = ? AND assigned_center_id IN (${placeholders})`,
                [entityId, ...centersBeingUpdated]
            );
            console.log(' [APPOINTMENT-HANDLER] Selectively deleted tests for specific centers:', {
                deletedCount: deleteResult.affectedRows,
                centersAffected: centersBeingUpdated
            });
        } else {
            // Fallback: Delete all tests (backward compatibility)
            const [deleteResult] = await connection.execute(
                'DELETE FROM appointment_tests WHERE appointment_id = ?',
                [entityId]
            );
            console.log(' [APPOINTMENT-HANDLER] Deleted all tests (no center filter):', deleteResult.affectedRows);
        }

        // Insert new tests
        const testSql = `
            INSERT INTO appointment_tests (
                appointment_id, test_id, category_id, rate_type, item_name, rate,
                assigned_center_id, assigned_technician_id, visit_subtype, status,
                is_completed, created_at, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0, NOW(), ?)
        `;

        for (const item of selectedItems) {
            // CRITICAL: Validate that we have the correct ID (test_id or category_id, NOT appointment_tests.id)
            const actualId = item.type === 'test' ? item.id : item.id;

            // Sanity check: If this looks like an appointment_tests.id (very low number after recent inserts), warn
            if (actualId < 100 && !item.test_id && !item.category_id) {
                console.warn(' [APPOINTMENT-HANDLER] Suspicious ID detected - might be appointment_tests.id instead of test/category ID:', {
                    item_id: item.id,
                    item_type: item.type,
                    item_name: item.name,
                    has_test_id: !!item.test_id,
                    has_category_id: !!item.category_id
                });
            }

            // Determine assigned_center_id
            let assignedCenterId = null;

            if (item.assigned_center_id) {
                assignedCenterId = item.assigned_center_id;
                console.log(' [APPOINTMENT-HANDLER] Using direct assigned_center_id:', assignedCenterId);
            } else if (item.assigned_to === 'center2' && appointment.other_center_id) {
                assignedCenterId = appointment.other_center_id;
                console.log(' [APPOINTMENT-HANDLER] Using center2 mapping:', assignedCenterId);
            } else {
                assignedCenterId = appointment.center_id;
                console.log(' [APPOINTMENT-HANDLER] Using default center_id:', assignedCenterId);
            }

            const visitSubtype = item.assigned_technician_id ? 'home' : (item.visit_subtype || 'center');

            const testParams = [
                entityId,
                item.type === 'test' ? item.id : null,
                item.type === 'category' ? item.id : null,
                item.type,
                item.name,
                parseFloat(item.rate),
                assignedCenterId,
                item.assigned_technician_id || null,
                visitSubtype,
                newData.updated_by || null
            ];

            console.log(' [APPOINTMENT-HANDLER] Inserting test:', {
                appointment_id: entityId,
                test_id: item.type === 'test' ? item.id : null,
                category_id: item.type === 'category' ? item.id : null,
                item_name: item.name,
                assigned_center_id: assignedCenterId,
                visit_subtype: visitSubtype
            });

            try {
                const [insertResult] = await connection.execute(testSql, testParams);
                console.log(' [APPOINTMENT-HANDLER] Test inserted:', insertResult.insertId);
            } catch (insertError) {
                console.error(' [APPOINTMENT-HANDLER] Failed to insert test:', {
                    error: insertError.message,
                    item: item,
                    testParams: testParams
                });
                throw insertError;
            }
        }

        console.log(' [APPOINTMENT-HANDLER] All tests processed successfully');
    }
}

module.exports = AppointmentHandler;
