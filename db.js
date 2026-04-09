import { MongoClient, ServerApiVersion } from "mongodb";

let db;
let client;

/**
 * Connects to MongoDB and returns the database instance.
 * Reuses the existing connection if already connected.
 */
async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("FATAL: MONGODB_URI env variable is not set.");
    process.exit(1);
  }

  // Create a new MongoClient instance to connect to MongoDB using the provided URI.
  // The serverApi object specifies API version, strict mode, and deprecation error handling.
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect(); // Connects to the MongoDB server using the client instance.
  db = client.db("RoadRescue"); // Use your app's database name(like a table in SQL)
  await db.command({ ping: 1 }); // Sends a ping command to the "RoadRescue" database to check connectivity.
  console.log("✅ MongoDB connected successfully");
  return db;
}

/**
 * Shared helper — returns a Mongo collection, connecting if needed.
 * Import this in route files instead of creating local copies.
 */
export async function getCollection(collectionName) {
  if (!db) {
    await connectDB();
  }
  return db.collection(collectionName);
}

/**
 * Returns the raw database instance, connecting if needed.
 */
export async function getDb() {
  if (!db) {
    await connectDB();
  }
  return db;
}

/**
 * Gracefully closes the MongoDB client connection.
 */
export async function closeDb() {
  if (client) {
    await client.close();
    console.log("🔌 MongoDB connection closed.");
  }
}

export default connectDB;
