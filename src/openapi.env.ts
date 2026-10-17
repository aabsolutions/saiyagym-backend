// Placeholders so env validation passes during OpenAPI generation; preview mode never connects or signs.
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/openapi';
process.env.JWT_ACCESS_SECRET ??= 'openapi-placeholder-secret-not-used-at-runtime';
