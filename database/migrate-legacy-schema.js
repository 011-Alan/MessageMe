const crypto = require("crypto");
const path = require("path");

const { getConnection, closePool } = require("../backend/config/db");
const { installOracleObjects } = require("./install-oracle-objects");
const {
  generateInviteCode,
  pickAvatarColor,
  sanitizeFileName,
} = require("../backend/utils/security");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function getColumnSet(connection, tableName) {
  const result = await connection.execute(
    `SELECT column_name
       FROM user_tab_columns
      WHERE table_name = :tableName`,
    { tableName: tableName.toUpperCase() }
  );

  return new Set(result.rows.map((row) => row.COLUMN_NAME));
}

async function tableExists(connection, tableName) {
  const result = await connection.execute(
    `SELECT COUNT(*) AS total
       FROM user_tables
      WHERE table_name = :tableName`,
    { tableName: tableName.toUpperCase() }
  );

  return Number(result.rows[0].TOTAL) > 0;
}

async function addColumnIfMissing(connection, tableName, columnName, definition) {
  const columns = await getColumnSet(connection, tableName);

  if (columns.has(columnName.toUpperCase())) {
    return false;
  }

  await connection.execute(`ALTER TABLE ${tableName} ADD (${definition})`);
  return true;
}

async function migrateUsers(connection) {
  await addColumnIfMissing(connection, "USERS", "DISPLAY_NAME", "DISPLAY_NAME VARCHAR2(80)");
  await addColumnIfMissing(connection, "USERS", "APP_ROLE", "APP_ROLE VARCHAR2(10)");
  await addColumnIfMissing(connection, "USERS", "AVATAR_COLOR", "AVATAR_COLOR VARCHAR2(20)");
  await addColumnIfMissing(connection, "USERS", "PASSWORD_HASH", "PASSWORD_HASH VARCHAR2(300)");

  const columns = await getColumnSet(connection, "USERS");
  const hasLegacyPassword = columns.has("PASSWORD");

  const selectFields = [
    "USER_ID",
    "USERNAME",
    "EMAIL",
    "DISPLAY_NAME",
    "APP_ROLE",
    "AVATAR_COLOR",
    "PASSWORD_HASH",
  ];

  if (hasLegacyPassword) {
    selectFields.push("PASSWORD");
  }

  const usersResult = await connection.execute(
    `SELECT ${selectFields.join(", ")}
       FROM USERS
      ORDER BY USER_ID`
  );

  const users = usersResult.rows;
  let hasAdmin = false;

  for (const user of users) {
    if (user.APP_ROLE === "ADMIN") {
      hasAdmin = true;
    }

    const nextDisplayName = user.DISPLAY_NAME || user.USERNAME;
    const nextRole = user.APP_ROLE || "USER";
    const nextAvatarColor = user.AVATAR_COLOR || pickAvatarColor(user.USERNAME);
    const nextPasswordHash =
      user.PASSWORD_HASH ||
      (hasLegacyPassword && user.PASSWORD ? hashPassword(user.PASSWORD) : null);

    await connection.execute(
      `UPDATE USERS
          SET DISPLAY_NAME = :displayName,
              APP_ROLE = :appRole,
              AVATAR_COLOR = :avatarColor,
              PASSWORD_HASH = :passwordHash
        WHERE USER_ID = :userId`,
      {
        displayName: nextDisplayName,
        appRole: nextRole,
        avatarColor: nextAvatarColor,
        passwordHash: nextPasswordHash,
        userId: user.USER_ID,
      }
    );
  }

  if (!hasAdmin && users.length > 0) {
    await connection.execute(
      `UPDATE USERS
          SET APP_ROLE = 'ADMIN'
        WHERE USER_ID = :userId`,
      { userId: users[0].USER_ID }
    );
  }
}

async function migrateServers(connection) {
  await addColumnIfMissing(connection, "SERVERS", "DESCRIPTION", "DESCRIPTION VARCHAR2(300)");
  await addColumnIfMissing(connection, "SERVERS", "IS_PRIVATE", "IS_PRIVATE NUMBER(1)");
  await addColumnIfMissing(connection, "SERVERS", "INVITE_CODE", "INVITE_CODE VARCHAR2(24)");
  await addColumnIfMissing(connection, "SERVERS", "ACCENT_COLOR", "ACCENT_COLOR VARCHAR2(20)");

  const serversResult = await connection.execute(
    `SELECT SERVER_ID,
            SERVER_NAME,
            DESCRIPTION,
            IS_PRIVATE,
            INVITE_CODE,
            ACCENT_COLOR
       FROM SERVERS
      ORDER BY SERVER_ID`
  );

  for (const server of serversResult.rows) {
    await connection.execute(
      `UPDATE SERVERS
          SET DESCRIPTION = :description,
              IS_PRIVATE = :isPrivate,
              INVITE_CODE = :inviteCode,
              ACCENT_COLOR = :accentColor
        WHERE SERVER_ID = :serverId`,
      {
        description:
          server.DESCRIPTION || `${server.SERVER_NAME} community and collaboration space.`,
        isPrivate: server.IS_PRIVATE == null ? 1 : server.IS_PRIVATE,
        inviteCode: server.INVITE_CODE || generateInviteCode(),
        accentColor: server.ACCENT_COLOR || pickAvatarColor(server.SERVER_NAME),
        serverId: server.SERVER_ID,
      }
    );
  }
}

