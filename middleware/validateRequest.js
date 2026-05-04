/**
 * Middleware to validate request body or query using Joi schemas
 */
const validateRequest = (schema, source = 'body') => {
    return (req, res, next) => {
        const dataToValidate = source === 'query' ? req.query : req.body;
        const { error, value } = schema.validate(dataToValidate, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors
            });
        }

        // Replace the appropriate source with validated and sanitized data
        if (source === 'query') {
            req.query = value;
        } else {
            req.body = value;
        }
        next();
    };
};

module.exports = validateRequest;
