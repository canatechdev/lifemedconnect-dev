const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');
const { generateCustomCode } = require('../lib/generateCode');

/**
 * Service layer for tests management
 * Extends BaseService for standard CRUD operations
 */
class TestsService extends BaseService {
  constructor() {
    super('tests', 'id', ['test_name', 'test_code'], ['id', 'test_name', 'test_code', 'category_id', 'is_active', 'created_at']);
  }

  /**
   * Create a new test
   * @param {Object} data - Test data
   * @param {number} createdBy - User ID creating the test
   * @param {Object} connection - Optional database connection for transactions
   * @returns {Promise<number>} Inserted test ID
   */
  async createTest(data, createdBy = null, connection = null) {
    let useConnection = connection;
    let shouldReleaseConnection = false;

    try {
      // Get connection if not provided (needed for SET ? syntax with objects)
      if (!useConnection) {
        useConnection = await db.getConnection();
        shouldReleaseConnection = true;
      }

      logger.info('Creating test', { test_name: data.test_name, createdBy });

      // Generate test code if not provided
      if (!data.test_code || data.test_code.trim() === '') {
        data.test_code = await generateCustomCode({
          prefix: 'TST',
          table: 'tests',
          column: 'test_code'
        });
      }

      const [result] = await useConnection.query(
        'INSERT INTO tests SET ?',
        { ...data, created_by: createdBy }
      );

      logger.info('Test created successfully', {
        id: result.insertId,
        test_name: data.test_name,
        createdBy
      });

      return result.insertId;
    } catch (error) {
      logger.error('Error creating test', {
        error: error.message,
        stack: error.stack,
        data
      });
      throw new Error(`Failed to create test: ${error.message}`);
    } finally {
      // Release connection only if we created it
      if (shouldReleaseConnection && useConnection) {
        useConnection.release();
      }
    }
  }

  /**
   * List tests with pagination and search
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated results
   */
  async listTests(options = {}) {
    // const { page = 1, limit = 10, search = '', sortBy = 'id', sortOrder = 'DESC' } = options;
    const { page = null, limit = null, search = '', sortBy = 'id', sortOrder = 'DESC' } = options;

    try {
      logger.info('Listing tests', { page, limit, search: search || 'none', sortBy, sortOrder });

      const result = await this.list({ page, limit, search, sortBy, sortOrder });

      // logger.info('Tests listed successfully', {
      //   total: result.pagination.total,
      //   page: result.pagination.page,
      //   returned: result.data.length
      // });
      logger.info('Tests listed successfully', {
        total: result.pagination?.total ?? result.data.length,
        page: result.pagination?.page ?? null,
        returned: result.data.length
      });


      return result;
    } catch (error) {
      logger.error('Error listing tests', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to list tests: ${error.message}`);
    }
  }

  /**
   * Get a single test by ID
   * @param {number} id - Test ID
   * @returns {Promise<Object|null>} Test object or null if not found
   */
  async getTest(id) {
    try {
      logger.info('Fetching test', { id });

      const test = await this.findById(id);

      if (!test) {
        logger.warn('Test not found', { id });
        return null;
      }

      logger.info('Test fetched successfully', { id, test_name: test.test_name });
      return test;
    } catch (error) {
      logger.error('Error fetching test', {
        id,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to fetch test: ${error.message}`);
    }
  }

  /**
   * Get multiple tests by IDs (for bulk operations)
   * @param {Array<number>} ids - Array of test IDs
   * @returns {Promise<Array>} Array of test objects
   */
  async getTestsByIds(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        logger.warn('getTestsByIds called with empty or invalid IDs');
        return [];
      }

      logger.info('Fetching tests by IDs', { count: ids.length });
      const tests = await this.findByIds(ids);

      logger.info('Tests fetched by IDs successfully', {
        requested: ids.length,
        found: tests.length
      });

