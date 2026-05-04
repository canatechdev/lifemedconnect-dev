/**
 * Appointment Pathology Data Management
 * Fetches pathology data from external API and generates PDF reports
 */

const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { parseApiDate, isAbnormal, getLetterheadDataUrl, safeText, unwrapRows, buildPdfHtml, generatePdfBuffer, getStandardMargins } = require('../../lib/pdfUtils');
const { sanitizeFolderName } = require('../../lib/fileUpload');

/**
 * Generate pathology report content HTML (without header/footer wrapper)
 * This content is inserted into the standardized PDF template
 */
function generatePathologyContent(data, appointmentInfo) {
    // Group data by SubDeptName (department)
    const grouped = {};
    data.forEach(item => {
        const dept = item.SubDeptName || 'Other';
        if (!grouped[dept]) {
            grouped[dept] = {};
        }
        
        const testName = item.TestName || 'Unknown Test';
        if (!grouped[dept][testName]) {
            grouped[dept][testName] = [];
        }
        
        grouped[dept][testName].push(item);
    });
    
    const patientName = data[0]?.PatName || `${appointmentInfo.customer_first_name || ''} ${appointmentInfo.customer_last_name || ''}`.trim() || 'N/A';
    const patRegID = data[0]?.PatRegID || appointmentInfo.case_number || 'N/A';
    const reportDate = data[0]?.PatRepDate ? parseApiDate(data[0].PatRepDate) : 'N/A';
    const age = data[0]?.Age || 'N/A';
    const gender = data[0]?.Gender || 'N/A';
    const referedBy = data[0]?.ReferedBy ? data[0].ReferedBy.trim() : 'N/A';
    const regOnDate = data[0]?.RegOnDate ? parseApiDate(data[0].RegOnDate) : 'N/A';
    const reportOnDate = data[0]?.ReportOnDate ? parseApiDate(data[0].ReportOnDate) : 'N/A';
    const printedOnDate = data[0]?.PrintedOnDate ? parseApiDate(data[0].PrintedOnDate) : 'N/A';

    // Patient info card HTML for Puppeteer header (table layout, appears on every page)
    // LHS: Patient Name, ID, Age, Gender, Refered By | RHS: Reg Date, Report Date, Printed On
    const patientInfoHeaderHtml = `
    <table style="width:90%;background:#f8f9fa;border:1px solid #dee2e6;border-collapse:collapse;font-family:'Segoe UI',Arial,sans-serif;">
        <tr>
            <td style="padding:2pt 2pt;width:50%;vertical-align:top;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Patient Name : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${patientName}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">ID : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${patRegID}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Age : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${age}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Gender : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${gender}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Refered By : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${referedBy}</span></td></tr>
                </table>
            </td>
            <td style="padding:2pt 2pt;width:50%;vertical-align:top;border-right:1px solid #dee2e6;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Reg Date : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${regOnDate}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Report Date : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${reportOnDate}</span></td></tr>
                    <tr><td style="padding:1pt 2pt;"><span style="font-size:6pt;color:#495057;text-transform:uppercase;font-weight:600;">Printed On : </span> <span style="font-size:7pt;color:#212529;font-weight:600;">${printedOnDate}</span></td></tr>
                </table>
            </td>
        </tr>
    </table>`;

    let content = '';
    
 // Generate sections for each department in specific order using SDCode for robustness
    const deptOrder = ['HT', 'BC', 'SP', 'CP']; // SDCode order: HAEMATOLOGY > BIOCHEMISTRY > SPECIAL TEST > CLINICAL PATHOLOGY
    
    // Create a mapping of SDCode to department names for display
    const sdCodeToDeptName = {};
    Object.keys(grouped).forEach(deptName => {
        const firstTest = grouped[deptName][Object.keys(grouped[deptName])[0]][0];
        const sdCode = firstTest?.SDCode || 'OTHER';
        sdCodeToDeptName[sdCode] = deptName;
    });
    
    // Sort by SDCode instead of department name
    const sortedSdCodes = Object.keys(sdCodeToDeptName).sort((a, b) => {
        const indexA = deptOrder.indexOf(a);
        const indexB = deptOrder.indexOf(b);
        
        // Both in order: use array order
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        
        // A in order, B not: A comes first
        if (indexA !== -1 && indexB === -1) return -1;
        
        // B in order, A not: B comes first  
        if (indexB !== -1 && indexA === -1) return 1;
        
        // Both not in order: alphabetical
        return a.localeCompare(b);
    });
    sortedSdCodes.forEach((sdCode, idx) => {
        const deptName = sdCodeToDeptName[sdCode];
        // Add a class for page break on every department except first
        const pageBreakClass = idx > 0 ? 'new-page-dept' : '';
        content += '<div class="department-section ' + pageBreakClass + '">' +
            '<div class="department-header">' + deptName + '</div>';
        
        // Generate sections for each test in the department
        const testNames = Object.keys(grouped[deptName]).sort();
        let testCount = 0;
        
        testNames.forEach(testName => {
            const parameters = grouped[deptName][testName];
            
            const method = parameters[0]?.Method ? parameters[0].Method.trim() : '';
            const methodHtml = method ? '<div class="test-method">Method: ' + method + '</div>' : '';
            
            // Add department header every 5 tests to simulate header repetition on new pages
            if (testCount > 0 && testCount % 5 === 0) {
                content += '<div class="department-header repeated-header">' + deptName + '</div>';
            }
            
            content += '<div class="test-box">' +
            '<div class="test-header-bar">' + testName + '</div>' +
            (methodHtml || '') +
            '<table class="pathology-table">' +
                '<thead><tr><th style="width: 35%;">Test</th><th style="width: 20%;">Result</th><th style="width: 15%;">Unit</th><th style="width: 30%;">Biological Ref Range</th></tr></thead>' +
                '<tbody>';
            
            parameters.forEach(param => {
                const abnormal = isAbnormal(param.Result, param.NormalRange);
                const rowClass = abnormal ? 'abnormal' : '';
                const marker = abnormal ? '<span class="abnormal-marker">ABNORMAL</span>' : '';
                
                content += '<tr class="' + rowClass + '"><td><strong>' + (param.ParameterName || 'N/A') + '</strong></td><td><strong>' + (param.Result || 'N/A') + marker + '</strong></td><td>' + (param.Unit || '-') + '</td><td>' + (param.NormalRange || '-') + '</td></tr>';
            });
            
            content += '</tbody></table></div>';
            testCount++;
        });
        
        content += '</div><div class="section-end-separator">---- ' + deptName + ' Ends ----</div>';
    });
    
        
    content += '<div class="pathology-note">' +
        '<p><strong>Note:</strong> Abnormal values are highlighted in red for easy identification.</p>' +
        '<p style="margin-top: 5px;">Generated on ' + new Date().toLocaleString('en-IN') + '</p>' +
        '</div>';
    
        
    return { content, patientInfoHeaderHtml };
}

