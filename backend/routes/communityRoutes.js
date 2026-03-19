const express = require("express");

const communityController = require("../controllers/communityController");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/http");

const router = express.Router();

router.use(requireAuth);

router.get("/bootstrap", asyncHandler(communityController.getBootstrap));
router.get("/users/search", asyncHandler(communityController.searchUsers));
router.post("/servers", asyncHandler(communityController.createServer));
router.get("/servers/search", asyncHandler(communityController.searchServers));
router.post("/servers/:id/leave", asyncHandler(communityController.leaveServer));
router.get("/servers/:id", asyncHandler(communityController.getServerDetails));
router.patch("/servers/:id", asyncHandler(communityController.updateServer));
router.delete("/servers/:id", asyncHandler(communityController.deleteServer));
router.post("/servers/:id/channels", asyncHandler(communityController.createChannel));
router.patch("/channels/:id", asyncHandler(communityController.updateChannel));
router.delete("/channels/:id", asyncHandler(communityController.deleteChannel));
router.post("/servers/:id/join-requests", asyncHandler(communityController.createJoinRequest));
router.post("/join-requests/:id/review", asyncHandler(communityController.reviewJoinRequest));
router.post("/servers/:serverId/members", asyncHandler(communityController.addMember));
router.delete(
  "/servers/:serverId/members/:userId",
  asyncHandler(communityController.removeMember)
);
router.post(
  "/servers/:serverId/members/:userId/role",
  asyncHandler(communityController.updateMemberRole)
);

module.exports = router;
