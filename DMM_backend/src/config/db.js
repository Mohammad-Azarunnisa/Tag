import dns from 'node:dns';
import mongoose from 'mongoose';

// A DNS hiccup (EAI_AGAIN / ENOTFOUND for the Atlas hostnames) is a passing
// network fault, not a bad configuration. Prefer IPv4 answers so lookups do not
// stall on a broken IPv6 resolver path.
try { dns.setDefaultResultOrder('ipv4first'); } catch { /* older Node */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ATTEMPTS = 6;

const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';
  mongoose.set('strictQuery', true);

  // The driver reconnects by itself once the database has been reached, but the
  // first connection is only tried once. If the server's DNS is briefly down at
  // start-up that single failure used to kill the process; retry with a growing
  // pause instead, and only give up after about a minute.
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      // family: 4 forces IPv4 for the connection. On some Windows machines/networks
      // the IPv6 path to Atlas is broken (TLS handshake completes, but the actual
      // session then dies with a generic "internal_error" alert) even though the
      // same connection string works fine elsewhere (e.g. Compass, which falls
      // back to IPv4 automatically). Forcing IPv4 here avoids that broken path.
      const conn = await mongoose.connect(uri, {
        family: 4,
        serverSelectionTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000, // notice a recovered connection quickly
        maxIdleTimeMS: 60000, // drop idle sockets so a stale one is not reused after a network blip
      });
      console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      return;
    } catch (err) {
      console.error(`❌ MongoDB connection error (attempt ${attempt}/${ATTEMPTS}): ${err.message}`);
      if (attempt === ATTEMPTS) process.exit(1);
      await sleep(Math.min(attempt * 3000, 15000));
    }
  }
};

mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected — the driver will keep trying to reconnect'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));

export default connectDB;
