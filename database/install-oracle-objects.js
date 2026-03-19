const fs = require("fs/promises");
const path = require("path");

const { getConnection, closePool } = require("../backend/config/db");

const oracleObjectsPath = path.join(__dirname, "oracle-objects.sql");

function splitOracleScript(script) {
  return script
    .split(/^\s*\/\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function normalizeOracleStatement(statement) {
  const trimmed = statement.trim();
  const isPlsql =
    /^(BEGIN|DECLARE|CREATE OR REPLACE PACKAGE|CREATE OR REPLACE TRIGGER)/i.test(trimmed);

  if (isPlsql) {
    return trimmed;
  }

  return trimmed.replace(/;\s*$/, "");
}

function isOptionalPrivilegeError(statement, error) {
  const normalized = statement.trim().toUpperCase();
  const errorNumber = Number(error?.errorNum);
  const isViewStatement = normalized.startsWith("CREATE OR REPLACE VIEW");
  const isTriggerStatement = normalized.startsWith("CREATE OR REPLACE TRIGGER");

  if (isViewStatement && (errorNumber === 1031 || errorNumber === 942)) {
    return true;
  }

  if (isTriggerStatement && errorNumber === 1031) {
    return true;
  }

  return false;
}

async function installOracleObjects(connection) {
  const script = await fs.readFile(oracleObjectsPath, "utf8");
  const statements = splitOracleScript(script);

  for (const statement of statements) {
    const normalized = normalizeOracleStatement(statement);

    try {
      await connection.execute(normalized);
    } catch (error) {
      if (isOptionalPrivilegeError(normalized, error)) {
        console.warn(`Skipping optional Oracle object: ${normalized.split(/\r?\n/, 1)[0]}`);
        continue;
      }

      throw error;
    }
  }
}

async function main() {
  let connection;

  try {
    connection = await getConnection();
    await installOracleObjects(connection);
    console.log("Oracle objects installed successfully.");
  } finally {
    if (connection) {
      await connection.close();
    }

    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  installOracleObjects,
};
