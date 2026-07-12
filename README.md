# MessageMe

MessageMe is a full-stack community messaging web application. It works like a lightweight Discord or Slack style platform where users can create servers, organize conversations into channels, send direct messages, share files, manage members, and receive notifications.

The project uses a vanilla HTML/CSS/JavaScript frontend, a Node.js and Express backend, and Oracle Database with SQL and PL/SQL packages, triggers, views, constraints, and indexes. It is useful both as a real messaging prototype and as a DBMS-focused project because many user-facing features are backed by relational design and database-side business logic.

## 3-Line Project Summary

- MessageMe is a community chat application with servers, channels, direct messages, attachments, notifications, join requests, role-based moderation, blocking, muting, email verification, and password reset.
- The backend is built with Node.js, Express, OracleDB, and Nodemailer, while Oracle Database manages relational data, sessions, constraints, PL/SQL procedures, triggers, views, indexes, audit logging, and migrations.
- The app demonstrates end-to-end full-stack development plus strong DBMS concepts through practical workflows such as account security, server membership, message delivery, read state, notifications, and moderation.

## How It Helps

MessageMe helps users communicate in organized online communities. Instead of one long global chat, users can create topic-based servers and channels, invite or approve members, and use direct messages for private one-to-one conversations.

It is also useful as a learning or portfolio project because it demonstrates:

- real full-stack application structure
- practical authentication and session handling
- role-based access control
- relational schema design
- PL/SQL business logic
- database triggers and audit logging
- file attachment handling
- notification workflows
- frontend state management without a frontend framework

## Tech Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- Browser Notification API
- Fetch API

### Backend

- Node.js
- Express.js
- `oracledb`
- `nodemailer`
- `cors`
- Node `crypto`, `fs`, and `path` modules

### Database

- Oracle Database
- SQL
- PL/SQL
- Tables, constraints, indexes, views, triggers, packages, and identity columns

## Project Structure

