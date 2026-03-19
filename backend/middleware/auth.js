const { withConnection } = require("../config/db");
const { executePlsql } = require("../utils/oracle");
const {
  SESSION_COOKIE_NAME,
  buildClearedSessionCookie,
  parseCookies,
} = require("../utils/security");

function mapUser(row) {
  return {
    userId: Number(row.USER_ID),
    username: row.USERNAME,
    email: row.EMAIL,
    displayName: row.DISPLAY_NAME,
    appRole: row.APP_ROLE,
    avatarColor: row.AVATAR_COLOR,
  };
}

async function loadSession(token) {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT us.session_id,
              us.user_id,
              u.username,
              u.email,
              NVL(u.display_name, u.username) AS display_name,
              NVL(u.app_role, 'USER') AS app_role,
              NVL(u.avatar_color, '#7C5CFF') AS avatar_color
         FROM USER_SESSIONS us
         JOIN USERS u
           ON u.user_id = us.user_id
        WHERE us.session_token = :token
          AND us.logout_time IS NULL
          AND us.expires_at > SYSTIMESTAMP`,
      { token }
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    await executePlsql(
      connection,
      `BEGIN
         MESSAGEME_AUTH_API.TOUCH_SESSION(
           P_SESSION_ID => :sessionId
         );
       END;`,
      { sessionId: row.SESSION_ID }
    );

    await connection.commit();

    return row;
  });
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME] || req.headers["x-session-token"];

  if (!token) {
    res.status(401).json({ message: "Please log in to continue." });
    return;
  }

  try {
    const session = await loadSession(token);

    if (!session) {
      res.setHeader("Set-Cookie", buildClearedSessionCookie());
      res.status(401).json({ message: "Your session expired. Please sign in again." });
      return;
    }

    req.authToken = token;
    req.user = mapUser(session);
    req.session = {
      sessionId: Number(session.SESSION_ID),
      userId: Number(session.USER_ID),
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuth,
};
