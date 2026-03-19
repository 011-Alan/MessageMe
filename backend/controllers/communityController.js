const oracledb = require("oracledb");

const { withConnection } = require("../config/db");
const { httpError } = require("../utils/http");
const { executePlsql } = require("../utils/oracle");
const {
  canAddMembersToServer,
  canEditRoles,
  canManageServer,
  normalizeChannelName,
  requireServerMembership,
  serializeChannel,
  serializeJoinRequest,
  serializeMember,
  serializeServer,
} = require("../utils/community");
const { generateInviteCode, pickAvatarColor } = require("../utils/security");

let usersColumnCache;

async function getUsersColumns(connection) {
  if (!usersColumnCache) {
    const result = await connection.execute(
      `SELECT column_name
         FROM user_tab_columns
        WHERE table_name = 'USERS'`
    );

    usersColumnCache = new Set(result.rows.map((row) => row.COLUMN_NAME));
  }

  return usersColumnCache;
}

async function ensureUniqueServerName(connection, serverName, excludedServerId = null) {
  const result = await connection.execute(
    `SELECT server_id
       FROM SERVERS
      WHERE LOWER(server_name) = LOWER(:serverName)
        AND (:excludedServerId IS NULL OR server_id <> :excludedServerId)`,
    {
      serverName,
      excludedServerId,
    }
  );

  if (result.rows.length > 0) {
    throw httpError(409, "Server names must be unique.");
  }
}

async function deleteChannelData(connection, channelId) {
  await connection.execute(
    `DELETE FROM ATTACHMENTS
      WHERE MESSAGE_ID IN (
        SELECT MESSAGE_ID
          FROM MESSAGES
         WHERE CHANNEL_ID = :channelId
      )`,
    { channelId }
  );

  await connection.execute(
    `DELETE FROM CHANNEL_READ_STATE
      WHERE CHANNEL_ID = :channelId`,
    { channelId }
  );

  await connection.execute(
    `DELETE FROM MESSAGES
      WHERE CHANNEL_ID = :channelId`,
    { channelId }
  );

  await connection.execute(
    `DELETE FROM CHANNELS
      WHERE CHANNEL_ID = :channelId`,
    { channelId }
  );
}

