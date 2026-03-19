const fs = require("fs/promises");
const path = require("path");
const oracledb = require("oracledb");

const { withConnection } = require("../config/db");
const { httpError } = require("../utils/http");
const { executePlsql } = require("../utils/oracle");
const { requireChannelMembership } = require("../utils/community");
const {
  classifyMimeType,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  sanitizeFileName,
} = require("../utils/security");

const uploadsDirectory = path.join(__dirname, "../../frontend/uploads");

function canModerateMessage(user, context) {
  return (
    user.appRole === "ADMIN" ||
    Number(context.OWNER_ID) === Number(user.userId) ||
    context.SERVER_ROLE === "ADMIN"
  );
}

function groupMessages(rows, currentUser, channelContext) {
  const moderator = canModerateMessage(currentUser, channelContext);
  const messageMap = new Map();

  for (const row of rows) {
    if (!messageMap.has(row.MESSAGE_ID)) {
      const isDeleted = Number(row.IS_DELETED || 0) === 1;

      messageMap.set(row.MESSAGE_ID, {
        messageId: Number(row.MESSAGE_ID),
        messageText: isDeleted ? "This message was deleted." : row.MESSAGE_TEXT || "",
        messageType: row.MESSAGE_TYPE,
        sentAt: row.SENT_AT,
        editedAt: row.EDITED_AT,
        isEdited: Boolean(row.EDITED_AT),
        isDeleted,
        author: {
          userId: Number(row.AUTHOR_USER_ID),
          username: row.AUTHOR_USERNAME,
          displayName: row.AUTHOR_DISPLAY_NAME,
          avatarColor: row.AUTHOR_AVATAR_COLOR,
        },
        attachments: [],
        canEdit:
          !isDeleted &&
          (Number(row.AUTHOR_USER_ID) === Number(currentUser.userId) || moderator),
        canDelete:
          !isDeleted &&
          (Number(row.AUTHOR_USER_ID) === Number(currentUser.userId) || moderator),
      });
    }

    if (row.ATTACHMENT_ID && !messageMap.get(row.MESSAGE_ID).isDeleted) {
      messageMap.get(row.MESSAGE_ID).attachments.push({
        attachmentId: Number(row.ATTACHMENT_ID),
        fileName: row.FILE_NAME,
        fileUrl: row.FILE_URL,
        fileType: row.FILE_TYPE,
        mimeType: row.MIME_TYPE,
        fileSize: Number(row.FILE_SIZE || 0),
      });
    }
  }

  return Array.from(messageMap.values());
}

async function fetchMessagesForChannel(connection, channelId, currentUser, channelContext) {
  const result = await connection.execute(
    `SELECT m.MESSAGE_ID,
            m.MESSAGE_TEXT,
            m.MESSAGE_TYPE,
            m.SENT_AT,
            m.IS_DELETED,
            m.EDITED_AT,
            u.USER_ID AS AUTHOR_USER_ID,
            u.USERNAME AS AUTHOR_USERNAME,
            NVL(u.DISPLAY_NAME, u.USERNAME) AS AUTHOR_DISPLAY_NAME,
            NVL(u.AVATAR_COLOR, '#7C5CFF') AS AUTHOR_AVATAR_COLOR,
            a.ATTACHMENT_ID,
            a.FILE_NAME,
            a.FILE_URL,
            a.FILE_TYPE,
            a.MIME_TYPE,
            a.FILE_SIZE
       FROM MESSAGES m
       JOIN USERS u
         ON u.USER_ID = m.USER_ID
       LEFT JOIN ATTACHMENTS a
         ON a.MESSAGE_ID = m.MESSAGE_ID
      WHERE m.CHANNEL_ID = :channelId
      ORDER BY m.SENT_AT, a.ATTACHMENT_ID`,
    { channelId }
  );

  const messages = groupMessages(result.rows, currentUser, channelContext);

  return {
    messages,
    firstMessageId: messages[0]?.messageId || null,
    lastMessageId: messages[messages.length - 1]?.messageId || null,
  };
}

