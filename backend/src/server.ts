import Fastify from 'fastify';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
