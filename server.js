const express = require("express");
const connectDB = require("./db");
const cors = require("cors");
const bcrypt = require("bcrypt");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let db;
connectDB()
  .then((db) => {
    //add username and password to the database
    app.post("/add-user", async (req, res) => {
      const { username, password } = req.body;

      try {
        const collection = db.collection("users");

        const userExists = await collection.findOne({ username });
        if (userExists) {
          return res.status(409).json({ message: "Username already exists" });
        }
        // Passwords are hashed before storage; storing plain passwords is insecure and should never be done, even for demonstration purposes.
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await collection.insertOne({
          username,
          password: hashedPassword,
        });
        res.status(201).json({
          message: "User added successfully",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding user:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  });
