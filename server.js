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

// Middleware to authenticate JWT tokens

// Input validation middleware
function validateUserInput(req, res, next) {
  const { username, password } = req.body || {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username.trim() ||
    !password.trim()
  ) {
    return res.status(400).json({ message: "Invalid username or password" });
  }
  next();
}

app.post("/add-user", validateUserInput, async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = getDb().collection("users");
    const existingUser = await users.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ message: "Username already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await users.insertOne({ username, password: hashedPassword });
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

async function startServer() {
  try {
    db = await connectDB();
    // Ensure unique index on username
    await db.collection("users").createIndex({ username: 1 }, { unique: true });
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

startServer();
