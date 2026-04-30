require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ecommerce_db",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
});
const respondWithSql = (res, sql, params, result) => {
  res.json({
    sql: mysql.format(sql, params),
    data: result,
  });
};
app.get("/api/products", async (req, res) => {
  try {
    const { search, category_id, sort, page = 1, limit = 12 } = req.query;
    let sql = `
            SELECT p.product_id, p.name, p.price, p.stock, c.category_name 
            FROM Products p
            LEFT JOIN Categories c ON p.category_id = c.category_id
            WHERE p.stock > 0
        `;
    const params = [];
    if (search) {
      sql += ` AND p.name LIKE ?`;
      params.push(`%${search}%`);
    }
    if (category_id) {
      sql += ` AND p.category_id = ?`;
      params.push(parseInt(category_id));
    }
    if (sort === "price_asc") sql += ` ORDER BY p.price ASC`;
    else if (sort === "price_desc") sql += ` ORDER BY p.price DESC`;
    else sql += ` ORDER BY p.product_id ASC`;
    const [rows] = await pool.query(sql, params);
    res.json({
      sql: mysql.format(sql, params),
      data: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/categories", async (req, res) => {
  try {
    const sql = `SELECT * FROM Categories ORDER BY category_name`;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/users/:id/history", async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const sql = `
            SELECT 
                o.order_id, o.order_date, o.total_amount, o.status,
                oi.quantity, oi.unit_price,
                p.name AS product_name,
                c.category_name
            FROM Orders o
            JOIN Order_Items oi ON o.order_id = oi.order_id
            JOIN Products p ON oi.product_id = p.product_id
            LEFT JOIN Categories c ON p.category_id = c.category_id
            WHERE o.user_id = ?
            ORDER BY o.order_date DESC
        `;
    const [rows] = await pool.query(sql, [userId]);
    respondWithSql(res, sql, [userId], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT user_id, username FROM Users LIMIT 50`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/checkout", async (req, res) => {
  const { user_id, items } = req.body;
  const results = [];
  const sqlCalls = [];
  let hasError = false;
  try {
    for (const item of items) {
      const sql = `CALL sp_process_checkout(?, ?, ?, @status, @message); SELECT @status AS status, @message AS message;`;
      const params = [user_id, item.product_id, item.quantity];
      const [rows] = await pool.query(sql, params);
      const statusRow = rows[1][0];
      sqlCalls.push(mysql.format(sql, params));
      results.push({ product_id: item.product_id, ...statusRow });
      if (statusRow.status === "Failed") {
        hasError = true;
      }
    }
    res.json({
      sql: sqlCalls.join("\n"),
      data: results,
      success: !hasError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/inventory", async (req, res) => {
  try {
    const sql = `SELECT product_id, name, price, stock FROM Products ORDER BY stock ASC LIMIT 20`;
    const [rows] = await pool.query(sql);
    respondWithSql(res, sql, [], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/inventory/:id", async (req, res) => {
  try {
    const { stock, price } = req.body;
    const productId = parseInt(req.params.id);
    const sql = `UPDATE Products SET stock = ?, price = ? WHERE product_id = ?`;
    const params = [stock, price, productId];
    await pool.query(sql, params);
    respondWithSql(res, sql, params, { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/audit-logs", async (req, res) => {
  try {
    const sql = `SELECT * FROM Audit_Logs ORDER BY timestamp DESC LIMIT 15`;
    const [rows] = await pool.query(sql);
    respondWithSql(res, sql, [], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/analytics/monthly-sales", async (req, res) => {
  try {
    const sql = `SELECT * FROM vw_monthly_sales`;
    const [rows] = await pool.query(sql);
    respondWithSql(res, sql, [], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/analytics/top-spenders", async (req, res) => {
  try {
    const sql = `
            SELECT 
                u.username, 
                COUNT(o.order_id) as total_orders, 
                SUM(o.total_amount) as lifetime_value
            FROM Users u
            JOIN Orders o ON u.user_id = o.user_id
            WHERE o.status = 'Completed'
            GROUP BY u.user_id
            HAVING lifetime_value > 1000
            ORDER BY lifetime_value DESC
            LIMIT 10
        `;
    const [rows] = await pool.query(sql);
    respondWithSql(res, sql, [], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/analytics/category-ranks", async (req, res) => {
  try {
    const sql = `
            WITH CategorySales AS (
                SELECT 
                    c.category_name, 
                    p.name AS product_name, 
                    SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM Categories c
                JOIN Products p ON c.category_id = p.category_id
                JOIN Order_Items oi ON p.product_id = oi.product_id
                JOIN Orders o ON oi.order_id = o.order_id
                WHERE o.status = 'Completed'
                GROUP BY c.category_id, p.product_id
            )
            SELECT 
                category_name, 
                product_name, 
                total_revenue,
                RANK() OVER(PARTITION BY category_name ORDER BY total_revenue DESC) as rank_in_category
            FROM CategorySales
            ORDER BY category_name, rank_in_category
            LIMIT 30
        `;
    const [rows] = await pool.query(sql);
    respondWithSql(res, sql, [], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/recommendations/:id", async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const sql = `
            SELECT 
                p2.product_id, 
                p2.name, 
                COUNT(oi2.order_id) AS times_bought_together
            FROM Order_Items oi1
            JOIN Order_Items oi2 ON oi1.order_id = oi2.order_id 
                AND oi1.product_id != oi2.product_id
            JOIN Products p2 ON oi2.product_id = p2.product_id
            WHERE oi1.product_id = ?
            GROUP BY p2.product_id
            ORDER BY times_bought_together DESC
            LIMIT 5
        `;
    const [rows] = await pool.query(sql, [productId]);
    respondWithSql(res, sql, [productId], rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
