// Central payload normalization helpers

function emptyToNull(value) {
    return value === undefined || value === null || value === '' ? null : value;
}

function toInt(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
}

function toFloat(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
}

function toBool01(value) {
    if (value === '' || value === null || value === undefined) return null;
    if (value === true || value === 'true' || value === 1 || value === '1') return 1;
    if (value === false || value === 'false' || value === 0 || value === '0') return 0;
    return null;
}

// Normalize date (keep local date as entered) to YYYY-MM-DD string
function toMySqlDate(value) {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
        // Use local date components to avoid timezone shifts
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    // Accept formats like YYYY-MM-DD or ISO
    const d = new Date(value);
    if (!isNaN(d)) {
        // Use local date components to avoid timezone shifts
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return null;
}

// Normalize time to HH:MM:SS (supports HH:MM and Excel fraction)
function toMySqlTime(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && value > 0 && value < 1) {
        const totalSeconds = Math.round(value * 24 * 60 * 60);
        const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(totalSeconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    if (typeof value === 'string') {
        const parts = value.split(':');
        if (parts.length >= 2) {
            const h = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            const s = parts[2] ? parts[2].padStart(2, '0') : '00';
            return `${h}:${m}:${s}`;
        }
    }
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
        return value.toTimeString().split(' ')[0];
    }
    return null;
}

module.exports = {
    emptyToNull,
    toInt,
    toFloat,
    toBool01,
    toMySqlDate,
    toMySqlTime,
};


