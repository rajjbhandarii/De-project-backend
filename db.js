const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;

// Create a new MongoClient instance to connect to MongoDB using the provided URI.
// The serverApi object specifies API version, strict mode, and deprecation error handling.
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectDB() {
  try {
    await client.connect(); // Connects to the MongoDB server using the client instance.
    const db = client.db("RoadRescue"); // Use your app's database name(like a table in SQL)
    await db.command({ ping: 1 }); // Sends a ping command to the "RoadRescue" database to check connectivity.
    console.log("✅ MongoDB connected successfully");
    return db; // Return the database object
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

module.exports = connectDB;
