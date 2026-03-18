import express from "express";
import connectDB from "./db.js";
import JWT from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const accessPoint = express.Router();
const env = process.env.JWT_SECRET || "iuehdkif83br6w3bnskxJ9jT";

let db;

async function getCollection(collectionName) {
  if (!db) {
    db = await connectDB();
  }
  return db.collection(collectionName);
}

/* ---------------------------
   Registration endpoint (generic)
----------------------------*/
async function registerPoint(req, res, collectionName, type, nameField) {
  const {
    [nameField]: userNameOrserviceProviderName,
    email,
    password,
  } = req.body;

  if (!email || !password || !userNameOrserviceProviderName) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const collection = await getCollection(collectionName);
    const existing = await collection.findOne({ email });

    if (existing) {
      return res.status(409).json({
        message: `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } already exists`,
      });
    }

    // const hashedPassword = await bcrypt.hash(password, 10);
    await collection.insertOne({
      email,
      [nameField]: userNameOrserviceProviderName,
      password,
    });

    const token = JWT.sign(
      { [nameField]: userNameOrserviceProviderName, email },
      env,
      { expiresIn: "1h" },
    );

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

accessPoint.post("/signup-serviceProvider", (req, res) =>
  registerPoint(
    req,
    res,
    "serviceProviders",
    "Towing Service",
    "serviceProviderName",
  ),
);

accessPoint.post("/signup-user", (req, res) =>
  registerPoint(req, res, "users", "user", "userName"),
);

/* ---------------------------
   Login endpoint (generic)
----------------------------*/
async function loginPoint(req, res, collectionName, emailField, nameField) {
  const { [emailField]: providedEmail, password } = req.body;

  try {
    const collection = await getCollection(collectionName);
    const user = await collection.findOne({ [emailField]: providedEmail });

    // Basic validation: user exists and password matches
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = JWT.sign(
      {
        id: user._id,
        username: user[nameField],
        email: user[emailField],
        type: user.type,
      },
      env,
      { expiresIn: "1h" },
    );

    res.json({ message: "Login successful", token, name: user[nameField] });
  } catch (err) {
    console.error(`Error in /login-${collectionName}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

accessPoint.post("/login-serviceProvider", (req, res) =>
  loginPoint(req, res, "serviceProviders", "email", "serviceProviderName"),
);

accessPoint.post("/login-user", (req, res) =>
  loginPoint(req, res, "users", "email", "userName"),
);

/* ---------------------------
   Remove endpoints
----------------------------*/
async function removePoint(req, res, collectionName, nameField, type) {
  const nameValue = req.params[nameField];
  try {
    const collection = await getCollection(collectionName);
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

accessPoint.delete("/remove-serviceProvider/:serviceProviderName", (req, res) =>
  removePoint(
    req,
    res,
    "serviceProviders",
    "serviceProviderName",
    "serviceProvider",
  ),
);

accessPoint.delete("/remove-user/:userName", (req, res) =>
  removePoint(req, res, "users", "userName", "User"),
);

export default accessPoint;
