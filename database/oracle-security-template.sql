-- Run this as a DBA or privileged Oracle user.
-- It is intentionally not executed by the app at startup.
-- The current MessageMe schema user can create packages/triggers/indexes,
-- but grant/revoke and runtime-user hardening should be handled separately.

BEGIN
  EXECUTE IMMEDIATE 'CREATE ROLE MESSAGEME_APP_ROLE';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1921 THEN
      RAISE;
    END IF;
END;
/

GRANT EXECUTE ON MESSAGEME_ERROR_API TO MESSAGEME_APP_ROLE;
GRANT EXECUTE ON MESSAGEME_AUTH_API TO MESSAGEME_APP_ROLE;
GRANT EXECUTE ON MESSAGEME_COMMUNITY_API TO MESSAGEME_APP_ROLE;
GRANT EXECUTE ON MESSAGEME_MESSAGE_API TO MESSAGEME_APP_ROLE;

-- Optional if the runtime user should be allowed to use the read views.
GRANT SELECT ON MESSAGEME_SERVER_DIRECTORY_V TO MESSAGEME_APP_ROLE;
GRANT SELECT ON MESSAGEME_SERVER_MEMBERSHIP_V TO MESSAGEME_APP_ROLE;
GRANT SELECT ON MESSAGEME_CHANNEL_CONTEXT_V TO MESSAGEME_APP_ROLE;
GRANT SELECT ON MESSAGEME_JOIN_REQUEST_DIRECTORY_V TO MESSAGEME_APP_ROLE;

-- Example:
-- CREATE USER MESSAGEME_RUNTIME IDENTIFIED BY "change-me";
-- GRANT CREATE SESSION TO MESSAGEME_RUNTIME;
-- GRANT MESSAGEME_APP_ROLE TO MESSAGEME_RUNTIME;

-- If you move the remaining read-only table queries fully behind packages/views,
-- you can then revoke broad direct table access from the runtime user here.