function parseAttachmentPayload(attachment, index) {
  const fileName = sanitizeFileName(attachment.name || `upload-${index + 1}`);
  const dataUrl = String(attachment.dataUrl || "");
  const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!dataUrlMatch) {
    throw httpError(400, `Attachment "${fileName}" is not encoded correctly.`);
  }

  const mimeType = String(attachment.mimeType || dataUrlMatch[1] || "").trim();
  const buffer = Buffer.from(dataUrlMatch[2], "base64");

  if (buffer.length === 0) {
    throw httpError(400, `Attachment "${fileName}" is empty.`);
  }

  if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    throw httpError(400, `Attachment "${fileName}" is larger than 12 MB.`);
  }

  return {
    fileName,
    mimeType,
    fileType: classifyMimeType(mimeType),
    fileSize: buffer.length,
    buffer,
  };
}

function resolveStoredUploadPath(fileUrl = "") {
  return path.join(uploadsDirectory, path.basename(String(fileUrl || "")));
}

async function deleteStoredFile(fileUrl) {
  if (!fileUrl) {
    return;
  }

  try {
    await fs.unlink(resolveStoredUploadPath(fileUrl));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to delete stored attachment", error);
    }
  }
}

async function getMessageAttachments(connection, messageId) {
  const result = await connection.execute(
    `SELECT ATTACHMENT_ID,
            FILE_URL,
            FILE_SIZE
       FROM ATTACHMENTS
      WHERE MESSAGE_ID = :messageId
      ORDER BY ATTACHMENT_ID`,
    { messageId }
  );

  return result.rows;
}