/**
 * Generate additional CSS for pathology reports
 */
function getPathologyStyles() {
    return `
        .department-section {
            margin: 3pt 0;
            page-break-inside: auto;
            page-break-before: auto;
            page-break-after: auto;
        }
        
        /* NEW RULE: force a page break before every department EXCEPT the first */
        .department-section.new-page-dept {
            page-break-before: always;
            break-before: page;
        }
        
        .department-header {
            background: linear-gradient(135deg, #0066cc 0%, #004999 100%);
            color: white;
            padding: 3pt 6pt;
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            border-left: 2px solid #003d7a;
            border-radius: 0;
            margin-bottom: 3pt;
            page-break-after: avoid;
            break-after: avoid;
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-before: auto;
        }
        
        .department-header.repeated-header {
            background: linear-gradient(135deg, #0066cc 0%, #004999 100%);
            border-left: 2px solid #003d7a;
            opacity: 0.9;
            margin-top: 8pt;
        }
        
        /* Ensure department sections don't break awkwardly */
        .department-section {
            page-break-inside: avoid;
            page-break-before: auto;
        }
        
        /* Force page break before departments (except first) */
        .department-section.new-page-dept {
            page-break-before: always;
            break-before: page;
        }
        
        .test-box {
            margin-bottom: 4pt;
            border: 1px solid #dee2e6;
            border-radius: 0;
            background: white;
            page-break-inside: auto;
        }
        
        .test-header-bar {
            background: #e7f3ff;
            padding: 2pt 5pt;
            font-weight: 600;
            font-size: 7pt;
            color: #004999;
            border-bottom: 1pt solid #0066cc;
            text-transform: uppercase;
            letter-spacing: 0.2px;
        }
        
        .test-method {
            font-weight: 600;
            font-style: italic;
            font-size: 6pt;
            color: #212529;
            padding: 1pt 5pt;
            background: #f8f9fa;
            border-bottom: 1pt solid #dee2e6;
            text-transform: none;
        }
        
        .pathology-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .pathology-table th {
            padding: 3pt 5pt;
            text-align: left;
            font-size: 7pt;
            font-weight: 700;
            color: #495057;
            text-transform: uppercase;
            background: #f1f5f9;
            border-bottom: 1pt solid #cbd5e1;
        }
        
        .pathology-table td {
            padding: 2pt 5pt;
            font-size: 7pt;
            border-bottom: 0.3pt solid #e2e8f0;
            color: #212529;
        }
        
        .pathology-table tbody tr:nth-child(even) {
            background: #f8fafc;
        }
        
        .pathology-table tbody tr.abnormal {
            background: #fef2f2 !important;
            border-left: 1pt solid #dc2626;
        }
        
        .pathology-table tbody tr.abnormal td {
            color: #dc2626;
            font-weight: 600;
        }
        
        .abnormal-marker {
            display: inline-block;
            background: #dc2626;
            color: white;
            padding: 0.5pt 2pt;
            border-radius: 0;
            font-size: 5pt;
            font-weight: 700;
            margin-left: 2pt;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        
        .pathology-note {
            margin-top: 4pt;
            padding: 3pt 5pt;
            background: #f1f5f9;
            border-radius: 0;
            border-left: 2pt solid #0066cc;
            font-size: 6pt;
            color: #475569;
        }
        
        .pathology-note strong {
            color: #dc2626;
        }
        
        .section-end-separator {
            text-align: center;
            margin: 4pt 0;
            padding: 2pt;
            font-size: 6pt;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 1px;
            border-top: 1px dashed #cbd5e1;
            border-bottom: 1px dashed #cbd5e1;
            background: #f9fafb;
        }
    `;
}


