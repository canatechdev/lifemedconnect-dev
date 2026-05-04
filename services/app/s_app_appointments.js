const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');

function parseTestsData(tests) {
    try {
        if (!tests) return [];
        if (Array.isArray(tests)) return tests;
        if (typeof tests === 'object') return [tests];
        if (typeof tests === 'string') {
            const trimmed = tests.trim();
            if (!trimmed) return [];
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [parsed];
        }
        return [];
    } catch (error) {
        logger.error('Error parsing tests data (app technician)', { error: error.message });
        return [];
    }
}

async function getTechnicianIdByUser(userId) {
    const rows = await db.query(
        'SELECT id FROM technicians WHERE user_id = ? AND is_deleted = 0 LIMIT 1',
        [userId]
    );
    return rows[0]?.id || null;
}

async function listTechnicianAppointments({ userId, page = 1, limit = 10, search = '', upcomingOnly = false, todayOnly = false, statusGroup = null }) {
    const technicianId = await getTechnicianIdByUser(userId);
    if (!technicianId) {
        return { data: [], pagination: { total: 0, page, limit, pages: 0 } };
    }

    const searchParams = [technicianId];
    const conditions = ['at.assigned_technician_id = ?'];

    if (search) {
        conditions.push(`(
            a.case_number LIKE ? OR 
            a.customer_first_name LIKE ? OR 
            a.customer_last_name LIKE ?
        )`);
        const like = `%${search}%`;
        searchParams.push(like, like, like);
    }

    // Use home_confirmed_at for BOTH; confirmed_date otherwise (no appointment_date fallback)
    const confirmDateExpr = `CASE WHEN LOWER(a.visit_type) = 'both' THEN a.home_confirmed_at ELSE a.confirmed_date END`;

    if (todayOnly) {
        // Normalize to IST (+05:30) to match local app day boundaries
        conditions.push(`DATE(CONVERT_TZ(${confirmDateExpr}, '+00:00', '+05:30')) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))`);
        // Exclude completed appointments from today's list
        conditions.push(`(a.medical_status NOT IN ('medical_completed', 'completed') OR a.medical_status IS NULL)`);
        conditions.push(`(a.home_medical_status NOT IN ('medical_completed', 'completed') OR a.home_medical_status IS NULL)`);
        conditions.push(`a.status NOT IN ('completed', 'medical_completed')`);
    } else if (upcomingOnly) {
        conditions.push(`${confirmDateExpr} IS NOT NULL`);
        conditions.push(`${confirmDateExpr} > CURDATE()`); // tomorrow onwards
        // Exclude completed/medical_completed from upcoming list
        conditions.push(`(a.medical_status NOT IN ('medical_completed', 'completed') OR a.medical_status IS NULL)`);
        conditions.push(`(a.home_medical_status NOT IN ('medical_completed', 'completed') OR a.home_medical_status IS NULL)`);
        conditions.push(`a.status NOT IN ('completed', 'medical_completed')`);
    }

    if (statusGroup === 'completed') {
        conditions.push(`(
            a.medical_status IN ('completed', 'medical_completed') OR
            a.home_medical_status IN ('completed', 'medical_completed') 
        )`);
    } else if (statusGroup === 'pending') {
        conditions.push(`a.medical_status NOT IN ('completed', 'medical_completed')`);
        conditions.push(`(a.home_medical_status NOT IN ('completed', 'medical_completed') OR a.home_medical_status IS NULL)`);
        conditions.push(`a.status NOT IN ('completed', 'medical_completed')`);
        // Keep explicit pending statuses but exclusion of completion is more important here
        // conditions.push(`a.medical_status IN ('pending','rescheduled','scheduled','arrived','in_process','partially_completed','medical_partially_completed')`);
    }

    conditions.push('a.is_deleted = 0');
    // Exclude pushed back appointments from technician lists
    conditions.push('(a.pushed_back = 0 OR a.pushed_back IS NULL)');
    conditions.push('a.status != "pushed_back"');

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `
        SELECT COUNT(DISTINCT a.id) as total 
        FROM appointments a
        JOIN appointment_tests at ON a.id = at.appointment_id
        ${whereClause}
    `;

    const dataSql = `
        SELECT 
            a.id,
            a.case_number,
            a.application_number,
            a.client_id,
            a.center_id,
            dc.center_name AS center_name,
            a.other_center_id,
            odc.center_name AS other_center_name,
            a.insurer_id,
            i.insurer_name,
            a.visit_type,
            DATE_FORMAT(a.appointment_date, '%d-%m-%Y') AS appointment_date,
            CASE 
                WHEN a.appointment_time REGEXP '^[0-9]{2}:[0-9]{2}:[0-9]{2}$' 
                THEN DATE_FORMAT(CONCAT(CURRENT_DATE(), ' ', a.appointment_time), '%h:%i %p')
                ELSE a.appointment_time
            END AS appointment_time,
            CASE
                WHEN LOWER(a.visit_type) = 'both' THEN DATE_FORMAT(a.home_confirmed_at, '%d-%m-%Y')
                ELSE DATE_FORMAT(a.confirmed_date, '%d-%m-%Y')
            END AS confirmed_date,
            CASE
                WHEN LOWER(a.visit_type) = 'both' THEN DATE_FORMAT(a.home_confirmed_at, '%h:%i %p')
                ELSE DATE_FORMAT(CONCAT(CURRENT_DATE(), ' ', COALESCE(a.confirmed_time, '00:00:00')), '%h:%i %p')
            END AS confirmed_time,
            CASE 
                WHEN LOWER(a.visit_type) = 'both' THEN a.home_medical_status
                ELSE a.medical_status
            END AS medical_status,
            a.home_medical_status,
            a.split_type,
            a.status AS appointment_status,\n            a.reschedule_remark,\n            a.center_reschedule_remark,\n            a.home_reschedule_remark,
            a.customer_first_name,
            a.customer_last_name,
            a.customer_mobile,
            a.customer_address,
            a.customer_landmark,
            a.city,
            a.state,
            a.pincode,
            a.pushed_back,
            c.client_name,
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'id', at.id,
                    'test_id', at.test_id,
                    'category_id', at.category_id,
                    'rate_type', at.rate_type,
                    'item_name', at.item_name,
                    'rate', at.rate,
                    'visit_subtype', at.visit_subtype,
                    'assigned_center_id', at.assigned_center_id,
                    'assigned_technician_id', at.assigned_technician_id,
                    'status', at.status,
                    'is_completed', at.is_completed,
                    'description', COALESCE(t.description, tc.description)
                )
            ) as tests
        FROM appointments a
        JOIN appointment_tests at ON a.id = at.appointment_id
        LEFT JOIN tests t ON at.test_id = t.id
        LEFT JOIN test_categories tc ON at.category_id = tc.id
        LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
        LEFT JOIN diagnostic_centers odc ON a.other_center_id = odc.id
        LEFT JOIN clients c ON a.client_id = c.id
        LEFT JOIN insurers i ON a.insurer_id = i.id
        ${whereClause}
        GROUP BY a.id
        ORDER BY 
            CASE 
                WHEN LOWER(a.visit_type) = 'both' THEN 
                    CASE 
                        WHEN a.home_confirmed_at IS NOT NULL THEN 
                            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), a.home_confirmed_at)
                        ELSE 
                            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), CONCAT(a.confirmed_date, ' ', COALESCE(a.confirmed_time, '00:00:00')))
                    END
                ELSE 
                    CASE 
                        WHEN a.confirmed_date IS NOT NULL THEN 
                            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), CONCAT(a.confirmed_date, ' ', COALESCE(a.confirmed_time, '00:00:00')))
                        ELSE 
                            TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), CONCAT(a.appointment_date, ' ', COALESCE(a.appointment_time, '00:00:00')))
                    END
                END
            ASC
    `;

    const countRows = await db.query(countSql, searchParams);
    const total = countRows[0]?.total || 0;

    const numericLimit = Number(limit);
    const numericPage = Number(page);
    const offset = numericLimit > 0 ? (numericPage - 1) * numericLimit : 0;

    let paginatedSql = dataSql;
    if (numericLimit > 0) {
        paginatedSql += ` LIMIT ${numericLimit} OFFSET ${offset}`;
    }

    let rows = await db.query(paginatedSql, searchParams);
    rows = rows.map(row => ({
        ...row,
        tests: parseTestsData(row.tests)
    }));

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

async function getTechnicianAppointmentDetails({ userId, appointmentId }) {
    const technicianId = await getTechnicianIdByUser(userId);
    if (!technicianId) {
        return null;
    }

    const rows = await db.query(
        `
        SELECT 
            a.id,
            a.case_number,
            a.application_number,
            a.client_id,
            c.client_name,
            a.center_id,
            dc.center_name AS center_name,
            a.other_center_id,
            odc.center_name AS other_center_name,
            a.insurer_id,
            i.insurer_name,
            a.visit_type,
            DATE_FORMAT(a.appointment_date, '%d-%m-%Y') AS appointment_date,
            CASE 
                WHEN a.appointment_time REGEXP '^[0-9]{2}:[0-9]{2}:[0-9]{2}$' 
                THEN DATE_FORMAT(CONCAT(CURRENT_DATE(), ' ', a.appointment_time), '%h:%i %p')
                ELSE a.appointment_time
            END AS appointment_time,
            CASE
                WHEN LOWER(a.visit_type) = 'both' THEN DATE_FORMAT(a.home_confirmed_at, '%d-%m-%Y')
                ELSE DATE_FORMAT(a.confirmed_date, '%d-%m-%Y')
            END AS confirmed_date,
            CASE
                WHEN LOWER(a.visit_type) = 'both' THEN DATE_FORMAT(a.home_confirmed_at, '%h:%i %p')
                ELSE DATE_FORMAT(CONCAT(CURRENT_DATE(), ' ', COALESCE(a.confirmed_time, '00:00:00')), '%h:%i %p')
            END AS confirmed_time,
            CASE 
                WHEN LOWER(a.visit_type) = 'both' THEN a.home_medical_status
                ELSE a.medical_status
            END AS medical_status,
            a.home_medical_status,
            a.split_type,
            a.status AS appointment_status,\n            a.reschedule_remark,\n            a.center_reschedule_remark,\n            a.home_reschedule_remark,
            a.customer_first_name,
            a.customer_last_name,
            a.customer_mobile,
            a.customer_address,
            a.customer_landmark,
            a.city,
            a.state,
            a.pincode,
            a.customer_gps_latitude,
            a.customer_gps_longitude,
            a.pushed_back,
            a.pending_report_types,
            a.medical_remarks,
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'id', at.id,
                    'test_id', at.test_id,
                    'category_id', at.category_id,
                    'rate_type', at.rate_type,
                    'item_name', at.item_name,
                    'rate', at.rate,
                    'visit_subtype', at.visit_subtype,
                    'assigned_center_id', at.assigned_center_id,
                    'assigned_technician_id', at.assigned_technician_id,
                    'status', at.status,
                    'is_completed', at.is_completed,
                    'description', COALESCE(t.description, tc.description)
                )
            ) as tests
        FROM appointments a
        JOIN appointment_tests at 
            ON a.id = at.appointment_id 
            AND at.assigned_technician_id = ?
        LEFT JOIN tests t ON at.test_id = t.id
        LEFT JOIN test_categories tc ON at.category_id = tc.id
        LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
        LEFT JOIN diagnostic_centers odc ON a.other_center_id = odc.id
        LEFT JOIN clients c ON a.client_id = c.id
        LEFT JOIN insurers i ON a.insurer_id = i.id
        WHERE a.id = ? AND a.is_deleted = 0
        GROUP BY a.id
        LIMIT 1
        `,
        [technicianId, appointmentId]
    );

    if (!rows.length) return null;

    return {
        ...rows[0],
        tests: parseTestsData(rows[0].tests)
    };
}

async function getTechnicianContextForAppointment(appointmentId, userId) {
    const technicianId = await getTechnicianIdByUser(userId);
    if (!technicianId) {
        return { technicianId: null, owns: false };
    }

    const rows = await db.query(
        `SELECT 1 
         FROM appointment_tests at 
         JOIN appointments a ON a.id = at.appointment_id 
         WHERE at.appointment_id = ? 
           AND at.assigned_technician_id = ? 
           AND a.is_deleted = 0
         LIMIT 1`,
        [appointmentId, technicianId]
    );

    return { technicianId, owns: rows.length > 0 };
}

module.exports = {
    listTechnicianAppointments,
    getTechnicianIdByUser,
    getTechnicianAppointmentDetails,
    getTechnicianContextForAppointment,
    // Convenience wrapper for today
    listTechnicianTodayAppointments: (params) => listTechnicianAppointments({ ...params, todayOnly: true }),
};