      return tests;
    } catch (error) {
      logger.error('Error fetching tests by IDs', {
        count: ids.length,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to fetch tests by IDs: ${error.message}`);
    }
  }

  /**
   * Update a test
   * @param {number} id - Test ID
   * @param {Object} updates - Fields to update
   * @param {number} updatedBy - User ID who updated the test
   * @param {Object} connection - Optional database connection for transactions
   * @returns {Promise<number>} Number of affected rows
   */
  async updateTest(id, updates, updatedBy = null, connection = null) {
    try {
      logger.info('Updating test', { id, updates, updatedBy });

      // Remove metadata fields that shouldn't be directly updated
      const { created_by, created_at, updated_at, priority, approval_notes, ...cleanUpdates } = updates;

      const affectedRows = await this.update(id, cleanUpdates, updatedBy, connection);

      if (affectedRows === 0) {
        logger.warn('No test updated - not found or no changes', { id });
      } else {
        logger.info('Test updated successfully', { id, affectedRows });
      }

      return affectedRows;
    } catch (error) {
      logger.error('Error updating test', {
        id,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to update test: ${error.message}`);
    }
  }

  /**
   * Soft delete tests (mark as deleted)
   * @param {Array<number>} ids - Array of test IDs to delete
   * @param {number} deletedBy - User ID who deleted the tests
   * @param {Object} connection - Optional database connection for transactions
   * @returns {Promise<number>} Number of affected rows
   */
  async softDeleteTests(ids, deletedBy = null, connection = null) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        logger.warn('softDeleteTests called with empty or invalid IDs');
        return 0;
      }

      logger.info('Soft deleting tests', { count: ids.length, deletedBy });
      const affectedRows = await this.softDelete(ids, deletedBy, connection);

      logger.info('Tests soft deleted successfully', {
        requested: ids.length,
        deleted: affectedRows
      });

      return affectedRows;
    } catch (error) {
      logger.error('Error soft deleting tests', {
        count: ids.length,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to soft delete tests: ${error.message}`);
    }
  }

  /**
   * Hard delete a test (permanent deletion)
   * @param {number} id - Test ID
   * @param {Object} connection - Optional database connection for transactions
   * @returns {Promise<number>} Number of affected rows
   */
  async deleteTest(id, connection = null) {
    try {
      logger.warn('Hard deleting test (permanent)', { id });
      const affectedRows = await this.hardDelete(id, connection);

      if (affectedRows === 0) {
        logger.warn('No test hard deleted - not found', { id });
      } else {
        logger.warn('Test hard deleted permanently', { id });
      }

      return affectedRows;
    } catch (error) {
      logger.error('Error hard deleting test', {
        id,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to hard delete test: ${error.message}`);
    }
  }

  /**
   * Check if test name is available
   * @param {string} name - Test name to check
   * @param {number} excludeId - Optional test ID to exclude from check (for updates)
   * @returns {Promise<Object>} Object with availability status and message
   */
  async checkTestNameAvailability(name, excludeId = null) {
    try {
      const trimmedName = name?.trim();

      if (!trimmedName) {
        return {
          available: true,
          message: 'Name is available',
          suggestions: []
        };
      }

      logger.info('Checking test name availability', { name: trimmedName, excludeId });

      let sql = `
        SELECT id FROM tests
        WHERE test_name = ?
        AND is_deleted = 0
      `;
      const params = [trimmedName];

      if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
      }

      const rows = await db.query(sql, params);
      const isAvailable = rows.length === 0;

      // Fetch similar names to help the user avoid near-duplicates
      // Build a broader LIKE pattern to catch spacing differences (e.g., "abc def" vs "abcdef")
      const wildcardName = `%${trimmedName.replace(/\s+/g, '%')}%`;

      // Prefer closest matches first using LENGTH as a lightweight heuristic
      const suggestionsQuery = `
        SELECT test_name
        FROM tests
        WHERE is_deleted = 0
          AND test_name LIKE ?
          ${excludeId ? 'AND id != ?' : ''}
        ORDER BY ABS(LENGTH(test_name) - LENGTH(?)) ASC, test_name ASC
        LIMIT 3
      `;
      const suggestionsParams = [
        wildcardName,
        ...(excludeId ? [excludeId] : []),
        trimmedName
      ];

      const suggestionRows = await db.query(suggestionsQuery, suggestionsParams);
      const suggestions = suggestionRows
        .map(row => row.test_name)
        // Remove the exact match if present
        .filter(s => s.toLowerCase() !== trimmedName.toLowerCase());

      logger.info('Test name availability checked', {
        name: trimmedName,
        available: isAvailable,
        suggestionsCount: suggestions.length
      });

      return {
        available: isAvailable,
        message: isAvailable
          ? 'Name is available'
          : 'A test with this name already exists',
        suggestions
      };
    } catch (error) {
      logger.error('Error checking test name availability', {
        name,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to check test name availability: ${error.message}`);
    }
  }
}

// Initialize service instance
const testsService = new TestsService();

module.exports = {
  TestsService,
  createTest: testsService.createTest.bind(testsService),
  listTests: testsService.listTests.bind(testsService),
  getTest: testsService.getTest.bind(testsService),
  getTestsByIds: testsService.getTestsByIds.bind(testsService),
  updateTest: testsService.updateTest.bind(testsService),
  softDeleteTests: testsService.softDeleteTests.bind(testsService),
  deleteTest: testsService.deleteTest.bind(testsService),
  checkTestNameAvailability: testsService.checkTestNameAvailability.bind(testsService)
};