async function deleteServerData(connection, serverId) {
  await connection.execute(
    `DELETE FROM ATTACHMENTS
      WHERE MESSAGE_ID IN (
        SELECT m.MESSAGE_ID
          FROM MESSAGES m
          JOIN CHANNELS c
            ON c.CHANNEL_ID = m.CHANNEL_ID
         WHERE c.SERVER_ID = :serverId
      )`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM CHANNEL_READ_STATE
      WHERE CHANNEL_ID IN (
        SELECT CHANNEL_ID
          FROM CHANNELS
         WHERE SERVER_ID = :serverId
      )`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM MESSAGES
      WHERE CHANNEL_ID IN (
        SELECT CHANNEL_ID
          FROM CHANNELS
         WHERE SERVER_ID = :serverId
      )`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM CHANNELS
      WHERE SERVER_ID = :serverId`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM SERVER_JOIN_REQUESTS
      WHERE SERVER_ID = :serverId`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM SERVER_MEMBERS
      WHERE SERVER_ID = :serverId`,
    { serverId }
  );

  await connection.execute(
    `DELETE FROM SERVERS
      WHERE SERVER_ID = :serverId`,
    { serverId }
  );
}

async function removeServerMembershipData(connection, serverId, userId) {
  await connection.execute(
    `DELETE FROM CHANNEL_READ_STATE
      WHERE USER_ID = :userId
        AND CHANNEL_ID IN (
          SELECT CHANNEL_ID
            FROM CHANNELS
           WHERE SERVER_ID = :serverId
        )`,
    {
      userId,
      serverId,
    }
  );

  await connection.execute(
    `DELETE FROM SERVER_JOIN_REQUESTS
      WHERE SERVER_ID = :serverId
        AND USER_ID = :userId`,
    {
      serverId,
      userId,
    }
  );

  await connection.execute(
    `DELETE FROM SERVER_MEMBERS
      WHERE SERVER_ID = :serverId
        AND USER_ID = :userId`,
    {
      serverId,
      userId,
    }
  );
}

async function findNextServerOwner(connection, serverId, excludedUserId) {
  const result = await connection.execute(
    `SELECT USER_ID,
            SERVER_ROLE
       FROM SERVER_MEMBERS
      WHERE SERVER_ID = :serverId
        AND USER_ID <> :excludedUserId
      ORDER BY CASE SERVER_ROLE WHEN 'ADMIN' THEN 0 ELSE 1 END,
               JOIN_DATE,
               USER_ID
      FETCH FIRST 1 ROWS ONLY`,
    {
      serverId,
      excludedUserId,
    }
  );

  return result.rows[0] || null;
}

async function loadServerDetails(connection, serverId, user) {
  const serverContext = await requireServerMembership(connection, serverId, user);
  const canManage = canManageServer(user, serverContext);
  const canManageRoles = canEditRoles(user, serverContext);

  const channelsResult = await connection.execute(
    `SELECT CHANNEL_ID,
            CHANNEL_NAME,
            CHANNEL_TOPIC,
            POSITION,
            CREATED_AT
       FROM CHANNELS
      WHERE SERVER_ID = :serverId
      ORDER BY POSITION, CREATED_AT`,
    { serverId }
  );

  const membersResult = await connection.execute(
    `SELECT u.USER_ID,
            u.USERNAME,
            NVL(u.DISPLAY_NAME, u.USERNAME) AS DISPLAY_NAME,
            NVL(u.APP_ROLE, 'USER') AS APP_ROLE,
            NVL(u.AVATAR_COLOR, '#7C5CFF') AS AVATAR_COLOR,
            sm.SERVER_ROLE,
            sm.JOIN_DATE
       FROM SERVER_MEMBERS sm
       JOIN USERS u
         ON u.USER_ID = sm.USER_ID
      WHERE sm.SERVER_ID = :serverId
      ORDER BY CASE sm.SERVER_ROLE WHEN 'ADMIN' THEN 0 ELSE 1 END,
               LOWER(NVL(u.DISPLAY_NAME, u.USERNAME)),
               LOWER(u.USERNAME)`,
    { serverId }
  );

  let joinRequests = [];

  if (canManage) {
    const joinRequestsResult = await connection.execute(
      `SELECT r.REQUEST_ID,
              r.USER_ID,
              r.REQUEST_MESSAGE,
              r.REQUEST_DATE,
              r.STATUS,
              u.USERNAME,
              NVL(u.DISPLAY_NAME, u.USERNAME) AS DISPLAY_NAME,
              NVL(u.AVATAR_COLOR, '#7C5CFF') AS AVATAR_COLOR
         FROM SERVER_JOIN_REQUESTS r
         JOIN USERS u
           ON u.USER_ID = r.USER_ID
        WHERE r.SERVER_ID = :serverId
          AND r.STATUS = 'PENDING'
        ORDER BY r.REQUEST_DATE`,
      { serverId }
    );

    joinRequests = joinRequestsResult.rows.map(serializeJoinRequest);
  }

  return {
    server: serializeServer(serverContext, user),
    channels: channelsResult.rows.map(serializeChannel),
    members: membersResult.rows.map((row) => serializeMember(row, user, serverContext)),
    joinRequests,
    permissions: {
      canManage,
      canManageRoles,
      canCreateChannel: canManage,
      canDeleteServer: Number(serverContext.OWNER_ID) === Number(user.userId),
    },
  };
}

exports.getBootstrap = async (req, res) => {
  const payload = await withConnection(async (connection) => {
    const joinedServersResult = await connection.execute(
      `SELECT s.SERVER_ID,
              s.SERVER_NAME,
              s.DESCRIPTION,
              s.OWNER_ID,
              s.IS_PRIVATE,
              s.INVITE_CODE,
              s.ACCENT_COLOR,
              sm.SERVER_ROLE,
              (SELECT COUNT(*)
                 FROM SERVER_MEMBERS sm2
                WHERE sm2.SERVER_ID = s.SERVER_ID) AS MEMBER_COUNT,
              (SELECT COUNT(*)
                 FROM CHANNELS c
                WHERE c.SERVER_ID = s.SERVER_ID) AS CHANNEL_COUNT
         FROM SERVERS s
         JOIN SERVER_MEMBERS sm
           ON sm.SERVER_ID = s.SERVER_ID
        WHERE sm.USER_ID = :userId
        ORDER BY s.CREATED_AT`,
      { userId: req.user.userId }
    );

    const discoverServersResult = await connection.execute(
      `SELECT s.SERVER_ID,
              s.SERVER_NAME,
              s.DESCRIPTION,
              s.OWNER_ID,
              s.IS_PRIVATE,
              s.INVITE_CODE,
              s.ACCENT_COLOR,
              (SELECT COUNT(*)
                 FROM SERVER_MEMBERS sm2
                WHERE sm2.SERVER_ID = s.SERVER_ID) AS MEMBER_COUNT,
              (SELECT COUNT(*)
                 FROM CHANNELS c
                WHERE c.SERVER_ID = s.SERVER_ID) AS CHANNEL_COUNT,
              (SELECT COUNT(*)
                 FROM SERVER_JOIN_REQUESTS r
                WHERE r.SERVER_ID = s.SERVER_ID
                  AND r.USER_ID = :userId
                  AND r.STATUS = 'PENDING') AS PENDING_REQUEST_COUNT
         FROM SERVERS s
        WHERE NOT EXISTS (
              SELECT 1
                FROM SERVER_MEMBERS sm
               WHERE sm.SERVER_ID = s.SERVER_ID
                 AND sm.USER_ID = :userId
             )
        ORDER BY s.CREATED_AT DESC`,
      { userId: req.user.userId }
    );

    return {
      user: req.user,
      joinedServers: joinedServersResult.rows.map((row) => serializeServer(row, req.user)),
      discoverServers: discoverServersResult.rows.map((row) => ({
        ...serializeServer(row, req.user),
        hasPendingRequest: Number(row.PENDING_REQUEST_COUNT || 0) > 0,
      })),
    };
  });

  res.json(payload);
};

exports.searchServers = async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const searchTerm = query ? `%${query}%` : "%";
  const prefixTerm = query ? `${query}%` : "%";

  const payload = await withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT s.SERVER_ID,
              s.SERVER_NAME,
              s.DESCRIPTION,
              s.OWNER_ID,
              s.IS_PRIVATE,
              s.INVITE_CODE,
              s.ACCENT_COLOR,
              (SELECT COUNT(*)
                 FROM SERVER_MEMBERS sm2
                WHERE sm2.SERVER_ID = s.SERVER_ID) AS MEMBER_COUNT,
              (SELECT COUNT(*)
                 FROM CHANNELS c
                WHERE c.SERVER_ID = s.SERVER_ID) AS CHANNEL_COUNT,
              (SELECT COUNT(*)
                 FROM SERVER_JOIN_REQUESTS r
                WHERE r.SERVER_ID = s.SERVER_ID
                  AND r.USER_ID = :userId
                  AND r.STATUS = 'PENDING') AS PENDING_REQUEST_COUNT
         FROM SERVERS s
         WHERE NOT EXISTS (
               SELECT 1
                 FROM SERVER_MEMBERS sm
                WHERE sm.SERVER_ID = s.SERVER_ID
                  AND sm.USER_ID = :userId
              )
           AND LOWER(s.SERVER_NAME) LIKE :searchTerm
         ORDER BY CASE
                    WHEN LOWER(s.SERVER_NAME) = :query THEN 0
                    WHEN LOWER(s.SERVER_NAME) LIKE :prefixTerm THEN 1
                    ELSE 2
                  END,
                  LOWER(s.SERVER_NAME),
                  s.CREATED_AT DESC
         FETCH FIRST 25 ROWS ONLY`,
      {
        userId: req.user.userId,
        searchTerm,
        prefixTerm,
        query,
      }
    );

    return {
      servers: result.rows.map((row) => ({
        ...serializeServer(row, req.user),
        hasPendingRequest: Number(row.PENDING_REQUEST_COUNT || 0) > 0,
      })),
    };
  });

  res.json(payload);
};

