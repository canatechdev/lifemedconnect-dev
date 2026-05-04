const moment = require('moment');
const path = require('path');
const fs = require('fs/promises');
const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const {
    formatCurrency,
    formatDate,
    safeText,
    unwrapRows,
    getLetterheadDataUrl,
    buildPdfHtml,
    generatePdfBuffer,
    getStandardMargins,
} = require('../../lib/pdfUtils');

// Helper to unwrap mysql2/promise results
async function getProformaInvoiceData(appointmentId) {
    const appointmentResult = await db.query(
        `SELECT a.*, c.client_name, i.insurer_name,
                dc1.center_name, dc1.address AS center_address, dc1.city AS center_city,
                dc1.state AS center_state, dc1.pincode AS center_pincode,
                dc1.contact_number AS center_contact, dc1.email AS center_email,
                dc1.letterhead_path AS center_letterhead_path,
                dc1.footer_path AS center_footer_path
         FROM appointments a
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN insurers i ON i.id = a.insurer_id
         LEFT JOIN diagnostic_centers dc1 ON dc1.id = a.center_id
         WHERE a.id = ? LIMIT 1`,

        [appointmentId]
    );

    const rows = unwrapRows(appointmentResult);
    if (!rows?.length) return null;
    const appointment = rows[0];

    const itemsResult = await db.query(
        `SELECT 
            at.item_name,
            at.rate,
            at.rate_type,
            tc.description AS category_description
        FROM appointment_tests at
        LEFT JOIN test_categories tc ON tc.id = at.category_id
        WHERE at.appointment_id = ?
        ORDER BY at.id`,
        [appointmentId]
    );

    const items = unwrapRows(itemsResult) || [];

    const enrichedItems = items.map(item => ({
        name: safeText(item.item_name),
        description: item.rate_type === 'category' ? safeText(item.category_description) : '',
        rate: parseFloat(item.rate) || 0,
        type: item.rate_type || 'Test'
    }));

    const totalAmount = enrichedItems.reduce((sum, item) => sum + item.rate, 0);

    // Use appointment amount as total instead of summed item rates
    const displayAmount = appointment.amount != null && appointment.amount !== '' ? parseFloat(appointment.amount) : totalAmount;

    return {
        appointment,
        items: enrichedItems,
        totals: {
            totalAmount: displayAmount,
        },
    };
}

