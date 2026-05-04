const db = require('../lib/dbconnection');
const { generateCustomCode } = require('../lib/generateCode');

async function createTechnician(row) {
    // Generate technician_code if missing (year/month/sequence)
    if (!row.technician_code || String(row.technician_code).trim() === '') {
        row.technician_code = await generateCustomCode({
            prefix: 'TECH',
            table: 'technicians',
            column: 'technician_code'
        });
    }

    const sql = `INSERT INTO technicians (user_id, center_id, technician_code, technician_type, rate_per_appointment, profile_pic, full_name, mobile, email, home_gps_latitude, home_gps_longitude, home_address, qualification, experience_years, is_active ,created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
    const params = [
        row.user_id ?? null,
        row.center_id,
        row.technician_code,
        row.technician_type || 'In-House',
        row.rate_per_appointment ?? 0.00,
        row.profile_pic || null,
        row.full_name,
        row.mobile,
        row.email || null,
        row.home_gps_latitude ?? null,
        row.home_gps_longitude ?? null,
        row.home_address || null,
        row.qualification || null,
        row.experience_years ?? null,
        row.is_active ?? 1
    ];
    const result = await db.query(sql, params);
    return result.insertId;
}

// async function listTechnicians() { return db.query('SELECT * FROM technicians'); }

async function listTechnicians({ page = 1, limit = 0, search = '', sortBy = 'id', sortOrder = 'DESC', center_id = null, include_city_technicians = false, user_center_city = null }) {
    const searchColumns = ['full_name', 'email', 'mobile', 'technician_code'];
    const searchParams = [];
    let whereClause = '';

    if (search && search.trim() !== '') {
        const conditions = searchColumns.map(col => `${col} LIKE ?`).join(' OR ');
        whereClause = ` WHERE (${conditions}) AND is_deleted = 0`;
        searchColumns.forEach(() => searchParams.push(`%${search}%`));
    } else {
        whereClause = ' WHERE is_deleted = 0';
    }

    // Add center_id filter if provided (for center users to see only their technicians)
    if (center_id) {
        if (include_city_technicians && user_center_city) {
            // Include technicians from same city (case-insensitive)
            whereClause += ` AND (center_id = ? OR center_id IN (
                SELECT id FROM diagnostic_centers WHERE 
                LOWER(TRIM(city)) = LOWER(TRIM(?)) AND is_deleted = 0
            ))`;
            searchParams.push(center_id, user_center_city);
        } else {
            // Original behavior - only own center technicians
            whereClause += ` AND center_id = ?`;
            searchParams.push(center_id);
        }
    }

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = [
        'id',
        'technician_code',
        'full_name',
        'mobile',
        'email',
        'is_active',
        'created_at'
    ];
    const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count total records
    const countSql = `SELECT COUNT(*) as total FROM technicians${whereClause}`;
    const countRows = await db.query(countSql, searchParams);
    const total = countRows[0].total;

    // Paginated records
    let dataSql = `SELECT * FROM technicians${whereClause} ORDER BY ${validSortBy} ${validSortOrder}`;
    const dataParams = [...searchParams];

    const numericLimit = Number(limit);
    const numericPage = Number(page);

    if (!isNaN(numericLimit) && numericLimit > 0) {
        const offset = (numericPage - 1) * numericLimit;
        dataSql += ` LIMIT ${numericLimit} OFFSET ${offset}`;
    }

    const rows = await db.query(dataSql, dataParams);

    return {
        data: rows,
        pagination: {
            total,
            page: numericPage,
            limit: numericLimit,
            pages: numericLimit > 0 ? Math.ceil(total / numericLimit) : 1,
        },
    };
}





async function getTechnician(id) { const r = await db.query('SELECT * FROM technicians WHERE id = ?', [id]); return r[0]; }
async function updateTechnician(id, updates) {
    const fields = []; const values = [];
    Object.entries(updates).forEach(([k, v]) => { if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); } });
    if (!fields.length) return 0;
    const sql = `UPDATE technicians SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    values.push(id);
    const result = await db.query(sql, values); return result.affectedRows;
}


// soft delete Technicians
async function softDeleteTechnician(ids) {
    if (!ids.length) return 0;

    const placeholders = ids.map(() => '?').join(', ');
    const sql = `UPDATE technicians SET is_deleted = 1, updated_at = NOW() WHERE id IN (${placeholders})`;

    const result = await db.query(sql, ids);

    return result.affectedRows;
}


async function deleteTechnician(id) { const result = await db.query('DELETE FROM technicians WHERE id = ?', [id]); return result.affectedRows; }





module.exports = { createTechnician, listTechnicians, getTechnician, updateTechnician, deleteTechnician, softDeleteTechnician };


