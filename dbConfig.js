require('dotenv').config();
const sql = require('mysql2/promise');
const { Connector } = require("@google-cloud/cloud-sql-connector");
const dbConfig = JSON.parse(process.env.DB_CONFIG);
const connector = new Connector();

 
const poolPromise = (async () => {
  const clientOpts = await connector.getOptions({
    instanceConnectionName: dbConfig.INSTANCE_CONNECTION_NAME,
    ipType: "PUBLIC",
    authType: "IAM",
  });

  const pool = sql.createPool({
    ...clientOpts,

    user: dbConfig.IAM_DB_USER,
    database: dbConfig.DB_NAME,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
})();

poolPromise
  .then(async pool => {
    const connection = await pool.getConnection();
    console.log('Conectado a cloud SQL ');
    connection.release();
  })
  .catch(err => console.error('Error de conexión con la base de datos: ', err));
  
module.exports = {
  poolPromise
};