async function writeAttachments(connection, messageId, preparedAttachments) {
  const writtenFiles = [];

  if (preparedAttachments.length > 0) {
    await fs.mkdir(uploadsDirectory, { recursive: true });
  }

  for (let index = 0; index < preparedAttachments.length; index += 1) {
    const attachment = preparedAttachments[index];
    const storedFileName = `${messageId}_${Date.now()}_${index}_${attachment.fileName}`;
    const destination = path.join(uploadsDirectory, storedFileName);

    await fs.writeFile(destination, attachment.buffer);
    writtenFiles.push(destination);

    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_MESSAGE_API.ADD_ATTACHMENT(
           P_MESSAGE_ID => :messageId,
           P_FILE_NAME => :fileName,
           P_FILE_URL => :fileUrl,
           P_FILE_TYPE => :fileType,
           P_MIME_TYPE => :mimeType,
           P_FILE_SIZE => :fileSize
         );
       END;`,
      {
        messageId,
        fileName: attachment.fileName,
        fileUrl: `/uploads/${storedFileName}`,
        fileType: attachment.fileType,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
      }
    );
  }

  return writtenFiles;
}

async function readFirstUnreadMessageId(connection, channelId, userId, firstMessageId) {
  const stateResult = await connection.execute(
    `SELECT LAST_READ_MESSAGE_ID
       FROM CHANNEL_READ_STATE
      WHERE CHANNEL_ID = :channelId
        AND USER_ID = :userId`,
    {
      channelId,
      userId,
    }
  );

  const existingState = stateResult.rows[0];

  if (!existingState) {
    return firstMessageId;
  }

  const lastReadMessageId = existingState.LAST_READ_MESSAGE_ID;

  if (!lastReadMessageId) {
    return firstMessageId;
  }

  const unreadResult = await connection.execute(
    `SELECT MESSAGE_ID
       FROM MESSAGES
      WHERE CHANNEL_ID = :channelId
        AND MESSAGE_ID > :lastReadMessageId
      ORDER BY MESSAGE_ID
      FETCH FIRST 1 ROWS ONLY`,
    {
      channelId,
      lastReadMessageId,
    }
  );

  return unreadResult.rows[0]?.MESSAGE_ID || null;
}

async function markChannelRead(connection, channelId, userId, lastMessageId) {
  if (!lastMessageId) {
    return;
  }

  await executePlsql(
    connection,
    `BEGIN
       MESSAGEME_MESSAGE_API.UPSERT_READ_STATE(
         P_CHANNEL_ID => :channelId,
         P_USER_ID => :userId,
         P_LAST_READ_MESSAGE_ID => :lastMessageId
       );
     END;`,
    {
      channelId,
      userId,
      lastMessageId,
    }
  );
}

async function getMessageContext(connection, messageId, viewerUserId) {
  const result = await connection.execute(
    `SELECT m.MESSAGE_ID,
            m.CHANNEL_ID,
            m.USER_ID AS AUTHOR_USER_ID,
            m.IS_DELETED,
            (SELECT COUNT(*)
               FROM ATTACHMENTS a
              WHERE a.MESSAGE_ID = m.MESSAGE_ID) AS ATTACHMENT_COUNT,
            s.OWNER_ID,
            sm.SERVER_ROLE
       FROM MESSAGES m
       JOIN CHANNELS c
         ON c.CHANNEL_ID = m.CHANNEL_ID
       JOIN SERVERS s
         ON s.SERVER_ID = c.SERVER_ID
       JOIN SERVER_MEMBERS sm
         ON sm.SERVER_ID = s.SERVER_ID
      WHERE m.MESSAGE_ID = :messageId
        AND sm.USER_ID = :viewerUserId`,
    {
      messageId,
      viewerUserId,
    }
  );

  return result.rows[0] || null;
}

exports.getMessages = async (req, res) => {
  const channelId = Number(req.params.id);

  if (!channelId) {
    throw httpError(400, "A valid channel id is required.");
  }

  const payload = await withConnection(async (connection) => {
    const channel = await requireChannelMembership(connection, channelId, req.user.userId);
    const { messages, firstMessageId, lastMessageId } = await fetchMessagesForChannel(
      connection,
      channelId,
      req.user,
      channel
    );
    const firstUnreadMessageId = await readFirstUnreadMessageId(
      connection,
      channelId,
      req.user.userId,
      firstMessageId
    );

    await markChannelRead(connection, channelId, req.user.userId, lastMessageId);
    await connection.commit();

    return {
      channel: {
        channelId: Number(channel.CHANNEL_ID),
        name: channel.CHANNEL_NAME,
        topic: channel.CHANNEL_TOPIC || "",
        serverId: Number(channel.SERVER_ID),
        serverName: channel.SERVER_NAME,
        accentColor: channel.ACCENT_COLOR || "#7C5CFF",
      },
      messages,
      firstUnreadMessageId,
    };
  });

  res.json(payload);
};

exports.sendMessage = async (req, res) => {
  const channelId = Number(req.params.id);
  const messageText = String(req.body.messageText || "").trim();
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];

  if (!channelId) {
    throw httpError(400, "A valid channel id is required.");
  }

  if (!messageText && attachments.length === 0) {
    throw httpError(400, "Send a message or attach at least one file.");
  }

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw httpError(400, `You can upload up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
  }

  const preparedAttachments = attachments.map(parseAttachmentPayload);
  const totalAttachmentBytes = preparedAttachments.reduce(
    (total, attachment) => total + attachment.fileSize,
    0
  );

  if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw httpError(400, "The total upload size cannot exceed 24 MB.");
  }

  const payload = await withConnection(async (connection) => {
    const channel = await requireChannelMembership(connection, channelId, req.user.userId);
    const writtenFiles = [];

    try {
      const messageType =
        preparedAttachments.length === 0
          ? "TEXT"
          : messageText
            ? "MIXED"
            : "FILE";

      const insertResult = await executePlsql(
        connection,
        `BEGIN
           MESSAGEME_MESSAGE_API.CREATE_MESSAGE(
             P_CHANNEL_ID => :channelId,
             P_ACTOR_USER_ID => :userId,
             P_MESSAGE_TEXT => :messageText,
             P_MESSAGE_TYPE => :messageType,
             P_MESSAGE_ID => :messageId
           );
         END;`,
        {
          channelId,
          userId: req.user.userId,
          messageText,
          messageType,
          messageId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }
      );

      const messageId = Number(insertResult.outBinds.messageId);

      if (preparedAttachments.length > 0) {
        await fs.mkdir(uploadsDirectory, { recursive: true });
      }

      for (let index = 0; index < preparedAttachments.length; index += 1) {
        const attachment = preparedAttachments[index];
        const storedFileName = `${messageId}_${Date.now()}_${index}_${attachment.fileName}`;
        const destination = path.join(uploadsDirectory, storedFileName);

        await fs.writeFile(destination, attachment.buffer);
        writtenFiles.push(destination);

        await executePlsql(
          connection,
          `BEGIN
             MESSAGEME_MESSAGE_API.ADD_ATTACHMENT(
               P_MESSAGE_ID => :messageId,
               P_FILE_NAME => :fileName,
               P_FILE_URL => :fileUrl,
               P_FILE_TYPE => :fileType,
               P_MIME_TYPE => :mimeType,
               P_FILE_SIZE => :fileSize
             );
           END;`,
          {
            messageId,
            fileName: attachment.fileName,
            fileUrl: `/uploads/${storedFileName}`,
            fileType: attachment.fileType,
            mimeType: attachment.mimeType,
            fileSize: attachment.fileSize,
          }
        );
      }

      await markChannelRead(connection, channelId, req.user.userId, messageId);
      await connection.commit();

      const { messages } = await fetchMessagesForChannel(connection, channelId, req.user, channel);
      const createdMessage = messages.find((message) => message.messageId === messageId);

      return {
        channel: {
          channelId: Number(channel.CHANNEL_ID),
          name: channel.CHANNEL_NAME,
          topic: channel.CHANNEL_TOPIC || "",
          serverId: Number(channel.SERVER_ID),
          serverName: channel.SERVER_NAME,
        },
        message: createdMessage,
      };
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Failed to rollback message transaction", rollbackError);
      }

      for (const filePath of writtenFiles) {
        try {
          await fs.unlink(filePath);
        } catch (unlinkError) {
          console.error("Failed to clean up upload", unlinkError);
        }
      }

      throw error;
    }
  });

  res.status(201).json(payload);
};

