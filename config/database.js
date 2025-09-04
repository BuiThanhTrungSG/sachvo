require("dotenv").config();

const mysql = require("mysql2");

const connection = mysql.createPool({
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  host: process.env.DB_HOST,
  connectionLimit: process.env.DB_LIMIT,
  queueLimit: process.env.DB_QUE,
  waitForConnections: true,
});

module.exports = connection.promise();
