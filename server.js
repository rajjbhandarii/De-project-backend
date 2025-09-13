const express = require("express");
const connectDB = require("./db");
const cors = require("cors");
const bcrypt = require("bcrypt");
const JWT = require("jsonwebtoken");
require("dotenv").config();

const env = process.env.JWT_SECRET;

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

function getCollection(collectionName) {
  const db = getDb();
  return db.collection(collectionName); // Get the MongoDB collection object using the provided collection name
}

async function registerPoint(req, res, collectionName, type, nameField) {
  const { [nameField]: userNameOrAdminName, password } = req.body;
  console.log("Registering ", req.body);

  try {
    const collection = getCollection(collectionName);
    const existing = await collection.findOne({
      [nameField]: userNameOrAdminName,
    });

    if (existing) {
      return res.status(409).json({
        message: `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } already exists`,
      });
    }

    // const hashedPassword = await bcrypt.hash(password, 10);
    await collection.insertOne({
      [nameField]: userNameOrAdminName,
      password,
      serviceType: type,
    });

    // Create JWT token after registration
    const token = JWT.sign(
      { [nameField]: userNameOrAdminName, type: type },
      env,
      { expiresIn: "1h" }
    );

    //  Return both message and token
    res.status(201).json({
      message: `${
        type.charAt(0).toUpperCase() + type.slice(1)
      } registered successfully`,
      token,
    });
  } catch (err) {
    console.error("Error in registerPoint:", err);
    res.status(500).json({ message: "Server error" });
  }
}

app.post("/signup-admin", (req, res) =>
  registerPoint(req, res, "admins", "Towing Service", "adminName")
);

app.post("/signup-user", (req, res) => {
  registerPoint(req, res, "users", "user", "userName");
});

async function loginPoint(req, res, collectionName, nameField) {
  const { [nameField]: userNameOrAdminName, password } = req.body;

  try {
    const collection = getCollection(collectionName);
    const user = await collection.findOne({ [nameField]: userNameOrAdminName });

    //  Unified error for both username and password issues
    // if (!user || !(await bcrypt.compare(password, user.password))) {
    //   return res.status(401).json({ message: "Invalid username or password" });
    // }
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    //  Create JWT token with _id, username/adminName, and type
    const token = JWT.sign(
      {
        id: user._id,
        [nameField]: user[nameField],
        type: user.type,
      },
      env,
      { expiresIn: "1h" }
    );

    // ✅ Send token + user details in response
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        [nameField]: user[nameField],
        type: user.type,
      },
    });
  } catch (err) {
    console.error(`Error in /login-${collectionName}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

app.post("/login-admin", (req, res) =>
  loginPoint(req, res, "admins", "adminName")
);

app.post("/login-user", (req, res) =>
  loginPoint(req, res, "users", "userName")
);

//remove user or admin from the database
// Generic remove endpoint for admin/user
async function removePoint(req, res, collectionName, nameField, type) {
  const nameValue = req.params[nameField];
  try {
    const collection = getCollection(collectionName);
    const result = await collection.deleteOne({ [nameField]: nameValue });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: `${type} not found` });
    }
    res.json({ message: `${type} removed successfully` });
  } catch (err) {
    console.error(`Error in remove${type}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

app.delete("/remove-admin/:adminName", (req, res) =>
  removePoint(req, res, "admins", "adminName", "Admin")
);

app.delete("/remove-user/:adminName", (req, res) =>
  removePoint(req, res, "users", "adminName", "User")
);

app.post("/request-services", async (req, res) => {
  const {
    serviceProviderName,
    clientLocation: userLocation,
    clientName: userName,
    serviceCategory,
  } = req.body;
  console.log(
    `Service requested from: ${serviceProviderName}, Location: ${userLocation}, User: ${userName}`
  );
  try {
    // Store the service request in the "serviceRequests" collection
    const adminsCollection = await getCollection("admins");
    const modifiedAdminRecord = await adminsCollection.updateOne(
      { adminName: serviceProviderName },
      {
        $push: {
          serviceRequests: {
            clientName: userName,
            clientLocation: userLocation,
            serviceCategory: serviceCategory,
          },
        },
      }
    );
    if (modifiedAdminRecord.matchedCount === 0) {
      return res.status(404).json({ message: "Service provider not found" });
    } else {
      console.log("Service request recorded successfully");
    }
  } catch (err) {
    console.error("Error inserting service request:", err);
    res.status(500).json({ message: "Failed to process service request" });
  }
});

app.post("/fetch-servicesRequests", async (req, res) => {
  const { serviceProviderName } = req.body;
  try {
    const adminsCollection = await getCollection("admins");
    const admin = await adminsCollection.findOne(
      { adminName: serviceProviderName },
      { projection: { serviceRequests: 1, id: 1 } }
    );
    if (!admin) {
      return res.status(404).json({ message: "Service provider not found" });
    } else {
      res.json(admin.serviceRequests);
    }
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

app.get("/fetch-serviceProvider", async (req, res) => {
  try {
    const adminsCollection = await getCollection("admins");
    const adminNames = await adminsCollection
      .find({}, { projection: { adminName: 1, _id: 0 } })
      .toArray();
    console.log(adminNames);
    res.json(adminNames);
  } catch (err) {
    console.error("Error fetching service providers:", err);
    res.status(500).json({ message: "Failed to fetch service providers" });
  }
});

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
