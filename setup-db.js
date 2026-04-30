require('dotenv').config();
const mysql = require('mysql2/promise');
const { faker } = require('@faker-js/faker');
async function setup() {
    let connection;
    try {
        console.log('Connecting to MySQL server...');
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            multipleStatements: true
        });
        console.log('Creating database...');
        await connection.query(`CREATE DATABASE IF NOT EXISTS ecommerce_db;`);
        await connection.query(`USE ecommerce_db;`);
        console.log('Dropping old tables/views/procedures...');
        await connection.query(`
            DROP VIEW IF EXISTS vw_monthly_sales;
            DROP TRIGGER IF EXISTS trg_product_audit;
            DROP PROCEDURE IF EXISTS sp_process_checkout;
            DROP TABLE IF EXISTS Audit_Logs;
            DROP TABLE IF EXISTS Reviews;
            DROP TABLE IF EXISTS Order_Items;
            DROP TABLE IF EXISTS Orders;
            DROP TABLE IF EXISTS Products;
            DROP TABLE IF EXISTS Categories;
            DROP TABLE IF EXISTS Users;
        `);
        console.log('Creating tables...');
        await connection.query(`
            CREATE TABLE Users (
                user_id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                email VARCHAR(255) NOT NULL UNIQUE,
                join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                region VARCHAR(50)
            );
        `);
        await connection.query(`
            CREATE TABLE Categories (
                category_id INT AUTO_INCREMENT PRIMARY KEY,
                category_name VARCHAR(100) NOT NULL,
                parent_category_id INT DEFAULT NULL,
                FOREIGN KEY (parent_category_id) REFERENCES Categories(category_id) ON DELETE SET NULL
            );
        `);
        await connection.query(`
            CREATE TABLE Products (
                product_id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category_id INT,
                price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
                stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
                description TEXT,
                FOREIGN KEY (category_id) REFERENCES Categories(category_id) ON DELETE SET NULL
            );
        `);
        await connection.query(`
            CREATE TABLE Orders (
                order_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                status VARCHAR(50) DEFAULT 'Pending',
                FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
            );
        `);
        await connection.query(`
            CREATE TABLE Order_Items (
                order_item_id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL CHECK (quantity > 0),
                unit_price DECIMAL(10, 2) NOT NULL,
                FOREIGN KEY (order_id) REFERENCES Orders(order_id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE RESTRICT
            );
        `);
        await connection.query(`
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
        `);
        await connection.query(`
            CREATE TABLE Audit_Logs (
                log_id INT AUTO_INCREMENT PRIMARY KEY,
                table_affected VARCHAR(50) NOT NULL,
                action VARCHAR(50) NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                old_value TEXT,
                new_value TEXT
            );
        `);
        console.log('Creating Indexes...');
        await connection.query(`CREATE INDEX idx_products_category ON Products(category_id);`);
        await connection.query(`CREATE INDEX idx_orders_user ON Orders(user_id);`);
        await connection.query(`CREATE INDEX idx_orders_date ON Orders(order_date);`);
        console.log('Creating Views...');
        await connection.query(`
            CREATE VIEW vw_monthly_sales AS
            SELECT 
                DATE_FORMAT(order_date, '%Y-%m') AS sale_month,
                SUM(total_amount) AS total_revenue,
                COUNT(order_id) AS total_orders
            FROM Orders
            WHERE status = 'Completed'
            GROUP BY sale_month
            ORDER BY sale_month DESC;
        `);
        console.log('Creating Triggers & Procedures...');
        await connection.query(`
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
        `);
        await connection.query(`
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
        `);
        console.log('Seeding Data (this may take a moment)...');
        const categories = [];
        const parentCategories = ['Electronics', 'Clothing', 'Home & Garden', 'Books', 'Sports', 'Toys'];
        for (let i = 0; i < parentCategories.length; i++) {
            categories.push([parentCategories[i], null]);
        }
        for (let i = parentCategories.length; i < 20; i++) {
            const parentId = faker.number.int({ min: 1, max: parentCategories.length });
            const name = faker.commerce.department() + ' ' + faker.commerce.productAdjective();
            categories.push([name, parentId]);
        }
        await connection.query(`INSERT INTO Categories (category_name, parent_category_id) VALUES ?`, [categories]);
        const products = [];
        const productPrices = {};
        for (let i = 1; i <= 200; i++) {
            const name = faker.commerce.productName();
            const category_id = faker.number.int({ min: 1, max: 20 });
            const price = parseFloat(faker.commerce.price({ min: 5, max: 2000 })).toFixed(2);
            const stock = faker.number.int({ min: 0, max: 500 });
            const desc = faker.commerce.productDescription();
            productPrices[i] = parseFloat(price);
            products.push([name, category_id, price, stock, desc]);
        }
        await connection.query(`INSERT INTO Products (name, category_id, price, stock, description) VALUES ?`, [products]);
        const users = [];
        for (let i = 0; i < 100; i++) {
            const username = faker.internet.username().substring(0, 50) + '_' + i;
            const email = faker.internet.email();
            const region = faker.location.state();
            const joinDate = faker.date.past({ years: 2 }).toISOString().slice(0, 19).replace('T', ' ');
            users.push([username, email, region, joinDate]);
        }
        await connection.query(`INSERT INTO Users (username, email, region, join_date) VALUES ?`, [users]);
        const orderTotals = {};
        const orderItemsData = [];
        for (let i = 1; i <= 1200; i++) {
            const order_id = faker.number.int({ min: 1, max: 500 });
            const product_id = faker.number.int({ min: 1, max: 200 });
            const quantity = faker.number.int({ min: 1, max: 5 });
            const unit_price = productPrices[product_id];
            orderItemsData.push([order_id, product_id, quantity, unit_price]);
            if (!orderTotals[order_id]) orderTotals[order_id] = 0;
            orderTotals[order_id] += (quantity * unit_price);
        }
        const orders = [];
        for (let i = 1; i <= 500; i++) {
            const user_id = faker.number.int({ min: 1, max: 100 });
            const orderDate = faker.date.recent({ days: 365 }).toISOString().slice(0, 19).replace('T', ' ');
            const status = faker.helpers.arrayElement(['Pending', 'Completed', 'Completed', 'Completed', 'Cancelled']);
            const total_amount = (orderTotals[i] || 0).toFixed(2);
            orders.push([i, user_id, orderDate, total_amount, status]); 
        }
        await connection.query(`INSERT INTO Orders (order_id, user_id, order_date, total_amount, status) VALUES ?`, [orders]);
        for (let i = 0; i < orderItemsData.length; i += 500) {
            const chunk = orderItemsData.slice(i, i + 500);
            await connection.query(`INSERT INTO Order_Items (order_id, product_id, quantity, unit_price) VALUES ?`, [chunk]);
        }
        const reviews = [];
        for (let i = 0; i < 300; i++) {
            const product_id = faker.number.int({ min: 1, max: 200 });
            const user_id = faker.number.int({ min: 1, max: 100 });
            const rating = faker.number.int({ min: 1, max: 5 });
            const comment = faker.lorem.sentence();
            const reviewDate = faker.date.recent({ days: 180 }).toISOString().slice(0, 19).replace('T', ' ');
            reviews.push([product_id, user_id, rating, comment, reviewDate]);
        }
        await connection.query(`INSERT INTO Reviews (product_id, user_id, rating, comment, review_date) VALUES ?`, [reviews]);
        console.log('Database Setup & Seeding Complete!');
    } catch (err) {
        console.error('Error during setup:', err);
    } finally {
        if (connection) await connection.end();
    }
}
setup();