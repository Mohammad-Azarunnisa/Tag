import mongoose from 'mongoose';

const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';
  try {
    mongoose.set('strictQuery', true);
    // family: 4 forces IPv4 for the connection. On some Windows machines/networks
    // the IPv6 path to Atlas is broken (TLS handshake completes, but the actual
    // session then dies with a generic "internal_error" alert) even though the
    // same connection string works fine elsewhere (e.g. Compass, which falls
    // back to IPv4 automatically). Forcing IPv4 here avoids that broken path.
    const conn = await mongoose.connect(uri, { family: 4 });
    console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (err) {
    console.error(`❌ MongoDB connection error: ${err.message}`);
    process.exit(1);
  }
};

export default connectDB;