```text
MessageMe/
|-- backend/
|   |-- config/
|   |   `-- db.js
|   |-- controllers/
|   |   |-- authController.js
|   |   |-- communityController.js
|   |   |-- messageController.js
|   |   `-- socialController.js
|   |-- middleware/
|   |   `-- auth.js
|   |-- routes/
|   |   |-- authRoutes.js
|   |   |-- communityRoutes.js
|   |   |-- messageRoutes.js
|   |   `-- socialRoutes.js
|   |-- utils/
|   |   |-- community.js
|   |   |-- http.js
|   |   |-- mailer.js
|   |   |-- oracle.js
|   |   `-- security.js
|   |-- package.json
|   `-- server.js
|-- database/
|   |-- schema.sql
|   |-- oracle-objects.sql
|   |-- migrate-legacy-schema.js
|   |-- install-oracle-objects.js
|   `-- oracle-security-template.sql
|-- frontend/
|   |-- css/
|   |   `-- style.css
|   |-- js/
|   |   `-- app.js
|   |-- dashboard.html
|   |-- index.html
|   |-- login.html
|   `-- register.html
|-- .env.example
|-- CODEBASE_GUIDE.md
`-- README.md
```

## Architecture

MessageMe follows a three-layer architecture.

### 1. Frontend

The frontend is a single-page web app served from `frontend/index.html`. The main logic lives in `frontend/js/app.js`.

It handles:

- login and registration screens
- dashboard rendering
- server, channel, member, notification, and DM lists
- modals for actions such as creating servers, joining by invite, editing messages, and password reset
- local client state
- attachment preparation using base64 data URLs
- browser notifications
- polling every 5 seconds for notifications and active conversation updates

### 2. Backend

The backend is an Express server in `backend/server.js`. It serves the frontend, exposes REST-style API routes, validates requests, manages sessions, writes uploaded files to disk, and calls Oracle.

The backend is divided into:

- auth routes and controller
- community/server/channel routes and controller
- channel messaging routes and controller
- social/DM/notification routes and controller
- auth middleware
- Oracle, security, mailer, and community utilities

### 3. Oracle Database

Oracle stores the core data and performs many write-side business rules through PL/SQL.

The database layer includes:

- normalized relational tables
- primary keys, foreign keys, unique constraints, and check constraints
- PL/SQL packages for auth, account, community, message, social, and error handling
- triggers for defaults, notifications, read state, and audit logging
- views for server and channel lookup support
- indexes for faster membership, notification, message, typing, and search queries
- migration scripts for upgrading older schemas

## User Roles

### Application Admin

An application admin has `APP_ROLE = 'ADMIN'` in the `USERS` table.

They can:

- perform elevated moderation across servers
- manage/censor messages where backend and PL/SQL checks allow it
- act as a top-level privileged user in server-management checks

### Regular User

A regular user has `APP_ROLE = 'USER'`.

They can:

- register and verify email
- log in and manage their session
- create servers
- join servers
- send channel messages
- create direct messages
- upload attachments
- edit or delete their own messages
- block or mute other users
- receive notifications

### Server Owner

The server owner is the user stored in `SERVERS.OWNER_ID`.

They can:

- manage the server
- delete the server
- create, rename, and delete channels
- review join requests
- add or remove members
- promote or demote server members
- moderate messages and attachments

### Server Admin

A server admin has `SERVER_MEMBERS.SERVER_ROLE = 'ADMIN'`.

They can:

- manage server settings
- create, rename, and delete channels
- review join requests
- add or remove members
- promote or demote members
- moderate messages and attachments

### Server Member

A server member has `SERVER_MEMBERS.SERVER_ROLE = 'MEMBER'`.

They can:

- view channels in joined servers
- send and reply to messages
- upload attachments
- search messages
- leave the server
- participate in direct messages

## User Flow

### 1. Registration

1. The user enters username, display name, email, and password.
2. The user requests an email verification code.
3. The backend generates a 6-digit code and stores it for registration verification.
4. If SMTP is configured, Nodemailer sends the email. Otherwise, the app uses preview mode for local testing.
5. The user verifies the email.
6. The backend hashes the password using `scrypt`.
7. Oracle creates the user through `MESSAGEME_AUTH_API.REGISTER_USER`.
8. The user can now log in.

### 2. Login and Session

1. The user logs in with username/email and password.
2. The backend validates the password hash.
3. Oracle creates a row in `USER_SESSIONS`.
4. The backend sends an `HttpOnly` cookie named `messageme_session`.
5. Authenticated routes use `requireAuth` to load and validate the session.
6. Session activity is refreshed with `MESSAGEME_AUTH_API.TOUCH_SESSION`.

### 3. Dashboard Bootstrap

After login, the frontend calls:

```http
GET /api/bootstrap
```

The response includes:

- current user
- joined servers
- discoverable servers
- direct message threads
- notifications
- unread notification count
- blocked user IDs
- muted user IDs

The frontend then renders the sidebar, channel list, direct message list, notifications button, members panel, and active conversation.

### 4. Server and Channel Flow

1. A user creates a server.
2. Oracle inserts the server, owner membership, and default channel in one transaction.
3. Users can discover servers through search.
4. Private servers can use join requests.
5. Invite links can add users directly.
6. Owners/admins manage channels, members, and join requests.

### 5. Messaging Flow

1. A user opens a channel or direct thread.
2. The frontend fetches messages and typing status.
3. The user sends text, files, or both.
4. The backend validates content and file limits.
5. The backend stores files in `frontend/uploads`.
6. Oracle stores message and attachment metadata.
7. Notification triggers create notification rows for relevant users.
8. The sender read state is updated.
9. The frontend refreshes the active conversation.

### 6. Notification Flow

Notifications are stored in Oracle and returned through:

```http
GET /api/notifications
```

Notifications are created for:

- join requests
- join request approval or rejection
- users added to servers
- new channel messages
- new direct messages

The frontend also supports browser desktop notifications while the site is open and permission is granted.

### 7. Password Recovery Flow

1. The user opens forgot password.
2. Oracle creates a reset token through `MESSAGEME_ACCOUNT_API.ISSUE_EMAIL_TOKEN`.
3. The backend sends email if SMTP is configured.
4. The user enters email, token, and new password.
5. The backend hashes the new password.
6. Oracle verifies the token and updates the password with `MESSAGEME_ACCOUNT_API.RESET_PASSWORD`.

## Features

### Account Features

- Register with username, display name, email, and password
- Strong password validation
- Email verification
- Login with username or email
- Session restore
- Logout
- Forgot password
- Reset password
- SMTP delivery with local preview fallback

### Community Features

- Create servers
- Edit server name, description, and privacy
- Delete servers
- Leave servers
- Auto-transfer ownership or delete empty server when owner leaves
- Search servers
- Join by invite code
- Request access to private servers
- Review join requests

### Channel Features

- Create channels
- Rename channels
- Delete channels
- Channel topics
- Channel ordering by position and creation time

### Membership and Role Features

- Search users
- Add users to servers
- Remove members
- Promote members to server admin
- Demote admins to member
- Owner/admin/member permission checks
- Profile modal actions

### Messaging Features

- Channel messages
- Direct messages
- Message replies
- Message editing
- Message deletion
- Message search
- Read state and unread marker
- Typing indicators
- Censored messages
- Blocked-message hiding

### Attachment Features

- Multiple attachments per message
- Image, video, audio, and document classification by MIME type
- Attachment metadata in Oracle
- Attachment files on local disk
- Attachment censorship
- File cleanup when messages or attachments are deleted

### Social and Moderation Features

- Direct message threads
- User blocking
- User muting
- Censor channel messages
- Censor channel attachments
- Hide blocked users' messages
- Notifications for social and server events

## Message Types

MessageMe supports three message types in both channel messages and direct messages:

- `TEXT`: message has only text
- `FILE`: message has only attachments
- `MIXED`: message has text and attachments

Attachments are classified as:

- `IMAGE`
- `VIDEO`
- `AUDIO`
- `DOCUMENT`

Current attachment limits:

- maximum 5 attachments per message
- maximum 12 MB per file
- maximum 24 MB total per message

These limits are enforced in both frontend and backend code.

## API Routes

### Auth Routes

```http
POST /api/auth/register
POST /api/auth/register/verify-email/send
POST /api/auth/register/verify-email
POST /api/auth/login
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/verify-email
POST /api/auth/verify-email/send
GET  /api/auth/session
POST /api/auth/logout
```

### Community Routes

```http
GET    /api/bootstrap
GET    /api/users/search
GET    /api/servers/search
POST   /api/servers
GET    /api/servers/:id
PATCH  /api/servers/:id
DELETE /api/servers/:id
POST   /api/servers/:id/leave
POST   /api/servers/:id/channels
PATCH  /api/channels/:id
DELETE /api/channels/:id
POST   /api/servers/:id/join-requests
POST   /api/join-requests/:id/review
POST   /api/servers/:serverId/members
DELETE /api/servers/:serverId/members/:userId
POST   /api/servers/:serverId/members/:userId/role
```

### Message Routes

```http
GET    /api/channels/:id/messages
GET    /api/channels/:id/messages/search
POST   /api/channels/:id/messages
PATCH  /api/messages/:id
DELETE /api/messages/:id
POST   /api/messages/:id/censor
POST   /api/attachments/:id/censor
```

### Social, DM, and Notification Routes

```http
GET    /api/notifications
POST   /api/notifications/read-all
POST   /api/notifications/:id/read
POST   /api/direct-threads
GET    /api/direct-threads/:id/messages
POST   /api/direct-threads/:id/messages
PATCH  /api/direct-messages/:id
DELETE /api/direct-messages/:id
POST   /api/typing
POST   /api/users/:id/block
DELETE /api/users/:id/block
POST   /api/users/:id/mute
DELETE /api/users/:id/mute
POST   /api/invites/:inviteCode/join
```

## DBMS Management

### Database Connection

The backend uses `oracledb.createPool` in `backend/config/db.js`.

The connection pool uses environment variables:

```env
DB_USER=messageme
DB_PASSWORD=your_password_here
DB_CONNECT_STRING=localhost/XEPDB1
```

The pool settings are:

- `poolMin: 1`
- `poolMax: 10`
- `poolIncrement: 1`

Every database operation uses `withConnection`, which opens a pooled connection, runs the work, and closes the connection in a `finally` block.

### Schema Creation

The main schema is defined in:

```text
database/schema.sql
```

It creates the main tables, constraints, and indexes.

### Oracle Objects

Advanced Oracle logic is defined in:

```text
database/oracle-objects.sql
```

It installs:

- PL/SQL packages
- package bodies
- triggers
- views
- function-based indexes
- audit table

### Migration

The migration script is:

```text
database/migrate-legacy-schema.js
```

It upgrades older schemas by:

- checking existing tables and columns
- adding missing columns
- creating missing tables
- creating missing indexes
- backfilling default values
- preserving legacy password compatibility
- installing Oracle PL/SQL objects

The backend runs the migration automatically on startup through `upgradeLegacySchema()`.

### Transactions

Important flows call `connection.commit()` only after all steps succeed. On failure, message and attachment flows call `rollback()` and remove written files where needed.

Transactional examples:

- user registration
- session creation
- email verification
- password reset
- server creation
- channel creation
- join request review
- member role update
- channel message creation with attachments
- direct message creation with attachments
- read-state upsert

## Database Tables

### Core Tables

- `USERS`
- `USER_SESSIONS`
- `SERVERS`
- `SERVER_MEMBERS`
- `SERVER_JOIN_REQUESTS`
- `CHANNELS`
- `MESSAGES`
- `ATTACHMENTS`
- `CHANNEL_READ_STATE`

### Account and Email Tables

- `EMAIL_TOKENS`
- `EMAIL_OUTBOX`
- `REGISTRATION_EMAIL_VERIFICATIONS`

### Notification and Social Tables

- `NOTIFICATIONS`
- `DIRECT_THREADS`
- `DIRECT_THREAD_MEMBERS`
- `DIRECT_MESSAGES`
- `DIRECT_ATTACHMENTS`
- `TYPING_STATUS`
- `USER_BLOCKS`
- `USER_MUTES`

### Audit Table

- `MESSAGE_AUDIT_LOG`

## PL/SQL Packages

MessageMe uses these Oracle packages:

- `MESSAGEME_ERROR_API`: raises HTTP-like Oracle errors using `RAISE_APPLICATION_ERROR`
- `MESSAGEME_AUTH_API`: user registration, session creation, session touch, logout
- `MESSAGEME_ACCOUNT_API`: email verification tokens and password reset
- `MESSAGEME_COMMUNITY_API`: servers, channels, members, roles, join requests
- `MESSAGEME_MESSAGE_API`: channel messages, attachments, read state, moderation
- `MESSAGEME_SOCIAL_API`: notifications, direct messages, typing, blocks, mutes, invite joins

## Triggers

Important triggers include:

- `MESSAGEME_JOIN_REQUEST_NOTIFY_TRG`
- `MESSAGEME_JOIN_REQUEST_REVIEW_NOTIFY_TRG`
- `MESSAGEME_SERVER_MEMBER_NOTIFY_TRG`
- `MESSAGEME_CHANNEL_MESSAGE_NOTIFY_TRG`
- `MESSAGEME_DIRECT_MESSAGE_NOTIFY_TRG`
- `MESSAGEME_USERS_DEFAULTS_TRG`
- `MESSAGEME_SERVERS_DEFAULTS_TRG`
- `MESSAGEME_CHANNEL_READ_TOUCH_TRG`
- `MESSAGEME_MESSAGE_AUDIT_TRG`

These triggers handle notification creation, default values, read-state timestamp updates, and message audit logging.

## Views

The Oracle script includes read-side views:

- `MESSAGEME_SERVER_DIRECTORY_V`
- `MESSAGEME_SERVER_MEMBERSHIP_V`
- `MESSAGEME_CHANNEL_CONTEXT_V`
- `MESSAGEME_JOIN_REQUEST_DIRECTORY_V`

The installer can skip optional view creation if the Oracle user lacks privileges.

## Representative Database Queries

The project uses direct SQL for reads and PL/SQL package calls for many writes.

### Load Active Session

```sql
SELECT us.session_id,
       us.user_id,
       u.username,
       u.email,
       NVL(u.display_name, u.username) AS display_name,
       NVL(u.app_role, 'USER') AS app_role,
       NVL(u.avatar_color, '#7C5CFF') AS avatar_color,
       NVL(u.email_verified, 0) AS email_verified
  FROM USER_SESSIONS us
  JOIN USERS u
    ON u.user_id = us.user_id
 WHERE us.session_token = :token
   AND us.logout_time IS NULL
   AND us.expires_at > SYSTIMESTAMP;
