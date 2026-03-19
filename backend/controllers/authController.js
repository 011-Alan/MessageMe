const oracledb = require("oracledb");

const { withConnection } = require("../config/db");
const { httpError } = require("../utils/http");
const { executePlsql } = require("../utils/oracle");
const {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionExpiryDate,
  createSessionToken,
  hashPassword,
  pickAvatarColor,
  verifyPassword,
} = require("../utils/security");

const STRONG_PASSWORD = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
let usersColumnCache;

function serializeUser(user) {
  return {
    userId: Number(user.userId),
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    appRole: user.appRole,
    avatarColor: user.avatarColor,
  };
}

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

exports.register = async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const displayName = String(req.body.displayName || username).trim() || username;
  const password = String(req.body.password || "");

  if (!username || !email || !password) {
    throw httpError(400, "Username, email, and password are required.");
  }

  if (!STRONG_PASSWORD.test(password)) {
    throw httpError(
      400,
      "Password must include 8 characters, 1 uppercase letter, 1 number, and 1 special character."
    );
  }

  const createdUser = await withConnection(async (connection) => {
    const usersColumns = await getUsersColumns(connection);
    const avatarColor = pickAvatarColor(username);
    const passwordHash = await hashPassword(password);
    const registerResult = await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_AUTH_API.REGISTER_USER(
           P_USERNAME => :username,
           P_EMAIL => :email,
           P_PASSWORD_HASH => :passwordHash,
           P_DISPLAY_NAME => :displayName,
           P_AVATAR_COLOR => :avatarColor,
           P_LEGACY_PASSWORD => :legacyPassword,
           P_USER_ID => :userId,
           P_APP_ROLE => :appRole
         );
       END;`,
      {
        username,
        email,
        passwordHash,
        displayName,
        avatarColor,
        legacyPassword: usersColumns.has("PASSWORD") ? passwordHash : null,
        userId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        appRole: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
      }
    );

    const userId = registerResult.outBinds.userId;
    const appRole = registerResult.outBinds.appRole;

    await connection.commit();

    return {
      userId,
      username,
      email,
      displayName,
      appRole,
      avatarColor,
    };
  });

  res.status(201).json({
    message: "Account created successfully. Please log in.",
    user: serializeUser(createdUser),
  });
};

exports.login = async (req, res) => {
  const identifier = String(req.body.username || req.body.identifier || "").trim();
  const password = String(req.body.password || "");

  if (!identifier || !password) {
    throw httpError(400, "Username or email and password are required.");
  }

  const loginResult = await withConnection(async (connection) => {
    const usersColumns = await getUsersColumns(connection);
    const hasLegacyPasswordColumn = usersColumns.has("PASSWORD");
    const result = await connection.execute(
      `SELECT user_id,
              username,
              email,
              ${
                hasLegacyPasswordColumn
                  ? "NVL(password_hash, password)"
                  : "password_hash"
              } AS password_hash,
              NVL(display_name, username) AS display_name,
              NVL(app_role, 'USER') AS app_role,
              NVL(avatar_color, '#7C5CFF') AS avatar_color
         FROM USERS
        WHERE LOWER(username) = LOWER(:identifier)
           OR LOWER(email) = LOWER(:identifier)`,
      { identifier }
    );

    const user = result.rows[0];

    if (!user) {
      throw httpError(404, "No user matches that username or email.");
    }

    const passwordMatches = await verifyPassword(password, user.PASSWORD_HASH);

    if (!passwordMatches) {
      throw httpError(401, "Incorrect password.");
    }

    const sessionToken = createSessionToken();
    const sessionExpiry = createSessionExpiryDate();

    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_AUTH_API.CREATE_SESSION(
           P_USER_ID => :userId,
           P_SESSION_TOKEN => :sessionToken,
           P_EXPIRES_AT => :sessionExpiry,
           P_USER_AGENT => :userAgent
         );
       END;`,
      {
        userId: user.USER_ID,
        sessionToken,
        sessionExpiry,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 255),
      }
    );

    await connection.commit();

    return {
      userId: Number(user.USER_ID),
      username: user.USERNAME,
      email: user.EMAIL,
      displayName: user.DISPLAY_NAME,
      appRole: user.APP_ROLE,
      avatarColor: user.AVATAR_COLOR,
      sessionToken,
    };
  });

  res.setHeader("Set-Cookie", buildSessionCookie(loginResult.sessionToken));
  res.json({
    message: "Welcome back.",
    user: serializeUser(loginResult),
  });
};

exports.getSession = async (req, res) => {
  res.json({
    user: serializeUser(req.user),
  });
};

exports.logout = async (req, res) => {
  await withConnection(async (connection) => {
    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_AUTH_API.LOGOUT_SESSION(
           P_SESSION_TOKEN => :sessionToken
         );
       END;`,
      { sessionToken: req.authToken }
    );

    await connection.commit();
  });

  res.setHeader("Set-Cookie", buildClearedSessionCookie());
  res.json({ message: "You have been logged out." });
};
