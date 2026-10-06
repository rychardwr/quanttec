import { app } from '@azure/functions';

// TODO(db): include a database connectivity check once the repository layer exists.
app.http('health', {
  methods: ['GET'],
  route: 'v1/health',
  authLevel: 'anonymous',
  handler: async () => ({ status: 200, jsonBody: { status: 'ok' } }),
});
