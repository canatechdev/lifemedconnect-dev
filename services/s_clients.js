const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');
const { generateCustomCode } = require('../lib/generateCode');


class ClientsService extends BaseService {
  constructor() {
    super('clients', 'id', 
          ['client_code', 'client_name', 'short_code', 'gst_number', 'pan_number', 'mode_of_payment'],
          ['id', 'client_code', 'client_name', 'short_code', 'gst_number', 'pan_number', 'mode_of_payment', 'is_active', 'created_at']);
  }

  /**
   * Create a new client
   * @param {Object} data - Client data
   * @returns {Promise<number>} - Client ID
   */
  async createClient(data) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      // Generate client code if not provided
      if (!data.client_code || data.client_code.trim() === '') {
        data.client_code = await generateCustomCode({
          prefix: 'TPA',
          table: 'clients',
          column: 'client_code',
        });
      }
      
      // Extract insurer_ids if present
      const { insurer_ids, ...clientData } = data;

      logger.info(' [CLIENT-SERVICE-CREATE] Persisting client', {
        keys: Object.keys(clientData),
        client_name: clientData.client_name,
        short_code: clientData.short_code,
        registered_address: clientData.registered_address,
        email_id: clientData.email_id,
        email_id_2: clientData.email_id_2,
        email_id_3: clientData.email_id_3,
        contact_person_name: clientData.contact_person_name,
        contact_person_no: clientData.contact_person_no,
        contact_person_address: clientData.contact_person_address
      });
      
      // Insert client
      const [result] = await connection.query(
        'INSERT INTO clients SET ?', 
        clientData
      );
      
      const clientId = result.insertId;

      // Handle insurer relationships
      if (insurer_ids && Array.isArray(insurer_ids) && insurer_ids.length > 0) {
        const insurerValues = insurer_ids.map(insurerId => [clientId, insurerId]);
        const placeholders = insurerValues.map(() => '(?, ?)').join(', ');
        const flatValues = insurerValues.flat();
        await connection.query(
          `INSERT INTO client_insurers (client_id, insurer_id) VALUES ${placeholders}`,
          flatValues
        );
      }
      
