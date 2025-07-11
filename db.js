const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  // Create a new MongoClient instance to connect to MongoDB using the provided URI.
  serverApi: {
    // Specify server API options for the MongoDB connection.
    version: ServerApiVersion.v1,
    // Set the API version to v1 for stable API features.
    strict: true,
    // Enable strict mode to enforce API version rules.
    deprecationErrors: true,
    // Throw errors for deprecated API features instead of warnings.
  },
});

async function connectDB() {
  try {
    await client.connect(); // Connects to the MongoDB server using the client instance.
    const db = client.db("RodeRescue"); // Use your app's database name(like a table in SQL)
    await db.command({ ping: 1 }); // Sends a ping command to the "RodeRescue" database to check connectivity.
    console.log("✅ MongoDB connected successfully");
    return db; // Return the database object
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

module.exports = connectDB;
