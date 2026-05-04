/**
 * Entity Handlers Index
 * Exports all entity handlers and provides handler registry
 */

const AppointmentHandler = require('./AppointmentHandler');
const TestCategoryHandler = require('./TestCategoryHandler');
const ClientHandler = require('./ClientHandler');
const UserHandler = require('./UserHandler');
const BaseEntityHandler = require('./BaseEntityHandler');

// Registry of all handlers
const handlers = [
    new AppointmentHandler(),
    new TestCategoryHandler(),
    new ClientHandler(),
    new UserHandler()
];

/**
 * Get handler for entity type
 * @param {string} entityType - Entity type
 * @returns {BaseEntityHandler|null} Handler instance or null
 */
const getHandler = (entityType) => {
    return handlers.find(h => h.canHandle(entityType)) || null;
};

/**
 * Check if entity type has custom handler
 * @param {string} entityType - Entity type
 * @returns {boolean}
 */
const hasCustomHandler = (entityType) => {
    return getHandler(entityType) !== null;
};

module.exports = {
    AppointmentHandler,
    TestCategoryHandler,
    ClientHandler,
    UserHandler,
    BaseEntityHandler,
    handlers,
    getHandler,
    hasCustomHandler
};
