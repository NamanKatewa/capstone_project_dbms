const fs = require('fs');
const { faker } = require('@faker-js/faker');
const path = require('path');
const OUTPUT_FILE = path.join(__dirname, 'db', 'init.sql');
if (!fs.existsSync(path.join(__dirname, 'db'))) {
    fs.mkdirSync(path.join(__dirname, 'db'));
}
let sql = `
CREATE DATABASE IF NOT EXISTS ecommerce_db;
USE ecommerce_db;
DROP TABLE IF EXISTS Audit_Logs;
DROP TABLE IF EXISTS Reviews;
DROP TABLE IF EXISTS Order_Items;
DROP TABLE IF EXISTS Orders;
DROP TABLE IF EXISTS Products;
DROP TABLE IF EXISTS Categories;
DROP TABLE IF EXISTS Users;
CREATE TABLE Users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    region VARCHAR(50)
);
CREATE TABLE Categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    parent_category_id INT DEFAULT NULL,
    FOREIGN KEY (parent_category_id) REFERENCES Categories(category_id) ON DELETE SET NULL
);
CREATE TABLE Products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category_id INT,
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    description TEXT,
    FOREIGN KEY (category_id) REFERENCES Categories(category_id) ON DELETE SET NULL
);
CREATE TABLE Orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'Pending',
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);
CREATE TABLE Order_Items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES Orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE RESTRICT
);
CREATE TABLE Reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    review_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);
CREATE TABLE Audit_Logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    table_affected VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    old_value TEXT,
    new_value TEXT
);
CREATE INDEX idx_products_category ON Products(category_id);
CREATE INDEX idx_orders_user ON Orders(user_id);
CREATE INDEX idx_orders_date ON Orders(order_date);
DROP VIEW IF EXISTS vw_monthly_sales;
CREATE VIEW vw_monthly_sales AS
SELECT 
    DATE_FORMAT(order_date, '%Y-%m') AS sale_month,
    SUM(total_amount) AS total_revenue,
    COUNT(order_id) AS total_orders
FROM Orders
WHERE status = 'Completed'
GROUP BY sale_month
ORDER BY sale_month DESC;
DROP TRIGGER IF EXISTS trg_product_audit;
DELIMITER 
CREATE TRIGGER trg_product_audit
AFTER UPDATE ON Products
FOR EACH ROW
BEGIN
    IF OLD.stock != NEW.stock OR OLD.price != NEW.price THEN
        INSERT INTO Audit_Logs (table_affected, action, old_value, new_value)
        VALUES (
            'Products', 
            'UPDATE', 
            CONCAT('Stock: ', OLD.stock, ', Price: ', OLD.price),
            CONCAT('Stock: ', NEW.stock, ', Price: ', NEW.price)
        );
    END IF;
END;
DELIMITER ;
DROP PROCEDURE IF EXISTS sp_process_checkout;
DELIMITER 
CREATE PROCEDURE sp_process_checkout(
    IN p_user_id INT,
    IN p_product_id INT,
    IN p_quantity INT,
    OUT p_status VARCHAR(50),
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_stock INT;
    DECLARE v_price DECIMAL(10,2);
    DECLARE v_order_id INT;
    START TRANSACTION;
    SELECT stock, price INTO v_stock, v_price 
    FROM Products 
    WHERE product_id = p_product_id 
    FOR UPDATE; 
    IF v_stock < p_quantity THEN
        ROLLBACK;
        SET p_status = 'Failed';
        SET p_message = 'Insufficient stock.';
    ELSE
        UPDATE Products SET stock = stock - p_quantity WHERE product_id = p_product_id;
        INSERT INTO Orders (user_id, total_amount, status) 
        VALUES (p_user_id, p_quantity * v_price, 'Completed');
        SET v_order_id = LAST_INSERT_ID();
        INSERT INTO Order_Items (order_id, product_id, quantity, unit_price)
        VALUES (v_order_id, p_product_id, p_quantity, v_price);
        COMMIT;
        SET p_status = 'Success';
        SET p_message = 'Order placed successfully.';
    END IF;
END;
DELIMITER ;
`;
function escapeSql(str) {
    if (!str) return '';
    return str.replace(/'/g, "''");
}
console.log('Generating seed data...');
const NUM_CATEGORIES = 20;
sql += '-- Seeding Categories\nINSERT INTO Categories (category_name, parent_category_id) VALUES\n';
const categories = [];
const parentCategories = ['Electronics', 'Clothing', 'Home & Garden', 'Books', 'Sports', 'Toys'];
for (let i = 0; i < parentCategories.length; i++) {
    categories.push(`('${escapeSql(parentCategories[i])}', NULL)`);
}
for (let i = parentCategories.length; i < NUM_CATEGORIES; i++) {
    const parentId = faker.number.int({ min: 1, max: parentCategories.length });
    const name = faker.commerce.department() + ' ' + faker.commerce.productAdjective();
    categories.push(`('${escapeSql(name)}', ${parentId})`);
}
sql += categories.join(',\n') + ';\n\n';
const NUM_PRODUCTS = 200;
sql += '-- Seeding Products\nINSERT INTO Products (name, category_id, price, stock, description) VALUES\n';
const products = [];
const productPrices = {};
for (let i = 1; i <= NUM_PRODUCTS; i++) {
    const name = faker.commerce.productName();
    const category_id = faker.number.int({ min: 1, max: NUM_CATEGORIES });
    const price = parseFloat(faker.commerce.price({ min: 5, max: 2000 })).toFixed(2);
    const stock = faker.number.int({ min: 0, max: 500 });
    const desc = escapeSql(faker.commerce.productDescription());
    productPrices[i] = parseFloat(price);
    products.push(`('${escapeSql(name)}', ${category_id}, ${price}, ${stock}, '${desc}')`);
}
sql += products.join(',\n') + ';\n\n';
const NUM_USERS = 100;
sql += '-- Seeding Users\nINSERT INTO Users (username, email, region, join_date) VALUES\n';
const users = [];
for (let i = 0; i < NUM_USERS; i++) {
    const username = faker.internet.username().substring(0, 50) + '_' + i;
    const email = faker.internet.email();
    const region = faker.location.state();
    const joinDate = faker.date.past({ years: 2 }).toISOString().slice(0, 19).replace('T', ' ');
    users.push(`('${escapeSql(username)}', '${escapeSql(email)}', '${escapeSql(region)}', '${joinDate}')`);
}
sql += users.join(',\n') + ';\n\n';
const NUM_ORDERS = 500;
const NUM_ORDER_ITEMS = 1200;
const orderTotals = {};
const orderItemsData = [];
for (let i = 1; i <= NUM_ORDER_ITEMS; i++) {
    const order_id = faker.number.int({ min: 1, max: NUM_ORDERS });
    const product_id = faker.number.int({ min: 1, max: NUM_PRODUCTS });
    const quantity = faker.number.int({ min: 1, max: 5 });
    const unit_price = productPrices[product_id];
    orderItemsData.push({ order_id, product_id, quantity, unit_price });
    if (!orderTotals[order_id]) orderTotals[order_id] = 0;
    orderTotals[order_id] += (quantity * unit_price);
}
sql += '-- Seeding Orders\nINSERT INTO Orders (user_id, order_date, total_amount, status) VALUES\n';
const orders = [];
for (let i = 1; i <= NUM_ORDERS; i++) {
    const user_id = faker.number.int({ min: 1, max: NUM_USERS });
    const orderDate = faker.date.recent({ days: 365 }).toISOString().slice(0, 19).replace('T', ' ');
    const status = faker.helpers.arrayElement(['Pending', 'Completed', 'Completed', 'Completed', 'Cancelled']);
    const total_amount = (orderTotals[i] || 0).toFixed(2);
    orders.push(`(${user_id}, '${orderDate}', ${total_amount}, '${status}')`);
}
sql += orders.join(',\n') + ';\n\n';
sql += '-- Seeding Order_Items\nINSERT INTO Order_Items (order_id, product_id, quantity, unit_price) VALUES\n';
const orderItemsSql = orderItemsData.map(item => 
    `(${item.order_id}, ${item.product_id}, ${item.quantity}, ${item.unit_price.toFixed(2)})`
);
sql += orderItemsSql.join(',\n') + ';\n\n';
const NUM_REVIEWS = 300;
sql += '-- Seeding Reviews\nINSERT INTO Reviews (product_id, user_id, rating, comment, review_date) VALUES\n';
const reviews = [];
for (let i = 0; i < NUM_REVIEWS; i++) {
    const product_id = faker.number.int({ min: 1, max: NUM_PRODUCTS });
    const user_id = faker.number.int({ min: 1, max: NUM_USERS });
    const rating = faker.number.int({ min: 1, max: 5 });
    const comment = escapeSql(faker.lorem.sentence());
    const reviewDate = faker.date.recent({ days: 180 }).toISOString().slice(0, 19).replace('T', ' ');
    reviews.push(`(${product_id}, ${user_id}, ${rating}, '${comment}', '${reviewDate}')`);
}
sql += reviews.join(',\n') + ';\n\n';
fs.writeFileSync(OUTPUT_FILE, sql);
console.log('Successfully generated db/init.sql');