/**
 * Fetch pathology data from external API and generate PDF
 */
async function fetchAndSavePathologyData(appointmentId, userId) {
    const connection = await db.pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Get appointment details with center/technician info
        const [appointment] = await connection.query(`
            SELECT 
                a.case_number,
                a.customer_first_name,
                a.customer_last_name,
                a.gender,
                a.customer_mobile,
                a.customer_email,
                a.customer_address,
                a.city,
                a.state,
                a.pincode,
                a.appointment_date,
                a.center_id,
                a.other_center_id,
                a.visit_type,
                c1.center_name as center_name,
                c1.letterhead_path as center_letterhead,
                c1.footer_path as center_footer,
                c1.address as center_address,
                c1.contact_number as center_contact,
                c2.center_name as other_center_name,
                c2.letterhead_path as other_center_letterhead,
                c2.footer_path as other_center_footer
            FROM appointments a
            LEFT JOIN diagnostic_centers c1 ON a.center_id = c1.id
            LEFT JOIN diagnostic_centers c2 ON a.other_center_id = c2.id
            WHERE a.id = ?
        `, [appointmentId]);
        
        if (!appointment || appointment.length === 0) {
            throw new Error('Appointment not found');
        }
        
        const appt = appointment[0];
        const caseNumber = appt.case_number;
        const customerName = `${appt.customer_first_name || ''} ${appt.customer_last_name || ''}`.trim();
        
        // Determine which letterhead and footer to use based on visit type
        let letterheadPath = null;
        let footerPath = null;
        if (appt.visit_type === 'Both') {
            // For both, prefer center_id letterhead and footer
            letterheadPath = appt.center_letterhead || appt.other_center_letterhead;
            footerPath = appt.center_footer || appt.other_center_footer;
        } else if (appt.visit_type === 'Home_Visit') {
            letterheadPath = appt.other_center_letterhead || appt.center_letterhead;
            footerPath = appt.other_center_footer || appt.center_footer;
        } else {
            letterheadPath = appt.center_letterhead;
            footerPath = appt.center_footer;
        }
        
        // Determine PID based on test mode
        const testMode = process.env.PATHOLOGY_TEST_MODE === 'true';
        // Convert case number format from / to - for API compatibility
        const convertedCaseNumber = caseNumber.replace(/\//g, '-');
        const pid = testMode ? process.env.PATHOLOGY_TEST_PID : convertedCaseNumber;
        
        logger.info('Fetching pathology data', { appointmentId, caseNumber, pid, testMode });
        
        let response;
        try {
            // Fetch data from external API
            const apiUrl = process.env.PATHOLOGY_API_URL;
            response = await axios.get(apiUrl, {
                params: { pid },
                timeout: 30000
            });
        } catch (axiosError) {
            logger.error('Pathology API error', { 
                appointmentId, 
                caseNumber, 
                pid, 
                error: axiosError.message 
            });
            throw new Error('No pathology data found for this case number');
        }
        
        const pathologyData = response.data;
        
        // Check if pathology data exists
        if (!pathologyData || !Array.isArray(pathologyData) || pathologyData.length === 0) {
            logger.warn('No pathology data found', { appointmentId, caseNumber, pid });
            throw new Error('No pathology data found for this case number');
        }
        
        // Generate content HTML using standardized template
        const { content, patientInfoHeaderHtml } = generatePathologyContent(pathologyData, appt);
        
        // Convert header/footer paths to data URLs for reliable embedding
        const baseDir = path.resolve(__dirname, '../../');
        const headerDataUrl = letterheadPath ? await getLetterheadDataUrl(letterheadPath, baseDir, logger) : null;
        const footerDataUrl = footerPath ? await getLetterheadDataUrl(footerPath, baseDir, logger) : null;
        
        const html = buildPdfHtml({
            content,
            title: `Pathology Report - ${caseNumber}`,
            customStyles: getPathologyStyles()
        });
        
        // Create uploads directory if not exists (organized by case_number)
        const safeCaseFolder = sanitizeFolderName(caseNumber);
        const uploadsDir = safeCaseFolder
            ? path.join(__dirname, '../../uploads/pathology', safeCaseFolder)
            : path.join(__dirname, '../../uploads/pathology');
        await fs.mkdir(uploadsDir, { recursive: true });
        
        // Generate PDF filename
        const timestamp = Date.now();
        const pdfFilename = `pathology_${appointmentId}_${timestamp}.pdf`;
        const pdfPath = path.join(uploadsDir, pdfFilename);
        
        // Generate PDF (Puppeteer launched/closed inside generatePdfBuffer)
        const headerHeightMm = 55;
        const footerHeightMm = 24;

        await generatePdfBuffer({
            html,
            path: pdfPath,
            headerDataUrl,
            footerDataUrl,
            headerHeightMm,
            footerHeightMm,
            customHeaderHtml: patientInfoHeaderHtml,
            margin: getStandardMargins(headerHeightMm, footerHeightMm)
        });
        
        logger.info('PDF generated successfully', { pdfPath });
        
        // Save to database (upsert)
        const relativePdfPath = safeCaseFolder
            ? `uploads/pathology/${safeCaseFolder}/${pdfFilename}`
            : `uploads/pathology/${pdfFilename}`;
        
        // Check if record exists
        const [existing] = await connection.query(
            'SELECT id FROM appointment_pathology_data WHERE appointment_id = ?',
            [appointmentId]
        );
        
        if (existing && existing.length > 0) {
            // Update existing record
            await connection.query(
                `UPDATE appointment_pathology_data 
                SET case_number = ?, data_json = ?, pdf_path = ?, fetched_at = NOW(), fetched_by = ?, updated_at = NOW()
                WHERE appointment_id = ?`,
                [caseNumber, JSON.stringify(pathologyData), relativePdfPath, userId, appointmentId]
            );
        } else {
            // Insert new record
            await connection.query(
                `INSERT INTO appointment_pathology_data 
                (appointment_id, case_number, data_json, pdf_path, fetched_at, fetched_by)
                VALUES (?, ?, ?, ?, NOW(), ?)`,
                [appointmentId, caseNumber, JSON.stringify(pathologyData), relativePdfPath, userId]
            );
        }
        
        await connection.commit();
        
        logger.info('Pathology data saved successfully', { appointmentId });
        
        return {
            success: true,
            message: 'Pathology data fetched and PDF generated successfully',
            pdfPath: relativePdfPath,
            recordCount: pathologyData.length
        };
        
    } catch (error) {
        await connection.rollback();
        logger.error('Error fetching pathology data:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Get pathology data for an appointment
 */
async function getPathologyData(appointmentId) {
    const sql = `
        SELECT 
            id,
            appointment_id,
            case_number,
            data_json,
            pdf_path,
            fetched_at,
            fetched_by
        FROM appointment_pathology_data
        WHERE appointment_id = ?
    `;
    
    const rows = await db.query(sql, [appointmentId]);
    
    if (rows.length === 0) {
        return null;
    }
    
    const record = rows[0];
    
    return {
        id: record.id,
        appointment_id: record.appointment_id,
        case_number: record.case_number,
        data: JSON.parse(record.data_json),
        pdf_path: record.pdf_path,
        fetched_at: record.fetched_at,
        fetched_by: record.fetched_by
    };
}

/**
 * Check if pathology data exists for an appointment
 */
async function hasPathologyData(appointmentId) {
    const sql = 'SELECT COUNT(*) as count FROM appointment_pathology_data WHERE appointment_id = ?';
    const rows = await db.query(sql, [appointmentId]);
    return rows[0].count > 0;
}

module.exports = {
    fetchAndSavePathologyData,
    getPathologyData,
    hasPathologyData,
    generatePathologyContent,
    getPathologyStyles
};
