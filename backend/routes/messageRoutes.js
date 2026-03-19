const express = require("express");
const router = express.Router();
const messageController = require("../controllers/messageController");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/http");

router.use(requireAuth);

router.get("/channels/:id/messages", asyncHandler(messageController.getMessages));
router.post("/channels/:id/messages", asyncHandler(messageController.sendMessage));
router.patch("/messages/:id", asyncHandler(messageController.editMessage));
router.delete("/messages/:id", asyncHandler(messageController.deleteMessage));

module.exports = router;
