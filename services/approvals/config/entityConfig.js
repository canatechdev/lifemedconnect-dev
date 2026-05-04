/**
 * Entity Configuration
 * Centralized configuration for all entity types in the approval system
 */

/**
 * Entity to database table mapping
 */
const ENTITY_TABLE_MAP = {
    client: 'clients',
    center: 'diagnostic_centers',
    doctor: 'doctors',
    insurer: 'insurers',
    appointment: 'appointments',
    appointment_import: 'appointments',
    technician: 'technicians',
    test: 'tests',
    test_category: 'test_categories',
    test_rate: 'bulk_test_rates',
    bulk_test_rate: 'bulk_test_rates',
    test_rate_import: 'bulk_test_rates',
    user: 'users'
};

/**
 * Table to primary name column mapping
 */
const TABLE_NAME_COLUMN_MAP = {
    users: 'full_name',
    clients: 'client_name',
    diagnostic_centers: 'center_name',
    insurers: 'insurer_name',
    doctors: 'doctor_name',
    technicians: 'full_name',
    tests: 'test_name',
    test_categories: 'category_name',
    appointments: 'case_number'
};

/**
 * Fields that should be excluded from UPDATE queries globally
 * Includes non-DB metadata fields like 'priority' which live only on approval_queue,
 * not on the underlying entity tables.
 */
const GLOBAL_DISALLOWED_FIELDS = new Set(['updated_at', 'created_at', 'priority']);

/**
 * Fields that should be excluded from UPDATE queries per table
 */
const TABLE_DISALLOWED_FIELDS = {
    appointments: new Set(['total_amount', 'reschedule_reason']),
    clients: new Set(['insurer_ids']),
    test_categories: new Set(['test_ids', 'rate', 'client_id', 'insurer_id']),
    users: new Set(['password', 'password_hash'])
};

/**
 * Field type hints for normalization
 */
const FIELD_TYPE_HINTS = {
    appointments: {
        appointment_date: 'date',
        appointment_time: 'time',
        confirmed_time: 'time'
    },
    clients: {
        validity_period_start: 'date',
        validity_period_end: 'date',
        onboarding_date: 'datetime'
    },
    doctors: {
        date_of_birth: 'date'
    }
};

/**
 * Fields to ignore when comparing changes
 */
const IGNORE_CHANGE_FIELDS = new Set([
    'updated_at', 
    'created_at', 
    'has_pending_approval', 
    'updated_by', 
    'created_by',
    'total_amount',      // Computed field
    'test_ids'           // Computed field
]);

/**
 * Get database table name for entity type
 * @param {string} entityType - Entity type
 * @returns {string|null} Table name or null if not found
 */
const getEntityTable = (entityType) => {
    return ENTITY_TABLE_MAP[entityType] || null;
};

/**
 * Get name column for a table
 * @param {string} table - Table name
 * @returns {string} Name column (defaults to 'id' if not found)
 */
const getNameColumn = (table) => {
    return TABLE_NAME_COLUMN_MAP[table] || 'id';
};

/**
 * Get disallowed fields for a table
 * @param {string} table - Table name
 * @returns {Set} Set of disallowed field names
 */
const getDisallowedFields = (table) => {
    return TABLE_DISALLOWED_FIELDS[table] || new Set();
};

/**
 * Get field type hints for a table
 * @param {string} table - Table name
 * @returns {Object} Field type hints
 */
const getFieldTypeHints = (table) => {
    return FIELD_TYPE_HINTS[table] || {};
};

/**
 * Check if field should be ignored in change detection
 * @param {string} field - Field name
 * @returns {boolean}
 */
const shouldIgnoreField = (field) => {
    return IGNORE_CHANGE_FIELDS.has(field) || field.includes('password');
};

/**
 * Infer table name from field name (best effort)
 * @param {string} field - Field name
 * @returns {string|null} Table name or null
 */
const inferTableFromField = (field) => {
    if (field === 'user_id' || field === 'requested_by' || field === 'reviewed_by') return 'users';
    if (field === 'doctor_id' || field.startsWith('associate_doctor_')) return 'doctors';
    if (field === 'technician_id' || field === 'assigned_technician_id') return 'technicians';
    if (field === 'client_id') return 'clients';
    if (field === 'center_id' || field === 'other_center_id') return 'diagnostic_centers';
    if (field === 'insurer_id') return 'insurers';
    if (field === 'test_id') return 'tests';
    if (field === 'category_id') return 'test_categories';
    return null;
};

module.exports = {
    ENTITY_TABLE_MAP,
    TABLE_NAME_COLUMN_MAP,
    GLOBAL_DISALLOWED_FIELDS,
    TABLE_DISALLOWED_FIELDS,
    FIELD_TYPE_HINTS,
    IGNORE_CHANGE_FIELDS,
    getEntityTable,
    getNameColumn,
    getDisallowedFields,
    getFieldTypeHints,
    shouldIgnoreField,
    inferTableFromField
};
