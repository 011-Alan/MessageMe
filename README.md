# MessageMe

MessageMe is a Discord-style community messaging platform built with a plain HTML/CSS/JavaScript frontend, an Express.js backend, and an Oracle Database backend. Users can register, create servers, manage channels and members, review join requests, and exchange rich messages with file attachments in a modern glass-style interface.

The project started as a community chat application and was later refactored to use Oracle more deeply through PL/SQL packages, triggers, indexes, and migration scripts.

## Project Overview

MessageMe is designed around the idea of community spaces called servers. Each server can contain channels, members, admins, join requests, and conversations. The system supports:

- User registration and login
- Persistent sessions with cookie-based auth
- Server creation and management
- Channel creation and management
- Join requests for private servers
- Member administration and role updates
- Rich messaging with attachments
- Profile views
- Search for users and servers
- Oracle-backed business logic for core write operations

The UI follows a Discord-inspired layout with:

- A user profile card
- A left sidebar for servers and channels
- A main chat area
- A members panel with join request actions
- Modals for server search, user search, profile view, editing, and confirmation flows

## Core Features

### Authentication

- Register with username, display name, email, and password
- Strong password validation
- Login using username or email
- Password hashing using `scrypt`
- Persistent session cookies
- Session restore on reload
- Logout support

### Server Management

- Create a server
- Configure description and privacy mode
- Auto-create the first `general` channel
- Rename and update server details
- Delete server if you are the owner
- Leave server
- Automatic ownership transfer when owner leaves and other members still exist

### Channel Management

- Create channels inside a server
- Rename channels
- Delete channels
- Ordered channel positions per server

### User and Member Management

- Search users by username and display name
- View public profile details from search and member lists
- Add users to a server if current user is owner or admin
- Remove users from a server
- Promote/demote between `ADMIN` and `MEMBER`
- View member list in a dropdown panel

### Private Access Control

- Private server support
- Join request creation
- Join request approval/rejection
- Restrict member additions based on ownership/admin rights

### Messaging

- Send text messages
- Send attachment-only messages
- Send mixed text + attachment messages
- Edit messages
- Delete messages with soft-delete behavior
- Read state tracking per channel
- First unread message handling

### File Attachments

- Image uploads
- Video uploads
- Audio uploads
- Document uploads
- Local file storage under `frontend/uploads`
- Attachment metadata stored in Oracle

Attachment limits:

- Maximum 5 files per message
- Maximum 12 MB per file
- Maximum 24 MB total per message

### Search and Discovery

- Search servers by server name
- Search users by username and display name
- Show joined servers separately
- Discover private/public servers
- Open joined servers directly from search results

### UI/UX Features

- Glass-style auth and app layout
- Modal-driven workflows
- Three-dot action menus
- Profile modal
- Members dropdown with moderation actions
- Toast notifications for feedback

## Technology Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript

### Backend

- Node.js
- Express.js
- CORS
- Oracle Node.js driver (`oracledb`)

### Database

- Oracle Database / Oracle XE style setup
- SQL DDL and DML
- PL/SQL packages and procedures
- Triggers
- Function-based indexes

## Project Structure

```text
MessageMe/
├─ backend/
│  ├─ config/
│  ├─ controllers/
│  ├─ middleware/
│  ├─ routes/
│  └─ utils/
├─ database/
│  ├─ schema.sql
│  ├─ oracle-objects.sql
│  ├─ migrate-legacy-schema.js
│  ├─ install-oracle-objects.js
│  └─ oracle-security-template.sql
├─ frontend/
│  ├─ css/
│  ├─ js/
│  ├─ uploads/
│  └─ index.html
├─ .env.example
└─ README.md
```

## High-Level Flow

### 1. Authentication Flow

1. User registers from the auth screen.
2. Backend validates the form.
3. Password is hashed with `scrypt`.
4. Oracle package `MESSAGEME_AUTH_API.REGISTER_USER` inserts the account.
5. On login, credentials are checked.
6. Oracle package creates the session row.
7. Session token is stored in an `HttpOnly` cookie.
8. On each authenticated request, middleware validates the session and updates activity time.

### 2. App Bootstrap Flow

1. Frontend loads after login.
2. `GET /api/bootstrap` returns:
   - current user
   - joined servers
   - discoverable servers
3. User selects a server.
4. `GET /api/servers/:id` loads:
   - server metadata
   - channels
   - members
   - pending join requests if user can manage them

### 3. Server and Channel Flow

1. User creates a server.
2. Oracle package inserts server, owner membership, and first channel in a single transaction.
3. Owner/admin can create additional channels.
4. Search, join request review, member role updates, and server updates are driven through API endpoints backed by Oracle procedures.

