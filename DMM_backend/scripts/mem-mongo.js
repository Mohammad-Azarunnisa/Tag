/**
 * Local in-memory MongoDB launcher (for local dev without a real MongoDB).
 *
 * Boots an ephemeral mongod (via mongodb-memory-server) pinned to a fixed
 * host/port so the rest of the app can connect with the normal MONGO_URI.
 * Keep this process running for as long as you want the database alive — when
 * it stops, all data is wiped.
 *
 *   node scripts/mem-mongo.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = Number(process.env.MEM_MONGO_PORT || 27017);
const DB = process.env.MEM_MONGO_DB || 'dmm_platform';

const server = await MongoMemoryServer.create({
  instance: { port: PORT, ip: '127.0.0.1', dbName: DB },
});

console.log(`✅ in-memory MongoDB ready: ${server.getUri()}`);
console.log('   (keep this process running; Ctrl+C wipes the data)');

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
