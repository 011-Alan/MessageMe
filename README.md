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