```

### Load Joined Servers

```sql
SELECT s.SERVER_ID,
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
 ORDER BY s.CREATED_AT;
```

### Search Servers

```sql
SELECT s.SERVER_ID,
       s.SERVER_NAME,
       s.DESCRIPTION,
       s.OWNER_ID,
       s.IS_PRIVATE,
       s.INVITE_CODE,
       s.ACCENT_COLOR
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
 FETCH FIRST 25 ROWS ONLY;
```

### Load Channel Messages With Attachments and Replies

```sql
SELECT m.MESSAGE_ID,
       m.MESSAGE_TEXT,
       m.MESSAGE_TYPE,
       m.SENT_AT,
       m.IS_DELETED,
       m.IS_CENSORED,
       m.EDITED_AT,
       reply.MESSAGE_ID AS REPLY_MESSAGE_ID,
       reply.MESSAGE_TEXT AS REPLY_MESSAGE_TEXT,
       u.USER_ID AS AUTHOR_USER_ID,
       u.USERNAME AS AUTHOR_USERNAME,
       NVL(u.DISPLAY_NAME, u.USERNAME) AS AUTHOR_DISPLAY_NAME,
       a.ATTACHMENT_ID,
       a.FILE_NAME,
       a.FILE_URL,
       a.FILE_TYPE,
       a.MIME_TYPE,
       a.FILE_SIZE
  FROM MESSAGES m
  JOIN USERS u
    ON u.USER_ID = m.USER_ID
  LEFT JOIN MESSAGES reply
    ON reply.MESSAGE_ID = m.REPLY_TO_MESSAGE_ID
  LEFT JOIN ATTACHMENTS a
    ON a.MESSAGE_ID = m.MESSAGE_ID
 WHERE m.CHANNEL_ID = :channelId
 ORDER BY m.SENT_AT, a.ATTACHMENT_ID;
