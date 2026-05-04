const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');


/**
 * Parse educational certificates from JSON string
 * @param {string} raw - JSON string or array
 * @returns {Array} Array of certificate file paths
 */
function parseCertificates(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [raw];
  }
}

class DoctorsService extends BaseService {
  constructor() {
    super('doctors', 'id',
          ['doctor_name', 'email', 'mobile', 'qualification', 'specialization', 'city', 'state'],
          ['id', 'doctor_name', 'email', 'mobile', 'qualification', 'specialization', 'city', 'state', 'is_active', 'created_at']);
  }

  /**
   * Create a new doctor
   * @param {Object} doctor - Doctor data
   * @param {number} createdBy - User ID creating the doctor
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<number>} Doctor ID
   */
  async createDoctor(doctor, createdBy = null, connection = null) {
    try {
      logger.info('Creating doctor', { doctorName: doctor.doctor_name, createdBy });

      const sql = `
        INSERT INTO doctors (
          user_id, doctor_name, email, mobile, gender, date_of_birth,
          registration_number, qualification, specialization, experience_years,
          aadhar_number, aadhar_doc_path, pan_number, pan_doc_path,
          profile_photo_path, address, city, state, pincode, country,
          is_active, created_by, created_at, updated_at, is_deleted,
          acc_name, acc_no, ifsc_code, receivers_name, branch_name, educational_certificates
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        this.safe(doctor.user_id),
        this.safe(doctor.doctor_name),
        this.safe(doctor.email),
        this.safe(doctor.mobile),
        this.safe(doctor.gender),
        this.safe(doctor.date_of_birth),
        this.safe(doctor.registration_number),
        this.safe(doctor.qualification),
        this.safe(doctor.specialization),
        this.safe(doctor.experience_years),
        this.safe(doctor.aadhar_number),
        this.safe(doctor.aadhar_doc_path),
        this.safe(doctor.pan_number),
        this.safe(doctor.pan_doc_path),
        this.safe(doctor.profile_photo_path),
        this.safe(doctor.address),
        this.safe(doctor.city),
        this.safe(doctor.state),
        this.safe(doctor.pincode),
        this.safe(doctor.country),
        this.safe(doctor.is_active, 1),
        this.safe(createdBy),
        this.safe(doctor.acc_name),
        this.safe(doctor.acc_no),
        this.safe(doctor.ifsc_code),
        this.safe(doctor.receivers_name),
        this.safe(doctor.branch_name),
        this.safe(doctor.educational_certificates)
      ];

      const result = await (connection || db).query(sql, params);
      const doctorId = result.insertId;
      
      logger.info('Doctor created successfully', { doctorId, doctorName: doctor.doctor_name });
      return doctorId;
    } catch (error) {
      logger.error('Failed to create doctor', {
        error: error.message,
        stack: error.stack,
        doctorData: doctor
      });
      throw new Error(`Failed to create doctor: ${error.message}`);
    }
  }

  /**
   * List doctors with pagination and search
   * @param {Object} options - List options
   * @returns {Promise<Object>} Paginated doctors list
   */
  async listDoctors(options = {}) {
    try {
      const { page = 1, limit = 0, search = '', sortBy = 'id', sortOrder = 'DESC' } = options;
      
      const validSortColumns = ['id', 'doctor_name', 'email', 'mobile', 'qualification', 'specialization', 'city', 'state', 'is_active', 'created_at'];
      
      const result = await this.list({
        page,
        limit,
        search,
        sortBy: validSortColumns.includes(sortBy) ? sortBy : 'id',
        sortOrder: sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
      });

      // Parse educational certificates for each doctor
      const data = result.data.map(row => ({
        ...row,
        educational_certificates: parseCertificates(row.educational_certificates)
      }));

      logger.debug('Doctors listed successfully', {
        total: result.pagination?.total ?? data.length,
        page: result.pagination?.page ?? null,
        returned: data.length,
        search,
        limit
      });

      return { data, pagination: result.pagination };
    } catch (error) {
      logger.error('Failed to list doctors', {
        error: error.message,
        stack: error.stack,
        options
      });
      throw new Error(`Failed to list doctors: ${error.message}`);
    }
  }

  /**
   * Get doctor by ID
   * @param {number} id - Doctor ID
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<Object|null>} Doctor data or null
   */
  async getDoctor(id, connection = null) {
    try {
      const [row] = await (connection || db).query(
        'SELECT * FROM doctors WHERE id = ? AND is_deleted = 0',
        [id]
      );
      
      if (!row) {
        logger.debug('Doctor not found', { id });
        return null;
      }

      row.educational_certificates = parseCertificates(row.educational_certificates);
      
      logger.debug('Doctor retrieved successfully', { id, doctorName: row.doctor_name });
      return row;
    } catch (error) {
      logger.error('Failed to get doctor', {
        error: error.message,
        stack: error.stack,
        id
      });
      throw new Error(`Failed to get doctor: ${error.message}`);
    }
  }

  /**
   * Get multiple doctors by IDs
   * @param {Array} ids - Array of doctor IDs
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<Array>} Array of doctors
   */
  async getDoctorsByIds(ids, connection = null) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        logger.debug('No doctor IDs provided');
        return [];
      }

      const placeholders = ids.map(() => '?').join(', ');
      const sql = `SELECT * FROM doctors WHERE id IN (${placeholders}) AND is_deleted = 0`;
      const rows = await (connection || db).query(sql, ids);
      
      const doctors = rows.map(row => ({
        ...row,
        educational_certificates: parseCertificates(row.educational_certificates)
      }));

      logger.debug('Doctors retrieved by IDs', { count: doctors.length });
      return doctors;
    } catch (error) {
      logger.error('Failed to get doctors by IDs', {
        error: error.message,
        stack: error.stack,
        ids
      });
      throw new Error(`Failed to get doctors by IDs: ${error.message}`);
    }
  }

  /**
   * Update doctor
   * @param {number} id - Doctor ID
   * @param {Object} updates - Update data
   * @param {number} updatedBy - User ID updating the doctor
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<number>} Number of affected rows
   */
  async updateDoctor(id, updates, updatedBy = null, connection = null) {
    try {
      logger.info('Updating doctor', { id, updatedBy, updateKeys: Object.keys(updates) });
      
      const fields = [];
      const values = [];

      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      });

      if (!fields.length) {
        logger.debug('No fields to update for doctor', { id });
        return 0;
      }

      const sql = `UPDATE doctors SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ? AND is_deleted = 0`;
      values.push(id);

      const result = await (connection || db).query(sql, values);
      
      logger.info('Doctor updated successfully', {
        id,
        affectedRows: result.affectedRows,
        updatedBy
      });
      
      return result.affectedRows;
    } catch (error) {
      logger.error('Failed to update doctor', {
        error: error.message,
        stack: error.stack,
        id,
        updates
      });
      throw new Error(`Failed to update doctor: ${error.message}`);
    }
  }

  /**
   * Soft delete doctors
   * @param {Array} ids - Array of doctor IDs
   * @param {number} deletedBy - User ID deleting the doctors
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<number>} Number of affected rows
   */
  async softDeleteDoctors(ids, deletedBy = null, connection = null) {
    try {
      if (!Array.isArray(ids) || !ids.length) {
        logger.debug('No doctor IDs provided for soft delete');
        return 0;
      }

      logger.info('Soft deleting doctors', { ids, deletedBy });
      
      const placeholders = ids.map(() => '?').join(', ');
      const sql = `UPDATE doctors SET is_deleted = 1, updated_at = NOW() WHERE id IN (${placeholders})`;

      const result = await (connection || db).query(sql, ids);
      
      logger.info('Doctors soft deleted successfully', {
        ids,
        affectedRows: result.affectedRows,
        deletedBy
      });
      
      return result.affectedRows;
    } catch (error) {
      logger.error('Failed to soft delete doctors', {
        error: error.message,
        stack: error.stack,
        ids
      });
      throw new Error(`Failed to soft delete doctors: ${error.message}`);
    }
  }

  /**
   * Delete doctor (permanent)
   * @param {number} id - Doctor ID
   * @param {Object} connection - Database connection (optional)
   * @returns {Promise<number>} Number of affected rows
   */
  async deleteDoctor(id, connection = null) {
    try {
      logger.info('Deleting doctor', { id });
      
      const result = await (connection || db).query(
        'DELETE FROM doctors WHERE id = ?',
        [id]
      );
      
      logger.info('Doctor deleted successfully', {
        id,
        affectedRows: result.affectedRows
      });
      
      return result.affectedRows;
    } catch (error) {
      logger.error('Failed to delete doctor', {
        error: error.message,
        stack: error.stack,
        id
      });
      throw new Error(`Failed to delete doctor: ${error.message}`);
    }
  }

  /**
   * Safe value getter
   * @param {*} value - Value to check
   * @param {*} fallback - Fallback value
   * @returns {*} Safe value or fallback
   */
  safe(value, fallback = null) {
    return value === undefined || value == null || value === '' ? fallback : value;
  }
}

// Create service instance
const doctorsService = new DoctorsService();

// Export both instance and class for flexibility
module.exports = {
  DoctorsService,
  doctorsService,
  // Backward compatibility - export methods bound to instance
  createDoctor: doctorsService.createDoctor.bind(doctorsService),
  updateDoctor: doctorsService.updateDoctor.bind(doctorsService),
  softDeleteDoctors: doctorsService.softDeleteDoctors.bind(doctorsService),
  deleteDoctor: doctorsService.deleteDoctor.bind(doctorsService),
  getDoctor: doctorsService.getDoctor.bind(doctorsService),
  getDoctorsByIds: doctorsService.getDoctorsByIds.bind(doctorsService),
  listDoctors: doctorsService.listDoctors.bind(doctorsService)
};