exports.searchUsers = async (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const serverId = req.query.serverId ? Number(req.query.serverId) : null;

  const payload = await withConnection(async (connection) => {
    if (!query) {
      return { users: [] };
    }

    const usersColumns = await getUsersColumns(connection);
    const hasDisplayName = usersColumns.has("DISPLAY_NAME");
    const hasAppRole = usersColumns.has("APP_ROLE");
    const hasAvatarColor = usersColumns.has("AVATAR_COLOR");
    const displayExpr = hasDisplayName ? "NVL(u.DISPLAY_NAME, u.USERNAME)" : "u.USERNAME";
    const appRoleExpr = hasAppRole ? "NVL(u.APP_ROLE, 'USER')" : "'USER'";
    const avatarExpr = hasAvatarColor ? "NVL(u.AVATAR_COLOR, '#7C5CFF')" : "'#7C5CFF'";
    const prefixTerm = `${query}%`;

    if (serverId) {
      const serverContext = await requireServerMembership(connection, serverId, req.user);

      if (!canAddMembersToServer(req.user, serverContext)) {
        throw httpError(403, "Only server owners or admins can add people from search.");
      }
    }

    const searchTerm = query ? `%${query}%` : "%";
    const result = await connection.execute(
      `SELECT u.USER_ID,
              u.USERNAME,
              ${displayExpr} AS DISPLAY_NAME,
              ${appRoleExpr} AS APP_ROLE,
              ${avatarExpr} AS AVATAR_COLOR,
              CASE WHEN sm.USER_ID IS NULL THEN 0 ELSE 1 END AS IS_MEMBER,
              sm.SERVER_ROLE
         FROM USERS u
         LEFT JOIN SERVER_MEMBERS sm
           ON sm.USER_ID = u.USER_ID
           AND (:serverId IS NOT NULL AND sm.SERVER_ID = :serverId)
         WHERE LOWER(u.USERNAME) LIKE :searchTerm
            OR LOWER(${displayExpr}) LIKE :searchTerm
         ORDER BY CASE
                  WHEN LOWER(u.USERNAME) = :query THEN 0
                  WHEN LOWER(${displayExpr}) = :query THEN 1
                  WHEN LOWER(u.USERNAME) LIKE :prefixTerm THEN 2
                  WHEN LOWER(${displayExpr}) LIKE :prefixTerm THEN 3
                  ELSE 4
                  END,
                  LOWER(${displayExpr}),
                  LOWER(u.USERNAME)
         FETCH FIRST 25 ROWS ONLY`,
      {
        serverId,
        searchTerm,
        prefixTerm,
        query,
      }
    );

    return {
      users: result.rows.map((row) => ({
        userId: Number(row.USER_ID),
        username: row.USERNAME,
        displayName: row.DISPLAY_NAME,
        appRole: row.APP_ROLE,
        avatarColor: row.AVATAR_COLOR,
        isMember: Number(row.IS_MEMBER || 0) === 1,
        serverRole: row.SERVER_ROLE || null,
      })),
    };
  });

  res.json(payload);
};