      await connection.commit();
      logger.info('Client created successfully', { clientId, clientName: data.client_name });
      return clientId;
    } catch (error) {
      await connection.rollback();
      logger.error('Error creating client', { error: error.message, data });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * List clients with pagination and search
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Paginated client list
   */
  async listClients(options = {}) {
    const { page = 1, limit = 10, search = '', sortBy = 'id', sortOrder = 'DESC' } = options;
    
    try {
      logger.info('Listing clients', { page, limit, search: search || 'none', sortBy, sortOrder });
      
      const result = await this.list({ page, limit, search, sortBy, sortOrder });

      // Attach insurer_ids for each client in the list (for edit mode convenience)
      const clients = result.data;
      if (clients && clients.length > 0) {
        const ids = clients.map(c => c.id);
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await db.query(
          `SELECT client_id, insurer_id FROM client_insurers WHERE client_id IN (${placeholders})`,
          ids
        );

        const insurersByClient = {};
        for (const row of rows) {
          if (!insurersByClient[row.client_id]) {
            insurersByClient[row.client_id] = [];
          }
          insurersByClient[row.client_id].push(row.insurer_id);
        }

        clients.forEach(c => {
          c.insurer_ids = insurersByClient[c.id] || [];
        });
      }
      
      logger.info('Clients listed successfully', { 
       total: result.pagination?.total ?? result.data.length,
        page: result.pagination?.page ?? null,
        returned: result.data.length
      });
      
      return result;
    } catch (error) {
      logger.error('Error listing clients', { 
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to list clients: ${error.message}`);
    }
  }

  /**
   * Get client by ID
   * @param {number} id - Client ID
   * @returns {Promise<Object|null>} - Client data
   */
  async getClient(id) {
    const client = await this.findById(id);
    if (!client) return null;
    
    // Get associated insurer IDs
    const insurerRows = await db.query(
      'SELECT insurer_id FROM client_insurers WHERE client_id = ?',
      [id]
    );
    client.insurer_ids = insurerRows.map(row => row.insurer_id);

    logger.info(' [CLIENT-SERVICE-GET] Loaded client', {
      id,
      client_name: client.client_name,
      short_code: client.short_code,
      registered_address: client.registered_address,
      email_id: client.email_id,
      email_id_2: client.email_id_2,
      email_id_3: client.email_id_3,
      contact_person_name: client.contact_person_name,
      contact_person_no: client.contact_person_no,
      contact_person_address: client.contact_person_address,
      insurer_ids: client.insurer_ids
    });

    return client;
  }

  /**
   * Get multiple clients by IDs
   * @param {Array<number>} ids - Client IDs
   * @returns {Promise<Array>} - Array of clients
   */
  async getClientsByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    
    const clients = await this.findByIds(ids);
    
    // Attach insurer_ids for each client
    for (const client of clients) {
      const insurerRows = await db.query(
        'SELECT insurer_id FROM client_insurers WHERE client_id = ?',
        [client.id]
      );
      client.insurer_ids = insurerRows.map(r => r.insurer_id);
    }
    
    return clients;
  }

  /**
   * Update client
   * @param {number} id - Client ID
   * @param {Object} updates - Update data
   * @returns {Promise<number>} - Number of affected rows
   */
  async updateClient(id, updates) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const { insurer_ids, ...clientUpdates } = updates;
      let affectedRows = 0;
      
      // Update main client record if there are fields to update
      if (Object.keys(clientUpdates).length > 0) {
        const result = await this.update(id, clientUpdates);
        affectedRows = result;
      } else {
        affectedRows = 1; // No client fields to update, but operation is successful
      }
      
      // Handle insurer relationships
      if (insurer_ids !== undefined) {
        await connection.query(
          'DELETE FROM client_insurers WHERE client_id = ?',
          [id]
        );
        
        if (Array.isArray(insurer_ids) && insurer_ids.length > 0) {
          // Filter out any empty strings or invalid values
          const validInsurerIds = insurer_ids.filter(id => 
            id !== '' && id !== null && id !== undefined && !isNaN(Number(id))
          );
          
          if (validInsurerIds.length > 0) {
            const insurerValues = validInsurerIds.map(insurerId => [id, Number(insurerId)]);
            const placeholders = insurerValues.map(() => '(?, ?)').join(', ');
            const flatValues = insurerValues.flat();
            await connection.query(
              `INSERT INTO client_insurers (client_id, insurer_id) VALUES ${placeholders}`,
              flatValues
            );
          }
        }
      }
      
      await connection.commit();
      logger.info('Client updated successfully', { clientId: id, updates });
      return affectedRows;
    } catch (error) {
      await connection.rollback();
      logger.error('Error updating client', { error: error.message, id, updates });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Soft delete clients
   * @param {Array<number>} ids - Client IDs
   * @param {number} updatedBy - User ID performing the deletion
   * @returns {Promise<number>} - Number of affected rows
   */
  async softDeleteClients(ids, updatedBy) {
    if (!ids.length) return 0;
    
    const result = await this.softDelete(ids, updatedBy);
    logger.info('Clients soft deleted', { count: result, ids, updatedBy });
    return result;
  }

  /**
   * Hard delete client
   * @param {number} id - Client ID
   * @returns {Promise<number>} - Number of affected rows
   */
  async deleteClient(id) {
    const result = await this.delete(id);
    logger.info('Client deleted', { clientId: id });
    return result;
  }
}

// Create service instance
const service = new ClientsService();

// Export both class and bound methods for backward compatibility
module.exports = {
  ClientsService,
  createClient: service.createClient.bind(service),
  listClients: service.listClients.bind(service),
  getClient: service.getClient.bind(service),
  getClientsByIds: service.getClientsByIds.bind(service),
  updateClient: service.updateClient.bind(service),
  deleteClient: service.deleteClient.bind(service),
  softDeleteClients: service.softDeleteClients.bind(service)
};
