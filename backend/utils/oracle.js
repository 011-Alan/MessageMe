const { httpError } = require("./http");

function getHttpStatusFromOracleError(error) {
  const errorNumber = Number(error?.errorNum || 0);

  if (errorNumber >= 20400 && errorNumber <= 20599) {
    return errorNumber - 20000;
  }

  return null;
}

function extractOracleMessage(error) {
  return String(error?.message || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^ORA-\d+:/i.test(line))
    || String(error?.message || "").replace(/^ORA-\d+:\s*/i, "").trim();
}

function normalizeOracleError(error) {
  const status = getHttpStatusFromOracleError(error);

  if (!status) {
    return error;
  }

  return httpError(status, extractOracleMessage(error) || "Database operation failed.");
}

async function executePlsql(connection, statement, binds = {}, options = {}) {
  try {
    return await connection.execute(statement, binds, options);
  } catch (error) {
    throw normalizeOracleError(error);
  }
}

module.exports = {
  executePlsql,
  normalizeOracleError,
};