async function migrateChannels(connection) {
  await addColumnIfMissing(connection, "CHANNELS", "CHANNEL_TOPIC", "CHANNEL_TOPIC VARCHAR2(250)");
  await addColumnIfMissing(connection, "CHANNELS", "CREATED_BY", "CREATED_BY NUMBER");
  await addColumnIfMissing(connection, "CHANNELS", "POSITION", "POSITION NUMBER");

  const channelsResult = await connection.execute(
    `SELECT c.CHANNEL_ID,
            c.SERVER_ID,
            c.CHANNEL_NAME,
            c.CHANNEL_TOPIC,
            c.CREATED_BY,
            c.POSITION,
            s.OWNER_ID
       FROM CHANNELS c
       JOIN SERVERS s
         ON s.SERVER_ID = c.SERVER_ID
      ORDER BY c.SERVER_ID, c.CREATED_AT, c.CHANNEL_ID`
  );

  const serverPositions = new Map();

  for (const channel of channelsResult.rows) {
    const nextPosition = serverPositions.get(channel.SERVER_ID) || 1;
    serverPositions.set(channel.SERVER_ID, nextPosition + 1);

    await connection.execute(
      `UPDATE CHANNELS
          SET CHANNEL_TOPIC = :channelTopic,
              CREATED_BY = :createdBy,
              POSITION = :position
        WHERE CHANNEL_ID = :channelId`,
      {
        channelTopic: channel.CHANNEL_TOPIC || `Discussion space for #${channel.CHANNEL_NAME}.`,
        createdBy: channel.CREATED_BY || channel.OWNER_ID,
        position: channel.POSITION || nextPosition,
        channelId: channel.CHANNEL_ID,
      }
    );
  }
}

async function migrateMessages(connection) {
  await addColumnIfMissing(connection, "MESSAGES", "MESSAGE_TYPE", "MESSAGE_TYPE VARCHAR2(10)");
  await addColumnIfMissing(connection, "MESSAGES", "IS_DELETED", "IS_DELETED NUMBER(1)");
  await addColumnIfMissing(connection, "MESSAGES", "EDITED_AT", "EDITED_AT TIMESTAMP");
  await addColumnIfMissing(connection, "MESSAGES", "DELETED_AT", "DELETED_AT TIMESTAMP");
  await addColumnIfMissing(connection, "MESSAGES", "DELETED_BY", "DELETED_BY NUMBER");

  await connection.execute(
    `UPDATE MESSAGES
        SET MESSAGE_TYPE = 'TEXT'
      WHERE MESSAGE_TYPE IS NULL`
  );

  await connection.execute(
    `UPDATE MESSAGES
        SET IS_DELETED = 0
      WHERE IS_DELETED IS NULL`
  );
}

async function migrateAttachments(connection) {
  await addColumnIfMissing(connection, "ATTACHMENTS", "FILE_NAME", "FILE_NAME VARCHAR2(255)");
  await addColumnIfMissing(connection, "ATTACHMENTS", "FILE_TYPE", "FILE_TYPE VARCHAR2(10)");
  await addColumnIfMissing(connection, "ATTACHMENTS", "MIME_TYPE", "MIME_TYPE VARCHAR2(120)");
  await addColumnIfMissing(connection, "ATTACHMENTS", "FILE_SIZE", "FILE_SIZE NUMBER");

  const attachmentsResult = await connection.execute(
    `SELECT ATTACHMENT_ID,
            FILE_URL,
            FILE_NAME,
            FILE_TYPE,
            MIME_TYPE,
            FILE_SIZE
       FROM ATTACHMENTS
      ORDER BY ATTACHMENT_ID`
  );

  for (const attachment of attachmentsResult.rows) {
    const fileUrl = attachment.FILE_URL || "";
    const fileName = attachment.FILE_NAME || sanitizeFileName(path.basename(fileUrl || "file"));

    await connection.execute(
      `UPDATE ATTACHMENTS
          SET FILE_NAME = :fileName,
              FILE_TYPE = :fileType,
              MIME_TYPE = :mimeType,
              FILE_SIZE = :fileSize
        WHERE ATTACHMENT_ID = :attachmentId`,
      {
        fileName,
        fileType: attachment.FILE_TYPE || "DOCUMENT",
        mimeType: attachment.MIME_TYPE || "application/octet-stream",
        fileSize: attachment.FILE_SIZE == null ? 0 : attachment.FILE_SIZE,
        attachmentId: attachment.ATTACHMENT_ID,
      }
    );
  }
}

async function migrateChannelReadState(connection) {
  const exists = await tableExists(connection, "CHANNEL_READ_STATE");

  if (!exists) {
    await connection.execute(
      `CREATE TABLE CHANNEL_READ_STATE (
         CHANNEL_ID NUMBER NOT NULL,
         USER_ID NUMBER NOT NULL,
         LAST_READ_MESSAGE_ID NUMBER,
         LAST_READ_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
         CONSTRAINT PK_CHANNEL_READ_STATE PRIMARY KEY (CHANNEL_ID, USER_ID)
       )`
    );
  }
}

async function upgradeLegacySchema() {
  let connection;

  try {
    connection = await getConnection();

    await migrateUsers(connection);
    await migrateServers(connection);
    await migrateChannels(connection);
    await migrateMessages(connection);
    await migrateAttachments(connection);
    await migrateChannelReadState(connection);
    await installOracleObjects(connection);

    await connection.commit();
    console.log("Legacy schema upgraded successfully.");
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback failed", rollbackError);
      }
    }

    console.error(error);
    throw error;
  } finally {
    if (connection) {
      await connection.close();
    }

    await closePool();
  }
}

if (require.main === module) {
  upgradeLegacySchema().catch(() => {
    process.exit(1);
  });
}

module.exports = {
  upgradeLegacySchema,
};