```

### Search Message Text

```sql
SELECT m.MESSAGE_ID,
       m.MESSAGE_TEXT,
       m.SENT_AT,
       u.USER_ID,
       u.USERNAME,
       NVL(u.DISPLAY_NAME, u.USERNAME) AS DISPLAY_NAME
  FROM MESSAGES m
  JOIN USERS u
    ON u.USER_ID = m.USER_ID
 WHERE m.CHANNEL_ID = :channelId
   AND NVL(m.IS_DELETED, 0) = 0
   AND NVL(m.IS_CENSORED, 0) = 0
   AND DBMS_LOB.INSTR(LOWER(m.MESSAGE_TEXT), :query) > 0
 ORDER BY m.SENT_AT DESC
 FETCH FIRST 25 ROWS ONLY;
```

### Upsert Typing Status With MERGE

```sql
MERGE INTO TYPING_STATUS target
USING (
  SELECT :scopeType AS scope_type,
         :targetId AS target_id,
         :userId AS user_id
    FROM dual
) source
ON (
  target.SCOPE_TYPE = source.scope_type
  AND target.TARGET_ID = source.target_id
  AND target.USER_ID = source.user_id
)
WHEN MATCHED THEN
  UPDATE SET target.EXPIRES_AT = SYSTIMESTAMP + NUMTODSINTERVAL(:ttlSeconds, 'SECOND'),
             target.UPDATED_AT = SYSTIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (SCOPE_TYPE, TARGET_ID, USER_ID, EXPIRES_AT)
  VALUES (source.scope_type, source.target_id, source.user_id,
          SYSTIMESTAMP + NUMTODSINTERVAL(:ttlSeconds, 'SECOND'));
