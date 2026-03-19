const oracledb = require("oracledb");

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let poolPromise;
 
function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} must be set before starting the backend.`);
  }

  return value;
}

async function initPool() {
  if (!poolPromise) {
    poolPromise = oracledb
      .createPool({
        user: getRequiredEnv("DB_USER"),
        password: getRequiredEnv("DB_PASSWORD"),
        connectString: getRequiredEnv("DB_CONNECT_STRING"),
        poolMin: 1,
        poolMax: 10,
        poolIncrement: 1,
      })
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

async function getConnection() {
  const pool = await initPool();
  return pool.getConnection();
}

async function withConnection(work) {
  const connection = await getConnection();

  try {
    return await work(connection);
  } finally {
    try {
      await connection.close();
    } catch (error) {
      console.error("Failed to close Oracle connection", error);
    }
  }
}

async function closePool() {
  if (!poolPromise) {
    return;
  }

  try {
    const pool = await poolPromise;
    await pool.close(0);
  } finally {
    poolPromise = null;
  }
}

module.exports = {
  initPool,
  getConnection,
  withConnection,
  closePool,
};
