const express = require("express");
const connectDB = require("./db");
const cors = require("cors");
// const bcrypt = require("bcrypt");
const JWT = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
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
  const {
    [nameField]: userNameOrserviceProviderName,
    email,
    password,
  } = req.body;

  try {
    const collection = getCollection(collectionName);
    const existing = await collection.findOne({
      email: email,
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
      email,
      [nameField]: userNameOrserviceProviderName,
      password,
    });

    // Create JWT token after registration
    const token = JWT.sign(
      {
        [nameField]: userNameOrserviceProviderName,
        email: email,
      },
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

app.post("/signup-serviceProvider", (req, res) =>
  registerPoint(
    req,
    res,
    "serviceProviders",
    "Towing Service",
    "serviceProviderName"
  )
);

app.post("/signup-user", (req, res) => {
  registerPoint(req, res, "users", "user", "userName");
});

async function loginPoint(req, res, collectionName, emailField, NameField) {
  const { [emailField]: userOrServiceProviderEmail, password } = req.body;
  try {
    const collection = getCollection(collectionName);
    const user = await collection.findOne({
      [emailField]: userOrServiceProviderEmail,
    });

    //  Unified error for both username and password issues
    // if (!user || !(await bcrypt.compare(password, user.password))) {
    //   return res.status(401).json({ message: "Invalid email or password" });
    // }
    if (
      !user.email === userOrServiceProviderEmail ||
      user.password !== password
    ) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    //  Create JWT token with _id, username/serviceProviderName, and type
    const token = JWT.sign(
      {
        id: user._id,
        username: user[NameField] || user[serviceProviderNameField],
        email: user[emailField],
        type: user.type,
      },
      env,
      { expiresIn: "1h" }
    );
    res.json({ message: "Login successful", token, name: user[NameField] });
  } catch (err) {
    console.error(`Error in /login-${collectionName}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

app.post("/login-serviceProvider", (req, res) =>
  loginPoint(req, res, "serviceProviders", "email", "serviceProviderName")
);

app.post("/login-user", (req, res) =>
  loginPoint(req, res, "users", "email", "userName")
);

//remove user or serviceProvider from the database
// Generic remove endpoint for serviceProvider/user
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

app.delete("/remove-serviceProvider/:serviceProviderName", (req, res) =>
  removePoint(
    req,
    res,
    "serviceProviders",
    "serviceProviderName",
    "serviceProvider"
  )
);

app.delete("/remove-user/:serviceProviderName", (req, res) =>
  removePoint(req, res, "users", "serviceProviderceProviderName", "User")
);

//fetch on user component
app.get("/services/fetch-serviceProvider", async (req, res) => {
  try {
    const serviceProvidersCollection = await getCollection("serviceProviders");
    const serviceProvider = await serviceProvidersCollection
      .find(
        {},
        {
          //this will be fetch from database
          projection: {
            _id: 1,
            serviceProviderName: 1,
            services: 1,
          },
        }
      )
      .toArray();
    res.json(serviceProvider);
  } catch (err) {
    console.error("Error fetching service providers:", err);
    res.status(500).json({ message: "Failed to fetch service providers" });
  }
});

//fetch on user component
app.post("/services/request-services", async (req, res) => {
  const {
    _id: providerId,
    userName,
    userLocation,
    category,
    requestServiceId,
  } = req.body;
  try {
    if (!providerId || !ObjectId.isValid(providerId)) {
      return res.status(400).json({ message: "Invalid or missing providerId" });
    }
    if (!ObjectId.isValid(providerId)) {
      return res.status(400).json({ message: "Invalid provider ID" });
    }

    const serviceProvidersCollection = await getCollection("serviceProviders");

    const providerObjectId = ObjectId.createFromHexString(providerId);
    const modifiedServiceProviderRecord =
      await serviceProvidersCollection.updateOne(
        { _id: providerObjectId },
        {
          $push: {
            serviceRequestInfo: {
              requestServiceId,
              userName,
              userLocation,
              category,
            },
          },
        }
      );
    if (modifiedServiceProviderRecord.matchedCount === 0) {
      return res.status(404).json({ message: "Service provider not found" });
    } else {
      console.log("Service request recorded successfully");
      res
        .status(201)
        .json({ message: "Service request recorded successfully" });
    }
  } catch (err) {
    console.error("Error inserting service request:", err);
    res.status(500).json({ message: "Failed to process service request" });
  }
});

//fetch on serviceProvider Dashboard component
app.post("/dashboard/fetch-servicesRequests", async (req, res) => {
  const { serviceProviderEmail } = req.body;
  try {
    const serviceProvidersCollection = await getCollection("serviceProviders");
    const serviceProvider = await serviceProvidersCollection.findOne(
      { email: serviceProviderEmail },
      { projection: { serviceRequestInfo: 1, id: 1 } }
    );
    if (!serviceProvider) {
      return res.status(404).json({ message: "Service provider not found" });
    } else {
      res.json(serviceProvider.serviceRequestInfo);
    }
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

//add new service to database
app.post("/serviceManagement/addNewServices", async (req, res) => {
  try {
    const {
      serviceId,
      serviceProviderEmail,
      name,
      price,
      category,
      description,
    } = req.body;
    const serviceProvidersCollection = await getCollection("serviceProviders");
    const modifiedServiceProviderRecord =
      await serviceProvidersCollection.updateOne(
        { email: serviceProviderEmail },
        {
          $push: {
            services: {
              serviceId,
              serviceName: name,
              price: price,
              category: category,
              description: description,
              rating: 4.5,
            },
          },
        }
      );
    res.status(201).json({
      message: "Service added successfully",
      // serviceId: result.insertedId,
    });
  } catch (err) {
    console.error("Error adding service:", err);
    res.status(500).json({ message: "Failed to add service" });
  }
});

async function startServer() {
  try {
    db = await connectDB();
    // Ensure unique index on serviceProviderName for serviceProviders collection
    await db
      .collection("serviceProviders")
      .createIndex({ email: 1 }, { unique: true });
    // Ensure unique index on email for users collection
    await db.collection("users").createIndex({ email: 1 }, { unique: true });

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

startServer();
