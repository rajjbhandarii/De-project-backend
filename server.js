const express = require("express");
const connectDB = require("./db");
const cors = require("cors");
const bcrypt = require("bcrypt");
const JWT = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let db;

// Helper to get the established DB connection
function getDb() {
  if (!db) {
    throw new Error("Database not connected");
  }
  return db;
}

async function registerUser(req, res, collectionName, type, nameField) {
  // Dynamically extract the property specified by 'nameField' (e.g., 'adminName' or 'userName') from req.body
  const { [nameField]: userNameOrAdminName, password } = req.body;

  try {
    //collection is like a value in SQL table
    const collection = getDb().collection(collectionName); // Get the MongoDB collection object using the provided collection name
    const existing = await collection.findOne({
      [nameField]: userNameOrAdminName,
    }); // Search for a document in the collection where the field 'nameField' matches the value
    if (existing) {
      console.log(`Attempt to register existing ${type}:`, userNameOrAdminName);
      return res.status(409).json({
        message: `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } already exists`,
      });
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      await collection.insertOne({
        [nameField]: userNameOrAdminName,
        password: hashedPassword,
        type: type,
      });
    }
    res.status(201).json({
      message: `${
        type.charAt(0).toUpperCase() + type.slice(1)
      } registered successfully`,
    });
  } catch (err) {
    console.error("Error in registerUser:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// Admin registration endpoint
app.post("/add-admin", (req, res) =>
  registerUser(req, res, "admins", "admin", "adminName")
);
// User registration endpoint
app.post("/add-user", (req, res) =>
  registerUser(req, res, "users", "user", "adminName")
);

async function startServer() {
  try {
    db = await connectDB();
    // Ensure unique index on adminName for admins collection
    await db
      .collection("admins")
      .createIndex({ adminName: 1 }, { unique: true });
    // Ensure unique index on adminName for users collection
    await db
      .collection("users")
      .createIndex({ adminName: 1 }, { unique: true });

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

startServer();