```

### Create Channel Message Through PL/SQL

```sql
BEGIN
  MESSAGEME_MESSAGE_API.CREATE_MESSAGE(
    P_CHANNEL_ID => :channelId,
    P_ACTOR_USER_ID => :userId,
    P_MESSAGE_TEXT => :messageText,
    P_MESSAGE_TYPE => :messageType,
    P_REPLY_TO_MESSAGE_ID => :replyToMessageId,
    P_MESSAGE_ID => :messageId
  );
END;
```

### Add Direct Message Through PL/SQL

```sql
BEGIN
  MESSAGEME_SOCIAL_API.SEND_DIRECT_MESSAGE(
    P_THREAD_ID => :threadId,
    P_ACTOR_USER_ID => :userId,
    P_MESSAGE_TEXT => :messageText,
    P_MESSAGE_TYPE => :messageType,
    P_REPLY_TO_MESSAGE_ID => :replyToMessageId,
    P_MESSAGE_ID => :messageId
  );
END;
```

## Important DBMS Concepts Demonstrated

- Entity relationship modeling
- Primary keys and composite primary keys
- Foreign keys with cascade deletion
- Unique constraints
- Check constraints
- Identity columns
- Many-to-many relationships
- Join tables
- CLOB fields for message text
- Read-state tracking
- Case-insensitive search
- Function-based indexes
- Stored procedures and packages
- Triggers
- Views
- MERGE upsert
- Transactions and rollback
- Audit logging
- Schema migration
- Error mapping from Oracle errors to HTTP responses

## Security and Validation

- Passwords are hashed with Node `crypto.scrypt`
- Sessions use 48-byte random tokens
- Session cookie is `HttpOnly`
- Cookie uses `SameSite=Lax`
- Strong password rule requires 8 characters, 1 uppercase letter, 1 number, and 1 special character
- File names are sanitized before storage
- Attachment type is classified from MIME type
- Backend validates attachment size and count
- Oracle constraints enforce valid roles, statuses, flags, and message types
- PL/SQL packages enforce permissions for sensitive operations

## Setup

### Prerequisites

- Node.js
- Oracle Database or Oracle XE
- Oracle schema/user for MessageMe
- Git

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Create `.env` in the project root using `.env.example` as a template:

```env
DB_USER=messageme
DB_PASSWORD=your_password_here
DB_CONNECT_STRING=localhost/XEPDB1
PORT=3000

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=MessageMe <no-reply@example.com>
```

SMTP values are optional for local development. If SMTP is not configured, verification and reset flows use preview mode.

### 3. Create Database Schema

Run:

```text
database/schema.sql
```

in SQL Developer, SQLcl, SQL*Plus, or another Oracle SQL tool.

### 4. Install Oracle Objects

From `backend/`:

```bash
npm run install:oracle
```

### 5. Start the App

From `backend/`:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

On startup, the backend:

- loads environment variables
- connects to Oracle
- runs legacy migration checks
- installs Oracle objects when possible
- creates the uploads directory
- serves the frontend

## Useful Scripts

Run these from `backend/`:

```bash
npm start
npm run migrate:legacy
npm run install:oracle
```

## Current Limitations

- Uses polling every 5 seconds instead of WebSockets
- Browser notifications work only while the site/browser is open
- No service-worker push notifications yet
- Uploaded files are stored on local disk instead of cloud/object storage
- No automated test suite is included
- Message history is loaded as a full list rather than paginated
- No reactions, pinned messages, group DMs, voice calls, or video calls

## Future Enhancements

- WebSocket or Socket.IO real-time messaging
- Service worker push notifications
- Message pagination and infinite scroll
- Reactions and pinned messages
- Mentions and mention-specific notifications
- Profile image uploads
- Group direct messages
- Admin analytics dashboard
- Cloud storage for attachments
- Docker setup
- CI/CD pipeline
- Automated backend and frontend tests

## Is It Useful?

Yes. MessageMe is useful as a communication tool prototype and as a strong academic or resume project. It solves a practical problem, organized communication, while also demonstrating real engineering depth: authentication, database design, access control, PL/SQL packages, transactions, notifications, file handling, and moderation.

The strongest part of the project is that DBMS concepts are not isolated examples. They directly support visible features such as joining servers, sending messages, tracking unread messages, creating notifications, and enforcing permissions.

## Resume Points

- Built MessageMe, a full-stack community messaging platform with servers, channels, direct messages, file attachments, notifications, email verification, password reset, invite links, and role-based moderation.
- Designed and managed an Oracle Database schema using SQL, PL/SQL packages, triggers, views, constraints, indexes, transactions, audit logging, and migration scripts for real chat, membership, notification, and security workflows.
- Developed a Node.js/Express REST backend and vanilla JavaScript single-page frontend with session authentication, Oracle connection pooling, attachment validation/storage, browser notifications, polling-based updates, and modular controllers/routes.
