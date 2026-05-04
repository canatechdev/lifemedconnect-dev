/**
 * Appointment Summary PDF Service
 * Generates comprehensive appointment summary PDF with all details
 */

const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs').promises;

// Import PDF generation utilities
const { generatePdfBuffer, buildPdfHtml, getStandardMargins, getLetterheadDataUrl } = require('../../lib/pdfUtils');

// Import document services
const { getDocuments, getCustomerImages } = require('./AppointmentDocuments');

/**
 * Convert image file to base64 data URL
 * @param {string} filePath - Path to image file
 * @returns {Promise<string>} Base64 data URL
 */
async function getImageDataUrl(filePath) {
    try {
        if (!filePath) return null;
        
        const baseDir = path.resolve(__dirname, '../../');
        const fullPath = path.join(baseDir, filePath);
        
        // Check if file exists
        const stats = await fs.stat(fullPath).catch(() => null);
        if (!stats) {
            logger.warn('Image file not found', { filePath });
            return null;
        }
        
        // Read file and convert to base64
        const imageBuffer = await fs.readFile(fullPath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                        ext === '.png' ? 'image/png' : 
                        ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        
        return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
        logger.error('Error converting image to base64', { filePath, error: error.message });
        return null;
    }
}

/**
 * Generate appointment summary PDF
 * @param {number} appointmentId - Appointment ID
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateAppointmentSummaryPDF(appointmentId) {
    try {
        logger.info('Generating appointment summary PDF', { appointmentId });
        
        // Get complete appointment data with all details
        const appointmentData = await getCompleteAppointmentData(appointmentId);
        
        if (!appointmentData) {
            logger.error('Appointment not found in database', { appointmentId });
            throw new Error('Appointment not found');
        }

        // Get customer documents and images
        const documents = await getDocuments(appointmentId);
        const customerImages = await getCustomerImages(appointmentId);
        
        // Convert documents and images to base64
        const documentsWithBase64 = await Promise.all(
            documents.map(async (doc) => ({
                ...doc,
                dataUrl: await getImageDataUrl(doc.file_path)
            }))
        );
        
        const imagesWithBase64 = await Promise.all(
            customerImages.map(async (img) => ({
                ...img,
                dataUrl: await getImageDataUrl(img.file_path)
            }))
        );
        
        // Add documents and images to appointment data
        appointmentData.documents = documentsWithBase64;
        appointmentData.customerImages = imagesWithBase64;

        // Generate PDF buffer
        const pdfBuffer = await generateSummaryPDFBuffer(appointmentData);
        
        return pdfBuffer;
    } catch (error) {
        logger.error('Error generating appointment summary PDF', { 
            error: error.message, 
            appointmentId 
        });
        throw error;
    }
}

/**
 * Get complete appointment data with all related information
 * @param {number} appointmentId - Appointment ID
 * @returns {Promise<Object>} Complete appointment data
 */
async function getCompleteAppointmentData(appointmentId) {
    const sql = `
        SELECT 
            a.*,
            c.client_name,
            dc.center_name,
            dc.center_code,
            dc.address as center_address,
            dc.contact_number as center_contact,
            dc.email as center_email,
            dc.letterhead_path as center_letterhead_path,
            dc.footer_path as center_footer_path,
            odc.center_name as other_center_name,
            odc.center_code as other_center_code,
            odc.letterhead_path as other_center_letterhead_path,
            odc.footer_path as other_center_footer_path,
            i.insurer_name,
            u.full_name as created_by_name,
            tc.full_name as technician_name,
            tc.full_name as technician_contact
        FROM appointments a
        LEFT JOIN clients c ON a.client_id = c.id
        LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
        LEFT JOIN diagnostic_centers odc ON a.other_center_id = odc.id
        LEFT JOIN insurers i ON a.insurer_id = i.id
        LEFT JOIN users u ON a.created_by = u.id
        LEFT JOIN technicians t ON a.assigned_technician_id = t.id
        LEFT JOIN users tc ON t.user_id = tc.id
        WHERE a.id = ?
    `;
    
    const result = await db.query(sql, [appointmentId]);
    
    console.log('Appointment query result structure:', { 
        appointmentId, 
        resultType: typeof result,
        resultKeys: Object.keys(result || {}),
        result0Type: typeof result[0]
    });
    
    // Handle different query result structures
    let appointment = null;
    
    // The result might be directly the appointment object
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        appointment = result;
    } else if (Array.isArray(result) && result.length > 0) {
        appointment = result[0];
    } else if (result && result[0] && typeof result[0] === 'object') {
        appointment = result[0];
    }
    
    console.log('Extracted appointment:', { 
        appointmentId, 
        hasAppointment: !!appointment,
        appointmentKeys: appointment ? Object.keys(appointment).slice(0, 5) : null
    });
    
    if (!appointment) {
        console.log('No appointment found, checking existence');
        return null;
    }
    
    // Get appointment tests with descriptions
    const testsSql = `
        SELECT 
            at.*,
            t.test_name,
            t.description as test_description,
            t.report_type as test_report_type,
            tc.category_name,
            tc.description as category_description,
            tc.report_type as category_report_type,
            tech_u.full_name as technician_name
        FROM appointment_tests at
        LEFT JOIN tests t ON at.test_id = t.id
        LEFT JOIN test_categories tc ON at.category_id = tc.id
        LEFT JOIN technicians tech ON at.assigned_technician_id = tech.id
        LEFT JOIN users tech_u ON tech.user_id = tech_u.id
        WHERE at.appointment_id = ?
        ORDER BY at.id
    `;
    
    const testResult = await db.query(testsSql, [appointmentId]);
    
    console.log('Tests query result structure:', {
        appointmentId,
        testResultType: typeof testResult,
        testResultKeys: Object.keys(testResult || {}),
        testResult0Type: typeof testResult[0]
    });
    
    // Handle different test result structures
    let tests = [];
    
    if (testResult && typeof testResult === 'object' && !Array.isArray(testResult)) {
        // Direct object result
        tests = Array.isArray(testResult) ? testResult : [testResult];
    } else if (Array.isArray(testResult) && testResult.length > 0) {
        tests = testResult;
    } else if (testResult && testResult[0] && Array.isArray(testResult[0])) {
        tests = testResult[0];
    }
    
    console.log('Final tests array:', {
        appointmentId,
        testsType: typeof tests,
        isArray: Array.isArray(tests),
        length: tests.length
    });
    
    return {
        ...appointment,
        tests: tests
    };
}