### 4. Messaging Flow

1. User selects a channel.
2. Backend fetches channel messages and attachment rows.
3. Read state is updated in Oracle.
4. On sending a message:
   - frontend validates attachments
   - backend writes message row through PL/SQL
   - files are stored on disk
   - attachment metadata is saved in Oracle
5. On edit/delete:
   - permissions are checked
   - Oracle package updates message state
   - audit trigger records message changes

## Backend Modules

### Auth Controller

Handles:

- registration
- login
- session fetch
- logout

Important ideas:

- password hashing and verification
- cookie-based session management
- Oracle package calls for user/session writes

### Community Controller

Handles:

- bootstrap data
- server search
- user search
- create/update/delete server
- leave server
- create/update/delete channel
- join request creation and review
- add/remove members
- role updates

### Message Controller

Handles:

- load channel messages
- send message
- edit message
- delete message
- attachment parsing and storage
- read-state logic

## Database Design

### Main Tables

- `USERS`
- `SERVERS`
- `USER_SESSIONS`
- `SERVER_MEMBERS`
- `SERVER_JOIN_REQUESTS`
- `CHANNELS`
- `MESSAGES`
- `ATTACHMENTS`
- `CHANNEL_READ_STATE`
- `MESSAGE_AUDIT_LOG`

### Relationship Summary

- One user can own many servers
- One server has many members
- One server has many channels
- One channel has many messages
- One message can have many attachments
- One user can have many sessions
- One server can have many join requests

## DBMS Concepts Used

This project now demonstrates a strong set of DBMS and Oracle concepts.

### 1. Tables

The system uses normalized relational tables for users, servers, memberships, channels, messages, attachments, sessions, read-state, and audit logs.

### 2. Primary Keys

Each major entity uses a primary key, such as:

- `USER_ID`
- `SERVER_ID`
- `CHANNEL_ID`
- `MESSAGE_ID`
- `REQUEST_ID`

### 3. Foreign Keys

Referential integrity is enforced between related tables, for example:

- server owner -> user
- channel -> server
- message -> channel
- attachment -> message
- session -> user

### 4. Composite Primary Keys

Some associative tables use composite keys, such as:

- `SERVER_MEMBERS (SERVER_ID, USER_ID)`
- `CHANNEL_READ_STATE (CHANNEL_ID, USER_ID)`

### 5. Constraints

The project uses:

- `NOT NULL`
- `UNIQUE`
- `CHECK`
- `FOREIGN KEY`
- composite key constraints

Examples:

- role validation: `ADMIN`, `USER`, `MEMBER`
- status validation: `PENDING`, `APPROVED`, `REJECTED`
- message type validation: `TEXT`, `MIXED`, `FILE`

### 6. Identity Columns

Oracle identity columns are used for automatically generated IDs in several tables.

### 7. Transactions

Multi-step operations are executed transactionally so partial changes are avoided. Examples:

- register user
- create server + owner membership + first channel
- approve join request + add member
- create message + save attachment metadata + update read state

### 8. Stored Procedures and PL/SQL Packages

Oracle packages centralize write-side logic:

- `MESSAGEME_AUTH_API`
- `MESSAGEME_COMMUNITY_API`
- `MESSAGEME_MESSAGE_API`
- `MESSAGEME_ERROR_API`

This is a major Oracle-based improvement in the project.

### 9. Triggers

Triggers are used for:

- defaulting fields
- keeping `LAST_READ_AT` current
- auditing message edits/deletes

Examples:

- `MESSAGEME_USERS_DEFAULTS_TRG`
- `MESSAGEME_SERVERS_DEFAULTS_TRG`
- `MESSAGEME_CHANNEL_READ_TOUCH_TRG`
- `MESSAGEME_MESSAGE_AUDIT_TRG`

### 10. Indexes

The project uses both standard and function-based indexes.

Examples:

- search-related lower-case indexes
- server/channel lookup indexes
- attachment lookup index
- role/join ordering indexes

### 11. Function-Based Indexes

Case-insensitive uniqueness and search performance are improved using indexes such as:

- `LOWER(USERNAME)`
- `LOWER(EMAIL)`
- `LOWER(DISPLAY_NAME)`
- `LOWER(SERVER_NAME)`
- `(SERVER_ID, LOWER(CHANNEL_NAME))`

### 12. MERGE Statement

Oracle `MERGE` is used for upserting channel read-state efficiently.

### 13. Dynamic SQL

Dynamic SQL is used where legacy schema compatibility must be preserved, such as handling a legacy `PASSWORD` column during migration/registration flows.

### 14. Audit Table

