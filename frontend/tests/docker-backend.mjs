// Isolated transport fixture, never used by the application.
import { createServer } from 'node:http';
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/health') response.end(JSON.stringify({ status: 'ok' }));
  else if (request.url?.startsWith('/api/push'))
    response.end(JSON.stringify({ path: request.url }));
  else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
  }
}).listen(8080, '0.0.0.0');