exports.editMessage = async (req, res) => {
  const messageId = Number(req.params.id);
  const messageText = String(req.body.messageText || "").trim();
  const keepAttachmentIds = new Set(
    (Array.isArray(req.body.keepAttachmentIds) ? req.body.keepAttachmentIds : [])
      .map((value) => Number(value))
      .filter(Boolean)
  );
  const nextAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];

  if (!messageId) {
    throw httpError(400, "A valid message id is required.");
  }

  const payload = await withConnection(async (connection) => {
    const messageContext = await getMessageContext(connection, messageId, req.user.userId);

    if (!messageContext) {
      throw httpError(404, "Message not found or you do not have access to it.");
    }

    if (Number(messageContext.IS_DELETED || 0) === 1) {
      throw httpError(400, "Deleted messages cannot be edited.");
    }

    if (
      Number(messageContext.AUTHOR_USER_ID) !== Number(req.user.userId) &&
      !canModerateMessage(req.user, messageContext)
    ) {
      throw httpError(403, "Only the author or a server admin can edit this message.");
    }

    const existingAttachments = await getMessageAttachments(connection, messageId);
    const preparedAttachments = nextAttachments.map(parseAttachmentPayload);
    const attachmentsToKeep = existingAttachments.filter((attachment) =>
      keepAttachmentIds.has(Number(attachment.ATTACHMENT_ID))
    );
    const attachmentsToRemove = existingAttachments.filter(
      (attachment) => !keepAttachmentIds.has(Number(attachment.ATTACHMENT_ID))
    );
    const resultingAttachmentCount = attachmentsToKeep.length + preparedAttachments.length;
    const totalAttachmentBytes =
      attachmentsToKeep.reduce(
        (total, attachment) => total + Number(attachment.FILE_SIZE || 0),
        0
      ) +
      preparedAttachments.reduce((total, attachment) => total + attachment.fileSize, 0);
    const writtenFiles = [];

    if (resultingAttachmentCount > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw httpError(400, `You can upload up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
    }

    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw httpError(400, "The total upload size cannot exceed 24 MB.");
    }

    if (!messageText && resultingAttachmentCount === 0) {
      throw httpError(400, "A message cannot be empty after attachments are removed.");
    }

    const nextMessageType =
      resultingAttachmentCount > 0 ? (messageText ? "MIXED" : "FILE") : "TEXT";

    try {
      for (const attachment of attachmentsToRemove) {
        await executePlsql(
          connection,
          `BEGIN
             MESSAGEME_MESSAGE_API.DELETE_ATTACHMENT(
               P_ATTACHMENT_ID => :attachmentId,
               P_MESSAGE_ID => :messageId
             );
           END;`,
          {
            attachmentId: attachment.ATTACHMENT_ID,
            messageId,
          }
        );
      }

      if (preparedAttachments.length > 0) {
        writtenFiles.push(...(await writeAttachments(connection, messageId, preparedAttachments)));
      }

      await executePlsql(
        connection,
        `BEGIN
           MESSAGEME_MESSAGE_API.UPDATE_MESSAGE_BODY(
             P_MESSAGE_ID => :messageId,
             P_ACTOR_USER_ID => :actorUserId,
             P_ACTOR_APP_ROLE => :actorAppRole,
             P_MESSAGE_TEXT => :messageText,
             P_MESSAGE_TYPE => :messageType
           );
         END;`,
        {
          actorUserId: req.user.userId,
          actorAppRole: req.user.appRole,
          messageText,
          messageType: nextMessageType,
          messageId,
        }
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Failed to rollback message edit transaction", rollbackError);
      }

      for (const filePath of writtenFiles) {
        try {
          await fs.unlink(filePath);
        } catch (unlinkError) {
          console.error("Failed to clean up edited upload", unlinkError);
        }
      }

      throw error;
    }

    await Promise.all(
      attachmentsToRemove.map((attachment) => deleteStoredFile(attachment.FILE_URL))
    );

    const channel = await requireChannelMembership(
      connection,
      messageContext.CHANNEL_ID,
      req.user.userId
    );
    const { messages } = await fetchMessagesForChannel(
      connection,
      messageContext.CHANNEL_ID,
      req.user,
      channel
    );

    return {
      message: messages.find((message) => message.messageId === messageId),
    };
  });

  res.json(payload);
};

exports.deleteMessage = async (req, res) => {
  const messageId = Number(req.params.id);

  if (!messageId) {
    throw httpError(400, "A valid message id is required.");
  }

  const payload = await withConnection(async (connection) => {
    const messageContext = await getMessageContext(connection, messageId, req.user.userId);
    const existingAttachments = await getMessageAttachments(connection, messageId);

    if (!messageContext) {
      throw httpError(404, "Message not found or you do not have access to it.");
    }

    if (Number(messageContext.AUTHOR_USER_ID) !== Number(req.user.userId) &&
        !canModerateMessage(req.user, messageContext)) {
      throw httpError(403, "Only the author or a server admin can delete this message.");
    }

    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_MESSAGE_API.SOFT_DELETE_MESSAGE(
           P_MESSAGE_ID => :messageId,
           P_ACTOR_USER_ID => :deletedBy,
           P_ACTOR_APP_ROLE => :actorAppRole
         );
       END;`,
      {
        deletedBy: req.user.userId,
        actorAppRole: req.user.appRole,
        messageId,
      }
    );

    await connection.commit();

    await Promise.all(
      existingAttachments.map((attachment) => deleteStoredFile(attachment.FILE_URL))
    );

    const channel = await requireChannelMembership(
      connection,
      messageContext.CHANNEL_ID,
      req.user.userId
    );
    const { messages } = await fetchMessagesForChannel(
      connection,
      messageContext.CHANNEL_ID,
      req.user,
      channel
    );

    return {
      message: messages.find((message) => message.messageId === messageId),
    };
  });

  res.json(payload);
};