/**
 * Generate PDF buffer from appointment data
 * @param {Object} appointmentData - Complete appointment data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateSummaryPDFBuffer(appointmentData) {
    try {
        // Generate HTML content
        const htmlContent = generateAppointmentSummaryContent(appointmentData);
        
        // Build HTML with styles
        const html = buildPdfHtml({
            content: htmlContent,
            title: `Appointment Summary - ${appointmentData.case_number || appointmentData.id}`,
            customStyles: getInvoiceStyles()
        });
        
        // Generate PDF with Puppeteer - NO headers/footers, minimal margins
        const pdfBuffer = await generatePdfBuffer({
            html,
            margin: { top: '10mm', bottom: '5mm', left: '10mm', right: '10mm' },
            displayHeaderFooter: false
        });
        
        logger.info(`Appointment Summary PDF generated, size: ${pdfBuffer.length} bytes`);
        return pdfBuffer;
    } catch (error) {
        logger.error('Error generating appointment summary PDF buffer', { error: error.message });
        throw error;
    }
}

// Helper function to get compact single-page styles
function getInvoiceStyles() {
    return `
        body {
            font-family: Arial, sans-serif;
            font-size: 8px;
            line-height: 1.1;
            color: #000;
            margin: 0;
            padding: 8px;
        }
        
        .invoice-title {
            text-align: center;
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
            color: #000;
            text-transform: uppercase;
        }
        
        .section-title {
            font-size: 10px;
            font-weight: bold;
            margin: 12px 0 6px 0;
            color: #000;
            border-bottom: 0.5px solid #666;
            padding-bottom: 1px;
        }
        
        .compact-grid {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 7px;
        }
        
        .compact-grid th {
            background-color: #f5f5f5;
            padding: 3px 5px;
            text-align: left;
            font-weight: bold;
            color: #000;
            border: 0.5px solid #666;
            width: 25%;
        }
        
        .compact-grid td {
            padding: 3px 5px;
            border: 0.5px solid #666;
            background-color: #fff;
        }
        
        .two-column-grid {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 7px;
        }
        
        .two-column-grid th {
            background-color: #f5f5f5;
            padding: 3px 5px;
            text-align: left;
            font-weight: bold;
            color: #000;
            border: 0.5px solid #666;
            width: 50%;
        }
        
        .two-column-grid td {
            padding: 3px 5px;
            border: 0.5px solid #666;
            background-color: #fff;
        }
        
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 7px;
        }
        
        .items-table th {
            background-color: #f5f5f5;
            color: #000;
            padding: 3px 2px;
            text-align: left;
            font-weight: bold;
            border: 0.5px solid #666;
        }
        
        .items-table td {
            padding: 3px 2px;
            border: 0.5px solid #666;
            vertical-align: top;
        }
        
        .text-center {
            text-align: center;
        }
        
        .text-sm {
            font-size: 7px;
        }
        
        .text-md {
            font-size: 8px;
        }
        
        .main-content {
            page-break-inside: avoid;
        }
        
        .page-break-before {
            page-break-before: always;
        }
        
        @media print {
            body { margin: 0; padding: 5px; }
            .main-content { 
                page-break-inside: avoid;
            }
            .page-break-before {
                page-break-before: always;
            }
        }
    `;
}

/**
 * Helper function to generate professional HTML content
 */
