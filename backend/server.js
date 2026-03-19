const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

const authRoutes = require("./routes/authRoutes");
const communityRoutes = require("./routes/communityRoutes");
const messageRoutes = require("./routes/messageRoutes");
const { closePool } = require("./config/db");
const { upgradeLegacySchema } = require("../database/migrate-legacy-schema");

const app = express();
const frontendDirectory = path.join(__dirname, "../frontend");
const uploadsDirectory = path.join(frontendDirectory, "uploads");
const port = Number(process.env.PORT || 3000);

async function ensureStorage() {
  await fs.mkdir(uploadsDirectory, { recursive: true });
}

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "35mb" }));
app.use(express.urlencoded({ extended: true, limit: "35mb" }));
app.use("/uploads", express.static(uploadsDirectory));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendDirectory, "index.html"));
});

app.use(express.static(frontendDirectory));
app.use("/api/auth", authRoutes);
app.use("/api", communityRoutes);
app.use("/api", messageRoutes);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  console.error(error);
  res.status(error.status || 500).json({
    message: error.message || "Something went wrong on the server.",
  });
});

Promise.resolve()
  .then(() => upgradeLegacySchema())
  .then(() => ensureStorage())
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to prepare storage", error);
    process.exit(1);
  });

async function shutdown() {
  try {
    await closePool();
  } catch (error) {
    console.error("Failed to close Oracle pool cleanly", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