`MESSAGE_AUDIT_LOG` records message edits and deletes through a trigger-based audit trail.

### 15. Migration / Schema Evolution

The project includes a migration script that upgrades older schemas safely:

- adds missing columns
- fills missing values
- preserves legacy compatibility
- installs Oracle objects automatically

### 16. Grant / Revoke Template

The project also includes an Oracle security template:

- `database/oracle-security-template.sql`

This documents how package-based access and role-based grants can be managed by a DBA.

## SQL and Oracle Flow

### Base Schema

`database/schema.sql` creates the base relational structure:

- users
- servers
- memberships
- join requests
- channels
- messages
- attachments
- read state

### Oracle Objects Layer

`database/oracle-objects.sql` defines the Oracle-heavy layer:

- PL/SQL packages
- triggers
- audit table
- optional views
- function-based indexes

### Legacy Upgrade Layer

`database/migrate-legacy-schema.js` upgrades older installations and then installs Oracle objects.

### Important Note About Views

View definitions are included in the project, but some Oracle users may not have `CREATE VIEW` privilege. The installer is written to skip those optional view definitions if the schema cannot create them, while still installing the packages, triggers, indexes, and audit table.

## Security and Validation

- Password hashing with `scrypt`
- `HttpOnly` session cookie
- Cookie/session expiration support
- Input validation for registration and messaging
- Attachment size/count limits
- Role-based access checks
- Owner/admin-only moderation actions
- Server membership checks before channel/message access

## Current Limitations

This project is feature-rich, but there are still some gaps that could be improved:

- no direct messaging between users
- no forgot-password flow
- no OTP/email verification flow
- no real-time push notifications
- no socket-based live message delivery
- limited deployment automation
- no automated test suite yet

## Possible Future Enhancements

These are strong next features for future development.

### User Experience

- Direct DMs between users
- Typing indicators
- Message reactions
- Threaded replies
- Pinned messages
- Better unread indicators
- Better mobile polish

### Notifications

- Real-time message notifications
- Browser notifications
- In-app unread badges
- Mention notifications
- Server invite notifications

### Authentication and Security

- Forgot password
- OTP by email
- Email verification
- Password reset tokens
- Profile image upload
- Device/session management UI

### Community Features

- Invite links with expiry
- Server icons and banners
- User blocking/muting
- Moderation logs UI
- Better role hierarchy
- Multiple role support

### Messaging

- Real-time delivery with WebSockets / Socket.IO
- Message pagination
- Search within messages
- Drag-and-drop uploads
- Voice/video call integration

### Database and Backend

- More read-side logic shifted into Oracle views/packages
- Full role-based runtime DB hardening
- Stored functions for analytics/reporting
- Better reporting queries
- Backup/restore utilities
- Seed/demo data generator

### DevOps and Quality

- Docker setup
- CI pipeline
- Automated tests
- Linting and formatting rules
- Production deployment guide

## Setup Guide

### Prerequisites

- Node.js
- Oracle Database / Oracle XE
- Git

### Environment

Create a local `.env` file at project root:

```env
DB_USER=messageme
DB_PASSWORD=your_password_here
DB_CONNECT_STRING=localhost/XEPDB1
```

An example file is already included:

- `.env.example`

The backend reads this root `.env` file automatically when it starts.

### Install and Run

1. Create your Oracle schema/user.
2. Run `database/schema.sql` to create the base tables.
3. Install backend dependencies:

```bash
cd backend
npm install
```

4. Start the backend:

```bash
npm start
```

When the backend starts, it will:

- run legacy upgrade logic if needed
- install Oracle packages, triggers, and indexes
- ensure upload storage exists

5. Open the app in the browser:

```text
http://localhost:3000
```

## Important Files

- `frontend/index.html` - main UI shell
- `frontend/js/app.js` - full client logic
- `frontend/css/style.css` - styling
- `backend/server.js` - app entry point
- `backend/controllers/authController.js` - auth logic
- `backend/controllers/communityController.js` - server/channel/member logic
- `backend/controllers/messageController.js` - message and attachment logic
- `backend/middleware/auth.js` - session auth middleware
- `backend/utils/security.js` - password/session/upload helpers
- `database/schema.sql` - base schema
- `database/oracle-objects.sql` - Oracle packages/triggers/indexes
- `database/migrate-legacy-schema.js` - migration/bootstrap logic

## Summary

MessageMe is not just a chat UI. It is a full Oracle-backed community messaging system that combines:

- frontend interaction
- backend API routing
- relational data modeling
- PL/SQL package-based business logic
- transactional workflows
- moderation and membership control
- attachment management

It is a strong academic and practical project because it demonstrates both application development and DBMS concepts in a meaningful, working product.
