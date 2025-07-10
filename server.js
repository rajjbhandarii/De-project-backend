const express = require("express");
const connectDB = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
});
