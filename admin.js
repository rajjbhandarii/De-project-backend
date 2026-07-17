import express from "express";
import JWT from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getCollection } from "./db.js";

const adminRouter = express.Router();
// const VALID_STATUSES = ["pending", "approved", "rejected"];

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET env variable is not set.");
  process.exit(1);
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return "";
  }
  return authorization.slice("Bearer ".length).trim();
}

function requireAdminAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ message: "Admin authorization token is required" });
  }

  try {
    const decoded = JWT.verify(token, JWT_SECRET);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("role" in decoded) ||
      decoded.role !== "admin"
    ) {
      return res.status(403).json({ message: "Invalid admin token" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    console.error("Error verifying admin token:", err);
    res.status(401).json({ message: "Invalid or expired admin token" });
  }
}

async function createAdmin(req, res, { requireAuth }) {
  const { adminName, email, password } = req.body;
  const normalizedAdminName =
    typeof adminName === "string" ? adminName.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  const normalizedPassword =
    typeof password === "string" ? password.trim() : "";

  if (!normalizedAdminName || !normalizedEmail || !normalizedPassword) {
    return res
      .status(400)
      .json({ message: "adminName, email and password are required" });
  }

  try {
    const adminsCollection = await getCollection("admins");
    const adminsCount = await adminsCollection.countDocuments();

    if (requireAuth && adminsCount > 0) {
      const token = getBearerToken(req);
      if (!token) {
        return res
          .status(401)
          .json({ message: "Admin authorization token is required" });
      }

      try {
        const decoded = JWT.verify(token, JWT_SECRET);
        if (
          typeof decoded !== "object" ||
          decoded === null ||
          !("role" in decoded) ||
          decoded.role !== "admin"
        ) {
          return res.status(403).json({ message: "Invalid admin token" });
        }
      } catch (err) {
        console.error("Error verifying admin token:", err);
        return res
          .status(401)
          .json({ message: "Invalid or expired admin token" });
      }
    }

    const existingAdmin = await adminsCollection.findOne({
      email: normalizedEmail,
    });
    if (existingAdmin) {
      return res.status(409).json({ message: "Admin email already exists" });
    }

    await adminsCollection.insertOne({
      adminName: normalizedAdminName,
      email: normalizedEmail,
      password: normalizedPassword,
      createdAt: new Date(),
    });

    res.status(201).json({ message: "Admin created successfully" });
  } catch (err) {
    console.error("Error creating admin:", err);
    res.status(500).json({ message: "Failed to create admin" });
  }
}

async function adminCreateAccount(req, res, collectionName, nameField) {
  const { [nameField]: name, email, password, status } = req.body;
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  const normalizedPassword =
    typeof password === "string" ? password.trim() : "";
  const normalizedStatus = status || "pending";

  if (!normalizedName || !normalizedEmail || !normalizedPassword) {
    return res
      .status(400)
      .json({ message: `${nameField}, email and password are required` });
  }

  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({
      message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`,
    });
  }

  try {
    const collection = await getCollection(collectionName);
    const existingByEmail = await collection.findOne({
      email: normalizedEmail,
    });
    if (existingByEmail) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const existingByName = await collection.findOne({
      [nameField]: normalizedName,
    });
    if (existingByName) {
      return res.status(409).json({ message: `${nameField} already exists` });
    }

    // Build document with all fields required by the main app
    const doc = {
      [nameField]: normalizedName,
      email: normalizedEmail,
      password: normalizedPassword,
      status: normalizedStatus,
      createdAt: new Date(),
    };

    if (collectionName === "users") {
      // Users need 'type', 'visual', and 'RequestedServcies' for the main frontend
      doc.type = "user";
      doc.visual = "light";
      doc.RequestedServcies = [];
    } else if (collectionName === "serviceProviders") {
      // Providers need empty arrays so the SP dashboard doesn't crash
      doc.type = "serviceProvider";
      doc.visual = "light";
      doc.services = [];
      doc.serviceRequestInfo = [];
    }

    await collection.insertOne(doc);

    res.status(201).json({ message: "Created successfully" });
  } catch (err) {
    console.error(`Error creating ${collectionName} from admin:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

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

// =====================================================================
// PUBLIC routes — no auth required
// =====================================================================
adminRouter.post("/admin/signup", async (req, res) =>
  createAdmin(req, res, { requireAuth: true }),
);

adminRouter.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  const normalizedPassword =
    typeof password === "string" ? password.trim() : "";

  if (!normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ message: "email and password are required" });
  }

  try {
    const adminsCollection = await getCollection("admins");
    const admin = await adminsCollection.findOne({ email: normalizedEmail });
    if (!admin || admin.password !== normalizedPassword) {
      return res.status(401).json({ message: "Invalid admin credentials" });
    }

    const token = JWT.sign(
      {
        id: admin._id.toString(),
        email: admin.email,
        adminName: admin.adminName,
        role: "admin",
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.json({
      message: "Admin login successful",
      token,
      adminName: admin.adminName,
    });
  } catch (err) {
    console.error("Error in admin login:", err);
    res.status(500).json({ message: "Failed to login admin" });
  }
});

// =====================================================================
// PROTECTED routes — requireAdminAuth applied inline to each route
// (avoids the prefix-matching issue of router.use("/admin", fn) which
// would also intercept /admin/login and /admin/signup)
// =====================================================================

adminRouter.get("/admin/admins", requireAdminAuth, async (_, res) => {
  try {
    const collection = await getCollection("admins");
    const admins = await collection
      .find(
        {},
        { projection: { _id: 1, adminName: 1, email: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    res.json(admins);
  } catch (err) {
    console.error("Error fetching admins:", err);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
});

adminRouter.post("/admin/admins", requireAdminAuth, async (req, res) =>
  createAdmin(req, res, { requireAuth: false }),
);

adminRouter.post("/admin/users", requireAdminAuth, (req, res) =>
  adminCreateAccount(req, res, "users", "userName"),
);

adminRouter.post("/admin/providers", requireAdminAuth, (req, res) =>
  adminCreateAccount(req, res, "serviceProviders", "serviceProviderName"),
);

adminRouter.delete("/admin/users/:userName", requireAdminAuth, (req, res) =>
  removePoint(req, res, "users", "userName", "User"),
);

// Note: providers are deleted by serviceProviderName (URL-encoded)
adminRouter.delete(
  "/admin/providers/:serviceProviderName",
  requireAdminAuth,
  (req, res) =>
    removePoint(
      req,
      res,
      "serviceProviders",
      "serviceProviderName",
      "serviceProvider",
    ),
);

adminRouter.get("/admin/users", requireAdminAuth, async (_, res) => {
  try {
    const collection = await getCollection("users");
    const users = await collection
      .find(
        {},
        {
          projection: {
            _id: 1,
            userName: 1,
            email: 1,
            status: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users for admin:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

adminRouter.get("/admin/providers", requireAdminAuth, async (_, res) => {
  try {
    const collection = await getCollection("serviceProviders");
    const providers = await collection
      .find(
        {},
        {
          projection: {
            _id: 1,
            serviceProviderName: 1,
            email: 1,
            status: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();
    res.json(providers);
  } catch (err) {
    console.error("Error fetching providers for admin:", err);
    res.status(500).json({ message: "Failed to fetch providers" });
  }
});

adminRouter.patch("/admin/users/:id", requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { userName, email } = req.body;
  console.log("body:", req.body);
  const normalizedUserName =
    typeof userName === "string" ? userName.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (!normalizedUserName || !normalizedEmail) {
    return res.status(400).json({ message: "userName and email are required" });
  }

  try {
    const collection = await getCollection("users");
    const userId = new ObjectId(id);

    const existingByEmail = await collection.findOne({
      _id: { $ne: userId },
      email: normalizedEmail,
    });
    console.log("existingByEmail:", existingByEmail);

    const existingByUserName = await collection.findOne({
      _id: { $ne: userId },
      userName: normalizedUserName,
    });

    if (existingByEmail && existingByUserName) {
      return res
        .status(409)
        .json({ message: "Email and UserName already exists" });
    }
    const result = await collection.updateOne(
      { _id: userId },
      {
        $set: {
          userName: normalizedUserName,
          email: normalizedEmail,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User details updated successfully" });
  } catch (err) {
    console.error("Error updating user details:", err);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// Edit provider name and email by MongoDB _id
adminRouter.patch(
  "/admin/providers/:id",
  requireAdminAuth,
  async (req, res) => {
    const { id } = req.params;
    const { serviceProviderName, email } = req.body;
    const normalizedName =
      typeof serviceProviderName === "string" ? serviceProviderName.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim() : "";

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid provider id" });
    }

    if (!normalizedName || !normalizedEmail) {
      return res
        .status(400)
        .json({ message: "serviceProviderName and email are required" });
    }

    try {
      const collection = await getCollection("serviceProviders");
      const providerId = new ObjectId(id);

      const existingByEmail = await collection.findOne({
        _id: { $ne: providerId },
        email: normalizedEmail,
      });

      const existingByName = await collection.findOne({
        _id: { $ne: providerId },
        serviceProviderName: normalizedName,
      });

      if (existingByEmail && existingByName) {
        return res
          .status(409)
          .json({ message: "Email and Provider name already exists" });
      }
      const result = await collection.updateOne(
        { _id: providerId },
        {
          $set: {
            serviceProviderName: normalizedName,
            email: normalizedEmail,
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "Service provider not found" });
      }

      res.json({ message: "Provider details updated successfully" });
    } catch (err) {
      console.error("Error updating provider details:", err);
      res.status(500).json({ message: "Failed to update provider" });
    }
  },
);

// PATCH /admin/providers/status — must be defined before /:serviceProviderName param route
// adminRouter.patch(
//   "/admin/providers/status",
//   requireAdminAuth,
//   async (req, res) => {
//     const { serviceProviderName, status } = req.body;

//     if (!serviceProviderName || !status) {
//       return res
//         .status(400)
//         .json({ message: "serviceProviderName and status are required" });
//     }

//     if (!VALID_STATUSES.includes(status)) {
//       return res.status(400).json({
//         message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`,
//       });
//     }

//     try {
//       const collection = await getCollection("serviceProviders");
//       const result = await collection.updateOne(
//         { serviceProviderName },
//         { $set: { status, updatedAt: new Date() } },
//       );

//       if (result.matchedCount === 0) {
//         return res.status(404).json({ message: "Service provider not found" });
//       }

//       res.json({ message: "Service provider status updated successfully" });
//     } catch (err) {
//       console.error("Error updating service provider status:", err);
//       res.status(500).json({ message: "Failed to update provider status" });
//     }
//   },
// );

export default adminRouter;