exports.createServer = async (req, res) => {
  const serverName = String(req.body.serverName || "").trim();
  const description = String(req.body.description || "").trim();
  const isPrivate = req.body.isPrivate ? 1 : 0;
  const initialChannelName = normalizeChannelName(req.body.initialChannelName || "general");
  const accentColor = pickAvatarColor(serverName || req.user.username);

  if (!serverName) {
    throw httpError(400, "Server name is required.");
  }

  const created = await withConnection(async (connection) => {
    const serverInsertResult = await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.CREATE_SERVER(
           P_SERVER_NAME => :serverName,
           P_DESCRIPTION => :description,
           P_OWNER_ID => :ownerId,
           P_IS_PRIVATE => :isPrivate,
           P_INVITE_CODE => :inviteCode,
           P_ACCENT_COLOR => :accentColor,
           P_INITIAL_CHANNEL_NAME => :initialChannelName,
           P_INITIAL_CHANNEL_TOPIC => :initialChannelTopic,
           P_SERVER_ID => :serverId
         );
       END;`,
      {
        serverName,
        description,
        ownerId: req.user.userId,
        isPrivate,
        inviteCode: generateInviteCode(),
        accentColor,
        initialChannelName,
        initialChannelTopic: "Welcome to your first channel.",
        serverId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    const serverId = Number(serverInsertResult.outBinds.serverId);

    await connection.commit();

    return loadServerDetails(connection, serverId, req.user);
  });

  res.status(201).json({
    message: "Server created.",
    ...created,
  });
};

exports.updateServer = async (req, res) => {
  const serverId = Number(req.params.id);
  const serverName = String(req.body.serverName || "").trim();
  const description = String(req.body.description || "").trim();
  const isPrivate = req.body.isPrivate ? 1 : 0;

  if (!serverId || !serverName) {
    throw httpError(400, "A valid server id and unique server name are required.");
  }

  const details = await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.UPDATE_SERVER(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_SERVER_NAME => :serverName,
           P_DESCRIPTION => :description,
           P_IS_PRIVATE => :isPrivate
         );
       END;`,
      {
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        serverName,
        description,
        isPrivate,
        serverId,
      }
    );

    await connection.commit();
    return loadServerDetails(connection, serverId, req.user);
  });

  res.json({
    message: "Server updated.",
    ...details,
  });
};

