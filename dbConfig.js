require('dotenv').config();
const sql = require('mssql');

const dbConfig = process.env.DB_CONNECTION_STRING
const config = JSON.parse(dbConfig);
 
const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Conectado a SQL Server');
    return pool;
  })
  .catch(err => console.error('Error de conexión con la base de datos: ', err));
  
module.exports = {
  sql, poolPromise
};