// Generate PDF using standardized template system
async function generateProformaInvoicePdfBuffer(data) {
    const { appointment, items, totals } = data;

    const invoiceNo = appointment.case_number
        ? `PI-${appointment.case_number.replace(/[^a-zA-Z0-9]/g, '')}`
        : `PI-${appointment.id}`;

    const appointmentDate = formatDate(appointment.appointment_date);
    const appointmentTime = appointment.appointment_time
        ? moment(String(appointment.appointment_time), ['HH:mm:ss', 'HH:mm']).format('hh:mm A')
        : '';
    const generatedOn = moment().format('DD/MM/YYYY HH:mm');

    const providerAddress = [appointment.center_address, appointment.center_city, appointment.center_state, appointment.center_pincode]
        .filter(Boolean)
        .join(', ');
    const providerContactParts = [];
    if (appointment.center_contact) providerContactParts.push(`Phone: ${safeText(appointment.center_contact)}`);
    if (appointment.center_email) providerContactParts.push(`Email: ${safeText(appointment.center_email)}`);
    const providerContact = providerContactParts.join(' | ');

    const patientName = `${safeText(appointment.customer_first_name || '')} ${safeText(appointment.customer_last_name || '')}`.trim() || safeText(appointment.customer_name) || '-';

    // Convert header/footer to data URLs
    const baseDir = path.resolve(__dirname, '../../');
    const headerDataUrl = await getLetterheadDataUrl(appointment.center_letterhead_path, baseDir, logger);
    const footerDataUrl = await getLetterheadDataUrl(appointment.center_footer_path, baseDir, logger);

    // Generate invoice content HTML
    const invoiceContent = generateInvoiceContent({
        diagnosticCenterName: safeText(appointment.center_name) || 'Diagnostic Center',
        providerAddress: safeText(providerAddress),
        providerContact: safeText(providerContact),
        caseNo: safeText(appointment.case_number),
        applicationNo: safeText(appointment.application_number),
        date: safeText(appointmentDate),
        time: safeText(appointmentTime),
        clientName: safeText(appointment.client_name) || '-',
        tpaName: safeText(appointment.insurer_name),
        costType: safeText(appointment.cost_type),
        costAmount: appointment.amount != null && appointment.amount !== '' ? formatCurrency(appointment.amount) : '',
        patientName,
        patientMobile: safeText(appointment.customer_mobile),
        visitType: safeText(appointment.visit_type),
        items: (items || []).map((it, idx) => ({
            sr: idx + 1,
            description: safeText(it.name),
            subDescription: safeText(it.description),
            type: safeText(it.type).toUpperCase(),
            rate: formatCurrency(it.rate),
        })),
        total: formatCurrency(totals.totalAmount),
        generatedOn,
    });

    // Build HTML (content only)
    const html = buildPdfHtml({
        content: invoiceContent,
        title: `Proforma Invoice - ${appointment.case_number || appointment.id}`,
        customStyles: getInvoiceStyles()
    });

    // Generate PDF with Puppeteer native header/footer templates
    const headerHeightMm = 38;
    const footerHeightMm = 24;

    const pdfBuffer = await generatePdfBuffer({
        html,
        headerDataUrl,
        footerDataUrl,
        headerHeightMm,
        footerHeightMm,
        margin: getStandardMargins(headerHeightMm, footerHeightMm)
    });

    logger.info(`Invoice PDF generated, size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;
}

/**
 * Generate invoice content HTML
 */
function generateInvoiceContent(data) {
    const itemsHtml = data.items.map(item => `
        <tr>
            <td class="text-center">${item.sr}</td>
            <td>
                <div>${item.description}</div>
                ${item.subDescription ? `<div class="text-sm text-gray-600">${item.subDescription}</div>` : ''}
            </td>
            <td class="text-center">${item.type}</td>
        </tr>
    `).join('');

    return `
        <div class="invoice-title">PROFORMA INVOICE</div>

        <table class="invoice-grid">
            <colgroup>
                <col style="width: 60%" />
                <col style="width: 40%" />
            </colgroup>
            <tr>
                <th>Assigned Diagnostic Center</th>
                <th>Details</th>
            </tr>
            <tr>
                <td>
                    <div><b>${data.diagnosticCenterName}</b></div>
                    <div class="text-muted">${data.providerAddress}</div>
                    <div class="text-muted">${data.providerContact}</div>
                </td>
                <td>
                    <table class="inner-grid">
                        <tr><td class="label">Case No</td><td class="value">${data.caseNo}</td></tr>
                        <tr><td class="label">Application No</td><td class="value">${data.applicationNo}</td></tr>
                        <tr><td class="label">Date</td><td class="value">${data.date}</td></tr>
                        <tr><td class="label">Time</td><td class="value">${data.time}</td></tr>
                    </table>
                </td>
            </tr>
        </table>

        <div class="section-spacer"></div>

        <table class="invoice-grid">
            <colgroup>
                <col style="width: 50%" />
                <col style="width: 50%" />
            </colgroup>
            <tr>
                <th>Client / TPA</th>
                <th>Patient / Appointment</th>
            </tr>
            <tr>
                <td>
                    <table class="inner-grid">
                        <tr><td class="label">Client</td><td class="value">${data.clientName}</td></tr>
                        <tr><td class="label">TPA</td><td class="value">${data.tpaName}</td></tr>
                        <tr><td class="label">Cost Type</td><td class="value">${data.costType}</td></tr>
                        ${data.costAmount ? `<tr><td class="label">Cost Amount</td><td class="value">${data.costAmount}</td></tr>` : ''}
                    </table>
                </td>
                <td>
                    <table class="inner-grid">
                        <tr><td class="label">Name</td><td class="value">${data.patientName}</td></tr>
                        <tr><td class="label">Mobile</td><td class="value">${data.patientMobile}</td></tr>
                        <tr><td class="label">Visit Type</td><td class="value">${data.visitType}</td></tr>
                        <tr><td class="label">Date</td><td class="value">${data.date}</td></tr>
                        <tr><td class="label">Time</td><td class="value">${data.time}</td></tr>
                    </table>
                </td>
            </tr>
        </table>

        <div class="section-spacer"></div>

        <table class="items-table">
            <colgroup>
                <col style="width: 8%" />
                <col style="width: 72%" />
                <col style="width: 20%" />
            </colgroup>
            <thead>
                <tr>
                    <th class="text-center">#</th>
                    <th>Description</th>
                    <th class="text-center">Type</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>

        <div class="section-spacer"></div>

        <table class="totals-table">
            <tr><th colspan="2">Summary</th></tr>
            <tr><td class="label"><b>Total</b></td><td class="text-right"><b>${data.total}</b></td></tr>
        </table>

        <div class="invoice-note">
            <p><strong>Note:</strong> This is a proforma invoice for estimation purposes. Final bill may vary upon confirmation.</p>
            <p class="text-sm text-gray-600 mt-1">Generated on: ${data.generatedOn}</p>
        </div>
    `;
}

/**
 * Get invoice-specific CSS styles
 */
function getInvoiceStyles() {
    return `
        .invoice-title {
            text-align: center;
            font-size: 20pt;
            font-weight: 700;
            margin: 0 0 16pt 0;
            color: #000;
            text-transform: uppercase;
            letter-spacing: 2px;
            border-bottom: 2pt solid #000;
            padding-bottom: 8pt;
        }
        
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .text-muted { color: #666; font-size: 9pt; }
        .text-sm { font-size: 8pt; }
        .text-gray-600 { color: #666; }
        
        .section-spacer {
            margin-top: 12pt;
        }
        
        .invoice-grid {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            border: 1pt solid #000;
        }
        
        .invoice-grid th {
            background: #f8f8f8;
            padding: 8pt 10pt;
            text-align: left;
            font-size: 10pt;
            font-weight: 700;
            border: 1pt solid #000;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .invoice-grid td {
            padding: 8pt 10pt;
            border: 1pt solid #000;
            vertical-align: top;
            font-size: 10pt;
        }
        
        .inner-grid {
            width: 100%;
            border-collapse: collapse;
        }
        
        .inner-grid td {
            border: none;
            padding: 3pt 0;
            font-size: 9pt;
        }
        
        .inner-grid .label {
            width: 40%;
            font-weight: 600;
            color: #000;
        }
        
        .inner-grid .value {
            width: 60%;
            font-weight: 500;
        }
        
        .items-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            border: 1pt solid #000;
        }
        
        .items-table th {
            background: #f8f8f8;
            padding: 6pt 8pt;
            text-align: left;
            font-size: 9pt;
            font-weight: 700;
            border: 1pt solid #000;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .items-table td {
            padding: 5pt 6pt;
            font-size: 9pt;
            border-bottom: 0.5pt solid #e2e8f0;
            vertical-align: top;
        }
        
        .items-table tbody tr:nth-child(even) {
            background: #f8fafc;
        }
        
        .totals-table {
            width: 45%;
            margin-left: auto;
            border-collapse: collapse;
        }
        
        .totals-table th {
            background: #f1f5f9;
            padding: 6pt 8pt;
            text-align: left;
            font-size: 9pt;
            font-weight: 700;
            border: 1pt solid #cbd5e1;
        }
        
        .totals-table td {
            padding: 6pt 8pt;
            border: 1pt solid #cbd5e1;
            font-size: 9pt;
        }
        
        .invoice-note {
            margin-top: 12pt;
            padding: 8pt 10pt;
            background: #fefce8;
            border-left: 3pt solid #eab308;
            border-radius: 3pt;
            font-size: 8pt;
        }
        
        .invoice-note strong {
            color: #854d0e;
        }
    `;
}

async function generateProformaInvoicePdf(appointmentId) {
    try {
        const data = await getProformaInvoiceData(appointmentId);
        if (!data) return null;

        const pdfBuffer = await generateProformaInvoicePdfBuffer(data);
        return { pdfBuffer, invoiceData: data };
    } catch (error) {
        logger.error('Error generating proforma invoice PDF:', error);
        throw error;
    }
}

module.exports = {
    generateProformaInvoicePdf,
    getProformaInvoiceData
};