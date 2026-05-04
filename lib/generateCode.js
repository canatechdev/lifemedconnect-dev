/**
 * Custom code generation utility
 * Generates sequential codes in format: PREFIX/YY/MM/NNNN
 * Example: CASE/26/08/0001, CASE/26/08/0002, etc.
 */
const db = require('../lib/dbconnection');

/**
 * Generate a custom sequential code
 * @param {Object} params - Parameters object
 * @param {string} params.prefix - Code prefix (e.g., 'CASE', 'INV')
 * @param {string} params.table - Database table name
 * @param {string} params.column - Column name containing the code
 * @returns {Promise<string>} Generated code in format PREFIX/YY/MM/NNNN
 */
async function generateCustomCode({ prefix, table, column }) {
    if (!prefix || !table || !column) {
        throw new Error('Missing required parameters: prefix, table, or column');
    }

    const now = new Date();
    const year = String(now.getFullYear()).slice(-2); // two-digit year to reduce yearly collisions
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const likePattern = `${prefix}/${year}/${month}/%`;

    const sql = `
        SELECT ${column}
        FROM ${table}
        WHERE ${column} LIKE ? AND is_deleted = 0
        ORDER BY id DESC
        LIMIT 1
    `;

    const rows = await db.query(sql, [likePattern]);

    let nextNumber = 1;

    if (rows.length > 0) {
        const lastCode = rows[0][column];
        const parts = lastCode.split('/');
        // Expecting PREFIX/YY/MM/NNNN but tolerate legacy PREFIX/MM/NNNN
        const numberIndex = parts.length === 4 ? 3 : 2;
        const lastNum = parseInt(parts[numberIndex], 10);
        if (!isNaN(lastNum)) {
            nextNumber = lastNum + 1;
        }
    }

    const paddedNumber = String(nextNumber).padStart(4, '0');
    const generatedCode = `${prefix}/${year}/${month}/${paddedNumber}`;

    return generatedCode;
}

module.exports = { generateCustomCode };