exports.deleteServer = async (req, res) => {
  const serverId = Number(req.params.id);

  if (!serverId) {
    throw httpError(400, "A valid server id is required.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.DELETE_SERVER(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
      }
    );

    await connection.commit();
  });

  res.json({ message: "Server deleted." });
};

exports.leaveServer = async (req, res) => {
  const serverId = Number(req.params.id);

  if (!serverId) {
    throw httpError(400, "A valid server id is required.");
  }

  const payload = await withConnection(async (connection) => {
    const result = await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.LEAVE_SERVER(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_DELETED_SERVER => :deletedServer,
           P_TRANSFERRED_OWNERSHIP => :transferredOwnership,
           P_NEW_OWNER_USER_ID => :newOwnerUserId
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        deletedServer: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        transferredOwnership: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        newOwnerUserId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    await connection.commit();

    const deletedServer = Number(result.outBinds.deletedServer || 0) === 1;
    const transferredOwnership = Number(result.outBinds.transferredOwnership || 0) === 1;
    const newOwnerUserId = result.outBinds.newOwnerUserId
      ? Number(result.outBinds.newOwnerUserId)
      : null;

    return {
      message: deletedServer
        ? "You left the server. It had no other members, so it was removed."
        : transferredOwnership
          ? "You left the server and ownership was transferred automatically."
          : "You left the server.",
      deletedServer,
      transferredOwnership,
      newOwnerUserId,
    };
  });

  res.json(payload);
};

exports.getServerDetails = async (req, res) => {
  const serverId = Number(req.params.id);

  if (!serverId) {
    throw httpError(400, "A valid server id is required.");
  }

  const details = await withConnection((connection) =>
    loadServerDetails(connection, serverId, req.user)
  );

  res.json(details);
};

exports.createChannel = async (req, res) => {
  const serverId = Number(req.params.id);
  const channelName = normalizeChannelName(req.body.channelName || "");
  const channelTopic = String(req.body.channelTopic || "").trim();

  if (!serverId || !channelName) {
    throw httpError(400, "Channel name is required.");
  }

  const channel = await withConnection(async (connection) => {
    const insertResult = await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.CREATE_CHANNEL(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_CHANNEL_NAME => :channelName,
           P_CHANNEL_TOPIC => :channelTopic,
           P_CHANNEL_ID => :channelId,
           P_POSITION => :position
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        channelName,
        channelTopic,
        channelId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        position: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    await connection.commit();

    return {
      channelId: Number(insertResult.outBinds.channelId),
      name: channelName,
      topic: channelTopic,
      position: Number(insertResult.outBinds.position || 1),
    };
  });

  res.status(201).json({
    message: "Channel created.",
    channel,
  });
};

exports.updateChannel = async (req, res) => {
  const channelId = Number(req.params.id);
  const channelName = normalizeChannelName(req.body.channelName || "");
  const channelTopic = String(req.body.channelTopic || "").trim();

  if (!channelId || !channelName) {
    throw httpError(400, "A valid channel id and name are required.");
  }

  const updated = await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.UPDATE_CHANNEL(
           P_CHANNEL_ID => :channelId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_CHANNEL_NAME => :channelName,
           P_CHANNEL_TOPIC => :channelTopic
         );
       END;`,
      {
        channelId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        channelName,
        channelTopic,
      }
    );

    await connection.commit();

    return {
      channelId,
      name: channelName,
      topic: channelTopic,
    };
  });

  res.json({
    message: "Channel updated.",
    channel: updated,
  });
};

exports.deleteChannel = async (req, res) => {
  const channelId = Number(req.params.id);

  if (!channelId) {
    throw httpError(400, "A valid channel id is required.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.DELETE_CHANNEL(
           P_CHANNEL_ID => :channelId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole
         );
       END;`,
      {
        channelId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
      }
    );

    await connection.commit();
  });

  res.json({ message: "Channel deleted." });
};