function generateAppointmentSummaryContent(data) {

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric'
        });
    };

    const formatDateTime = (dateTimeString) => {
        if (!dateTimeString) return 'N/A';
        const date = new Date(dateTimeString);
        return date.toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatTime = (timeString) => {
        if (!timeString) return 'N/A';
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    };

    const safeText = (text) => text || 'N/A';

    // Generate tests HTML - ensure tests is an array
    const tests = Array.isArray(data.tests) ? data.tests : [];
    console.log('Generating tests HTML with tests count:', tests.length);
    
    const testsHtml = tests.map((test, index) => `
        <tr>
            <td class="text-center">${index + 1}</td>
            <td>
                <div><strong>${safeText(test.item_name || test.name)}</strong></div>
                ${test.test_name && test.test_name !== test.item_name ? `<div class="text-sm">Test: ${safeText(test.test_name)}</div>` : ''}
                ${test.category_name ? `<div class="text-sm">Category: ${safeText(test.category_name)}</div>` : ''}
                ${test.test_description || test.category_description ? `<div class="text-sm">Description: ${safeText(test.test_description || test.category_description)}</div>` : ''}
            </td>
            <td class="text-center">${safeText(test.rate_type)}</td>
            <td class="text-center">${safeText(test.visit_subtype)}</td>
        </tr>
    `).join('');

    return `
        <div class="main-content">
            <div class="invoice-title">APPOINTMENT SUMMARY</div>

            <!-- Compact Appointment Details -->
        <div class="section-title">APPOINTMENT DETAILS</div>
        ${data.visit_type === 'Both' ? `
        <table class="compact-grid">
            <tr>
                <th>Case No.</th>
                <td>${safeText(data.case_number)}</td>
                <th>Application No.</th>
                <td>${safeText(data.application_number)}</td>
            </tr>
            <tr>
                <th>TPA (Client)</th>
                <td>${safeText(data.client_name)}</td>
                <th>TPA (Insurer)</th>
                <td>${safeText(data.insurer_name)}</td>
            </tr>
            <tr>
                <th>Visit Type</th>
                <td>${safeText(data.visit_type)}</td>
                <th>Appt. Date</th>
                <td>${formatDate(data.appointment_date)}</td>
            </tr>
            <tr>
                <th>Appt. Time</th>
                <td>${formatTime(data.appointment_time)}</td>
                <th>Overall Status</th>
                <td>${safeText(data.status)}</td>
            </tr>
            <tr>
                <th>Center Medical Status</th>
                <td>${safeText(data.center_medical_status || 'N/A')}</td>
                <th>Home Medical Status</th>
                <td>${safeText(data.home_medical_status || 'N/A')}</td>
            </tr>
            <tr>
                <th>Center Confirmed At</th>
                <td>${formatDateTime(data.center_confirmed_at)}</td>
                <th>Home Confirmed At</th>
                <td>${formatDateTime(data.home_confirmed_at)}</td>
            </tr>
        </table>
        ` : `
        <table class="compact-grid">
            <tr>
                <th>Case No.</th>
                <td>${safeText(data.case_number)}</td>
                <th>Application No.</th>
                <td>${safeText(data.application_number)}</td>
            </tr>
            <tr>
                <th>TPA</th>
                <td>${safeText(data.client_name)}</td>
                <th>Insurer</th>
                <td>${safeText(data.insurer_name)}</td>
            </tr>
            <tr>
                <th>Visit Type</th>
                <td>${safeText(data.visit_type)}</td>
                <th>Appt. Date</th>
                <td>${formatDate(data.appointment_date)}</td>
            </tr>
            <tr>
                <th>Appt. Time</th>
                <td>${formatTime(data.appointment_time)}</td>
                <th>Confirmed Date</th>
                <td>${formatDate(data.confirmed_date)}</td>
            </tr>
            <tr>
                <th>Confirmed Time</th>
                <td>${formatTime(data.confirmed_time)}</td>
                <th>Medical Status</th>
                <td>${safeText(data.medical_status)}</td>
            </tr>
            <tr>
                <th>Status</th>
                <td>${safeText(data.status)}</td>
                <th></th>
                <td></td>
            </tr>
        </table>
        `}

        <!-- Compact Customer Information -->
        <div class="section-title">CUSTOMER INFORMATION</div>
        <table class="compact-grid">
            <tr>
                <th>Name</th>
                <td>${safeText(data.customer_first_name)} ${safeText(data.customer_last_name)}</td>
                <th>Mobile</th>
                <td>${safeText(data.customer_mobile)}</td>
            </tr>
            <tr>
                <th>Email</th>
                <td>${safeText(data.customer_email)}</td>
                <th>Address</th>
                <td>${safeText(data.customer_address)}</td>
            </tr>
            <tr>
                <th>City</th>
                <td>${safeText(data.city)}</td>
                <th>State</th>
                <td>${safeText(data.state)}</td>
            </tr>
            <tr>
                <th>Pincode</th>
                <td>${safeText(data.pincode)}</td>
                <th>Landmark</th>
                <td>${safeText(data.customer_landmark || 'N/A')}</td>
            </tr>
        </table>

        <!-- Compact Center Information -->
        <div class="section-title">DIAGNOSTIC CENTER INFORMATION</div>
        ${data.visit_type === 'Both' ? `
        <table class="compact-grid">
            <tr>
                <th>Primary Center</th>
                <td>${safeText(data.center_name)}</td>
                <th>Other Center</th>
                <td>${safeText(data.other_center_name || 'N/A')}</td>
            </tr>
            <tr>
                <th>Primary Contact</th>
                <td>${safeText(data.center_contact)}</td>
                <th>Other Contact</th>
                <td>${safeText(data.other_center_contact || 'N/A')}</td>
            </tr>
            <tr>
                <th>Primary Email</th>
                <td>${safeText(data.center_email)}</td>
                <th>Other Email</th>
                <td>${safeText(data.other_center_email || 'N/A')}</td>
            </tr>
        </table>
        ` : `
        <table class="two-column-grid">
            <tr>
                <th>Center Name</th>
                <td>${safeText(data.center_name)}</td>
            </tr>
            <tr>
                <th>Contact</th>
                <td>${safeText(data.center_contact)}</td>
            </tr>
            <tr>
                <th>Email</th>
                <td>${safeText(data.center_email)}</td>
            </tr>
        </table>
        `}

        ${data.visit_type === 'Both' ? `
        <div class="section-title">PRIMARY CENTER TESTS & CATEGORIES</div>
        <table class="items-table">
            <thead>
                <tr>
                    <th class="text-center">Sr.No</th>
                    <th>Test Details</th>
                    <th class="text-center">Type</th>
                    <th class="text-center">Visit</th>
                    <th class="text-center">Center</th>
                    <th class="text-center">Technician</th>
                </tr>
            </thead>
            <tbody>
                ${tests.filter(test => test.assigned_center_id === data.center_id).map((test, index) => `
                    <tr>
                        <td class="text-center">${index + 1}</td>
                        <td>
                            <div><strong>${safeText(test.item_name || test.name)}</strong></div>
                            ${test.test_name && test.test_name !== test.item_name ? `<div class="text-md">Test: ${safeText(test.test_name)}</div>` : ''}
                            ${test.category_name && test.category_name !== (test.item_name || test.name) ? `<div class="text-md">${safeText(test.category_name)}</div>` : ''}
                            ${test.test_description ? `<div class="text-md">Test Description: ${safeText(test.test_description)}</div>` : ''}
                            ${test.category_description ? `<div class="text-md">Category Description: ${safeText(test.category_description)}</div>` : ''}
                            ${test.test_report_type ? `<div class="text-md">Test Report Type: ${safeText(test.test_report_type)}</div>` : ''}
                            ${test.category_report_type ? `<div class="text-md">Category Report Type: ${safeText(test.category_report_type)}</div>` : ''}
                        </td>
                        <td class="text-center">${safeText(test.rate_type)}</td>
                        <td class="text-center">${safeText(test.visit_subtype)}</td>
                        <td class="text-center">${safeText(data.center_name)}</td>
                        <td class="text-center">${safeText(test.technician_name || 'N/A')}</td>
                    </tr>
                `).join('') || '<tr><td colspan="6" class="text-center">No tests found for Primary Center</td></tr>'}
            </tbody>
        </table>

        <div class="section-title">OTHER CENTER TESTS & CATEGORIES</div>
        <table class="items-table">
            <thead>
                <tr>
                    <th class="text-center">Sr.No</th>
                    <th>Test Details</th>
                    <th class="text-center">Type</th>
                    <th class="text-center">Visit</th>
                    <th class="text-center">Center</th>
                    <th class="text-center">Technician</th>
                </tr>
            </thead>
            <tbody>
                ${tests.filter(test => test.assigned_center_id === data.other_center_id).map((test, index) => `
                    <tr>
                        <td class="text-center">${index + 1}</td>
                        <td>
                            <div><strong>${safeText(test.item_name || test.name)}</strong></div>
                            ${test.test_name && test.test_name !== test.item_name ? `<div class="text-md">Test: ${safeText(test.test_name)}</div>` : ''}
                            ${test.category_name && test.category_name !== (test.item_name || test.name) ? `<div class="text-md">${safeText(test.category_name)}</div>` : ''}
                            ${test.test_description ? `<div class="text-md">Test Description: ${safeText(test.test_description)}</div>` : ''}
                            ${test.category_description ? `<div class="text-md">Category Description: ${safeText(test.category_description)}</div>` : ''}
                            ${test.test_report_type ? `<div class="text-md">Test Report Type: ${safeText(test.test_report_type)}</div>` : ''}
                            ${test.category_report_type ? `<div class="text-md">Category Report Type: ${safeText(test.category_report_type)}</div>` : ''}
                        </td>
                        <td class="text-center">${safeText(test.rate_type)}</td>
                        <td class="text-center">${safeText(test.visit_subtype)}</td>
                        <td class="text-center">${safeText(data.other_center_name || 'Other Center')}</td>
                        <td class="text-center">${safeText(test.technician_name || 'N/A')}</td>
                    </tr>
                `).join('') || '<tr><td colspan="6" class="text-center">No tests found for Other Center</td></tr>'}
            </tbody>
        </table>
        ` : `
        <div class="section-title">TESTS & CATEGORIES</div>
        <table class="items-table">
            <thead>
                <tr>
                    <th class="text-center">Sr.No</th>
                    <th>Test Details</th>
                    <th class="text-center">Type</th>
                    <th class="text-center">Visit</th>
                    <th class="text-center">Center</th>
                    <th class="text-center">Technician</th>
                </tr>
            </thead>
            <tbody>
                ${tests.map((test, index) => `
                    <tr>
                        <td class="text-center">${index + 1}</td>
                        <td>
                            <div><strong>${safeText(test.item_name || test.name)}</strong></div>
                            ${test.test_name && test.test_name !== test.item_name ? `<div class="text-md">Test: ${safeText(test.test_name)}</div>` : ''}
                            ${test.category_name && test.category_name !== (test.item_name || test.name) ? `<div class="text-md">${safeText(test.category_name)}</div>` : ''}
                            ${test.test_description ? `<div class="text-md">Test Description: ${safeText(test.test_description)}</div>` : ''}
                            ${test.category_description ? `<div class="text-md">Category Description: ${safeText(test.category_description)}</div>` : ''}
                            ${test.test_report_type ? `<div class="text-md">Test Report Type: ${safeText(test.test_report_type)}</div>` : ''}
                            ${test.category_report_type ? `<div class="text-md">Category Report Type: ${safeText(test.category_report_type)}</div>` : ''}
                        </td>
                        <td class="text-center">${safeText(test.rate_type)}</td>
                        <td class="text-center">${safeText(test.visit_subtype)}</td>
                        <td class="text-center">${safeText(data.center_name)}</td>
                        <td class="text-center">${safeText(test.technician_name || 'N/A')}</td>
                    </tr>
                `).join('') || '<tr><td colspan="6" class="text-center">No tests found for this appointment</td></tr>'}
            </tbody>
        </table>
        `}

        ${(() => {
            const allItems = [];
            const documents = data.documents || [];
            const customerImages = data.customerImages || [];
            
            // Add all documents and images to one array
            documents.forEach(doc => {
                allItems.push({
                    ...doc,
                    type: 'document',
                    title: safeText(doc.doc_type?.replace(/_/g, ' ').toUpperCase()),
                    subtitle: `Document Number: ${safeText(doc.doc_number || 'N/A')}`
                });
            });
            
            customerImages.forEach(img => {
                allItems.push({
                    ...img,
                    type: 'image',
                    title: safeText(img.image_label),
                    subtitle: ''
                });
            });
            
            // Only proceed if we have items
            if (allItems.length === 0) {
                return '';
            }
            
            // Show 2 items per page
            const pages = [];
            for (let i = 0; i < allItems.length; i += 2) {
                const topItem = allItems[i];
                const bottomItem = allItems[i + 1];
                
                pages.push(`
                    ${i > 0 ? '<div class="page-break-before"></div>' : ''}
                    <div style="height: 100vh; display: flex; flex-direction: column; page-break-inside: avoid;">
                        
                        <!-- Top Item -->
                        <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; ${bottomItem ? 'border-bottom: 0.5px solid #666;' : ''}">
                            <div style="text-align: center; max-width: 80%;">
                                <div style="font-weight: bold; margin-bottom: 10px; font-size: 12px;">${topItem.title}</div>
                                ${topItem.subtitle ? `<div style="font-size: 9px; margin-bottom: 10px; color: #666;">${topItem.subtitle}</div>` : ''}
                                
                                ${topItem.dataUrl ? `
                                    <div style="border: 0.5px solid #666; padding: 10px; background-color: #f9f9f9;">
                                        ${topItem.dataUrl.startsWith('data:image/') ? 
                                            `<img src="${topItem.dataUrl}" style="max-width: 100%; max-height: 35vh; object-fit: contain;" />` :
                                            `<div style="font-size: 8px; color: #666; padding: 20px;">PDF Document: ${safeText(topItem.file_name)}</div>`
                                        }
                                    </div>
                                ` : `
                                    <div style="border: 0.5px solid #666; padding: 20px; background-color: #f9f9f9;">
                                        <div style="font-size: 8px; color: #666;">File: ${safeText(topItem.file_name)}</div>
                                    </div>
                                `}
                            </div>
                        </div>
                        
                        ${bottomItem ? `
                        <!-- Bottom Item -->
                        <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px;">
                            <div style="text-align: center; max-width: 80%;">
                                <div style="font-weight: bold; margin-bottom: 10px; font-size: 12px;">${bottomItem.title}</div>
                                ${bottomItem.subtitle ? `<div style="font-size: 9px; margin-bottom: 10px; color: #666;">${bottomItem.subtitle}</div>` : ''}
                                
                                ${bottomItem.dataUrl ? `
                                    <div style="border: 0.5px solid #666; padding: 10px; background-color: #f9f9f9;">
                                        ${bottomItem.dataUrl.startsWith('data:image/') ? 
                                            `<img src="${bottomItem.dataUrl}" style="max-width: 100%; max-height: 35vh; object-fit: contain;" />` :
                                            `<div style="font-size: 8px; color: #666; padding: 20px;">PDF Document: ${safeText(bottomItem.file_name)}</div>`
                                        }
                                    </div>
                                ` : `
                                    <div style="border: 0.5px solid #666; padding: 20px; background-color: #f9f9f9;">
                                        <div style="font-size: 8px; color: #666;">File: ${safeText(bottomItem.file_name)}</div>
                                    </div>
                                `}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `);
            }
            
            return pages.join('');
        })()}
        </div>
    `;
    
    return htmlContent;
}

module.exports = {
    generateAppointmentSummaryPDF
};
