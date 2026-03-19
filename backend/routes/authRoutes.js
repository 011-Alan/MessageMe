const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/http");

router.post("/register", asyncHandler(authController.register));
router.post("/login", asyncHandler(authController.login));
router.get("/session", requireAuth, asyncHandler(authController.getSession));
router.post("/logout", requireAuth, asyncHandler(authController.logout));

module.exports = router;