exports.createJoinRequest = async (req, res) => {
  const serverId = Number(req.params.id);
  const requestMessage = String(req.body.requestMessage || "").trim().slice(0, 250);

  if (!serverId) {
    throw httpError(400, "A valid server id is required.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.CREATE_JOIN_REQUEST(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_REQUEST_MESSAGE => :requestMessage
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        requestMessage,
      }
    );

    await connection.commit();
  });

  res.status(201).json({ message: "Join request sent to the server admins." });
};

exports.reviewJoinRequest = async (req, res) => {
  const requestId = Number(req.params.id);
  const reviewStatus = String(req.body.status || "").trim().toUpperCase();

  if (!requestId || !["APPROVED", "REJECTED"].includes(reviewStatus)) {
    throw httpError(400, "Review status must be APPROVED or REJECTED.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.REVIEW_JOIN_REQUEST(
           P_REQUEST_ID => :requestId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_STATUS => :reviewStatus
         );
       END;`,
      {
        requestId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        reviewStatus,
      }
    );

    await connection.commit();
  });

  res.json({ message: `Join request ${reviewStatus.toLowerCase()}.` });
};

exports.addMember = async (req, res) => {
  const serverId = Number(req.params.serverId);
  const memberUserId = Number(req.body.userId);
  const nextRole = String(req.body.serverRole || "MEMBER").trim().toUpperCase();

  if (!serverId || !memberUserId || !["ADMIN", "MEMBER"].includes(nextRole)) {
    throw httpError(400, "A valid server id, user id, and role are required.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.ADD_MEMBER(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_MEMBER_USER_ID => :memberUserId,
           P_SERVER_ROLE => :nextRole
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        memberUserId,
        nextRole,
      }
    );

    await connection.commit();
  });

  res.status(201).json({ message: "User added to the server." });
};

exports.removeMember = async (req, res) => {
  const serverId = Number(req.params.serverId);
  const memberUserId = Number(req.params.userId);

  if (!serverId || !memberUserId) {
    throw httpError(400, "A valid server id and user id are required.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.REMOVE_MEMBER(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_MEMBER_USER_ID => :memberUserId
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        memberUserId,
      }
    );

    await connection.commit();
  });

  res.json({ message: "Member removed from the server." });
};

exports.updateMemberRole = async (req, res) => {
  const serverId = Number(req.params.serverId);
  const memberUserId = Number(req.params.userId);
  const nextRole = String(req.body.serverRole || "").trim().toUpperCase();

  if (!serverId || !memberUserId || !["ADMIN", "MEMBER"].includes(nextRole)) {
    throw httpError(400, "Role changes must target a valid user and use ADMIN or MEMBER.");
  }

  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_COMMUNITY_API.UPDATE_MEMBER_ROLE(
           P_SERVER_ID => :serverId,
           P_ACTOR_USER_ID => :actorUserId,
           P_ACTOR_APP_ROLE => :actorAppRole,
           P_MEMBER_USER_ID => :memberUserId,
           P_SERVER_ROLE => :nextRole
         );
       END;`,
      {
        serverId,
        actorUserId: req.user.userId,
        actorAppRole: req.user.appRole,
        memberUserId,
        nextRole,
      }
    );

    await connection.commit();
  });

  res.json({ message: `Member role updated to ${nextRole}.` });
};
