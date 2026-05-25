const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Hieu03032003",
  database: "thucphamkhoe",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool;
