const { httpError } = require("./http");

function normalizeChannelName(name = "") {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "general";
}

function canManageServer(user, context) {
  return (
    user.appRole === "ADMIN" ||
    Number(context.OWNER_ID) === Number(user.userId) ||
    context.SERVER_ROLE === "ADMIN"
  );
}

function canEditRoles(user, context) {
  return canManageServer(user, context);
}

function canAddMembersToServer(user, context) {
  return Number(context.OWNER_ID) === Number(user.userId) || context.SERVER_ROLE === "ADMIN";
}

function serializeServer(row, currentUser) {
  const role =
    row.SERVER_ROLE ||
    (Number(row.OWNER_ID) === Number(currentUser?.userId) ? "ADMIN" : "MEMBER");

  return {
    serverId: Number(row.SERVER_ID),
    name: row.SERVER_NAME,
    description: row.DESCRIPTION || "",
    accentColor: row.ACCENT_COLOR || "#7C5CFF",
    inviteCode: row.INVITE_CODE,
    isPrivate: Number(row.IS_PRIVATE || 0) === 1,
    ownerId: Number(row.OWNER_ID),
    memberCount: Number(row.MEMBER_COUNT || 0),
    channelCount: Number(row.CHANNEL_COUNT || 0),
    role,
    isOwner: Number(row.OWNER_ID) === Number(currentUser?.userId),
    canManage: currentUser ? canManageServer(currentUser, row) : false,
  };
}

function serializeChannel(row) {
  return {
    channelId: Number(row.CHANNEL_ID),
    name: row.CHANNEL_NAME,
    topic: row.CHANNEL_TOPIC || "",
    position: Number(row.POSITION || 0),
    createdAt: row.CREATED_AT,
  };
}

function serializeMember(row, currentUser, serverContext) {
  const isSelf = Number(row.USER_ID) === Number(currentUser.userId);
  const canManage = canManageServer(currentUser, serverContext);
  const canEdit = canEditRoles(currentUser, serverContext);
  const isOwner = Number(row.USER_ID) === Number(serverContext.OWNER_ID);

  return {
    userId: Number(row.USER_ID),
    username: row.USERNAME,
    displayName: row.DISPLAY_NAME,
    appRole: row.APP_ROLE,
    serverRole: row.SERVER_ROLE,
    avatarColor: row.AVATAR_COLOR,
    joinDate: row.JOIN_DATE,
    isOwner,
    isSelf,
    canRemove: canManage && !isSelf && !isOwner,
    canToggleRole: canEdit && !isOwner && !isSelf,
  };
}

function serializeJoinRequest(row) {
  return {
    requestId: Number(row.REQUEST_ID),
    userId: Number(row.USER_ID),
    username: row.USERNAME,
    displayName: row.DISPLAY_NAME,
    avatarColor: row.AVATAR_COLOR,
    requestMessage: row.REQUEST_MESSAGE || "",
    requestDate: row.REQUEST_DATE,
    status: row.STATUS,
  };
}

async function getServerMembership(connection, serverId, userId) {
  const result = await connection.execute(
    `SELECT s.server_id,
            s.server_name,
            s.description,
            s.owner_id,
            s.is_private,
            s.invite_code,
            s.accent_color,
            sm.server_role,
            (SELECT COUNT(*)
               FROM SERVER_MEMBERS sm2
              WHERE sm2.server_id = s.server_id) AS member_count,
            (SELECT COUNT(*)
               FROM CHANNELS c
              WHERE c.server_id = s.server_id) AS channel_count
       FROM SERVERS s
       JOIN SERVER_MEMBERS sm
         ON sm.server_id = s.server_id
      WHERE s.server_id = :serverId
        AND sm.user_id = :userId`,
    { serverId, userId }
  );

  return result.rows[0] || null;
}

async function requireServerMembership(connection, serverId, user) {
  const context = await getServerMembership(connection, serverId, user.userId);

  if (!context) {
    throw httpError(403, "Join this server before opening channels or chats.");
  }

  return context;
}

async function getChannelContext(connection, channelId, userId) {
  const result = await connection.execute(
    `SELECT c.channel_id,
            c.channel_name,
            c.channel_topic,
            c.server_id,
            s.server_name,
            s.owner_id,
            s.accent_color,
            sm.server_role
       FROM CHANNELS c
       JOIN SERVERS s
         ON s.server_id = c.server_id
       JOIN SERVER_MEMBERS sm
         ON sm.server_id = s.server_id
      WHERE c.channel_id = :channelId
        AND sm.user_id = :userId`,
    { channelId, userId }
  );

  return result.rows[0] || null;
}

async function requireChannelMembership(connection, channelId, userId) {
  const context = await getChannelContext(connection, channelId, userId);

  if (!context) {
    throw httpError(403, "You do not have access to that channel.");
  }

  return context;
}

module.exports = {
  normalizeChannelName,
  canManageServer,
  canEditRoles,
  canAddMembersToServer,
  serializeServer,
  serializeChannel,
  serializeMember,
  serializeJoinRequest,
  getServerMembership,
  requireServerMembership,
  getChannelContext,
  requireChannelMembership,
};
