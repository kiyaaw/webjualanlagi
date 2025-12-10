const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = "rahasia_toko_jualan_2024";
const HARGA_PER_PRODUK = 13000;

// Konfigurasi MySQL (XAMPP default)
const dbConfig = {
    host: "localhost",
    user: "root",
    password: "",
    database: "dimsum_keju_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

// ==================== INITIALIZE DATABASE ====================
async function initializeDatabase() {
    try {
        console.log("🔄 Initializing database...");
        
        // Step 1: Buat koneksi tanpa database
        const tempConnection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        // Step 2: Buat database jika belum ada
        await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
        console.log(`📁 Database ${dbConfig.database} created/checked`);
        
        await tempConnection.end();

        // Step 3: Buat connection pool
        pool = mysql.createPool({
            ...dbConfig,
            charset: 'utf8mb4',
            timezone: '+07:00'
        });

        // Step 4: Test koneksi
        const connection = await pool.getConnection();
        console.log("✅ Connected to MySQL database");
        connection.release();

        // Step 5: Buat tabel
        await createTables();
        
        // Step 6: Seed admin data saja (untuk login)
        await seedAdminData();
        
        console.log("🎉 Database initialization complete!");
        
    } catch (error) {
        console.error("❌ Database initialization error:", error.message);
        process.exit(1);
    }
}

// ==================== CREATE TABLES ====================
async function createTables() {
    try {
        const connection = await pool.getConnection();
        
        // Tabel penjual
        await connection.query(`
            CREATE TABLE IF NOT EXISTS penjual (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                nama_lengkap VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        `);
        console.log("✅ Penjual table ready");

        // Tabel buyer
        await connection.query(`
            CREATE TABLE IF NOT EXISTS buyer (
                buyer_id INT PRIMARY KEY AUTO_INCREMENT,
                nama VARCHAR(100) NOT NULL,
                alamat TEXT NOT NULL,
                no_hp VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        `);
        console.log("✅ Buyer table ready");

        // Tabel orders
        await connection.query(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id INT PRIMARY KEY AUTO_INCREMENT,
                buyer_id INT NOT NULL,
                orderdate DATE NOT NULL,
                subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                jumlah_produk INT NOT NULL DEFAULT 0,
                status ENUM('pending', 'on process', 'done') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (buyer_id) 
                    REFERENCES buyer(buyer_id) 
                    ON DELETE CASCADE 
                    ON UPDATE CASCADE
            ) ENGINE=InnoDB
        `);
        console.log("✅ Orders table ready (with jumlah_produk)");

        connection.release();
        
    } catch (error) {
        console.error("❌ Error creating tables:", error.message);
        throw error;
    }
}

// ==================== SEED ADMIN DATA SAJA ====================
async function seedAdminData() {
    try {
        const connection = await pool.getConnection();
        
        // Cek apakah admin sudah ada
        const [rows] = await connection.query("SELECT id FROM penjual WHERE username = 'admin'");
        
        if (rows.length === 0) {
            const hashedPassword = await bcrypt.hash("admin123", 10);
            
            await connection.query(
                "INSERT INTO penjual (username, password, nama_lengkap) VALUES (?, ?, ?)",
                ["admin", hashedPassword, "Administrator"]
            );
            console.log("✅ Default admin created (admin/admin123)");
        } else {
            console.log("✅ Admin already exists");
        }
        
        connection.release();
        
    } catch (error) {
        console.error("❌ Error seeding admin data:", error.message);
    }
}

// ==================== HELPER FUNCTIONS ====================
async function dbQuery(sql, params = []) {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(sql, params);
        return rows;
    } finally {
        connection.release();
    }
}

async function dbRun(sql, params = []) {
    const connection = await pool.getConnection();
    try {
        const [result] = await connection.query(sql, params);
        return {
            insertId: result.insertId,
            affectedRows: result.affectedRows
        };
    } finally {
        connection.release();
    }
}

async function dbGet(sql, params = []) {
    const rows = await dbQuery(sql, params);
    return rows[0] || null;
}

// ==================== MIDDLEWARE ====================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            message: "Silahkan login terlebih dahulu" 
        });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            message: "Sesi login telah berakhir" 
        });
    }
};

// =========================
//     AUTH - LOGIN
// =========================

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username dan password harus diisi"
        });
    }

    try {
        const users = await dbQuery("SELECT * FROM penjual WHERE username = ?", [username]);
        
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Username atau password salah"
            });
        }

        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Username atau password salah"
            });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username,
                nama: user.nama_lengkap 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            message: "Login berhasil",
            token: token,
            user: {
                id: user.id,
                username: user.username,
                nama: user.nama_lengkap
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({
            success: false,
            message: "Terjadi kesalahan server"
        });
    }
});

app.get("/check-auth", verifyToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// =========================
//     BUYER - CRUD
// =========================

// Get semua buyers
app.get("/buyers", verifyToken, async (req, res) => {
    try {
        const buyers = await dbQuery(`
            SELECT buyer_id, nama, alamat, no_hp, 
                    DATE_FORMAT(created_at, '%d-%m-%Y') as tanggal_daftar
            FROM buyer 
            ORDER BY nama
        `);
        res.json(buyers);
    } catch (error) {
        console.error("Error get buyers:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data buyer"
        });
    }
});

// Get buyer by ID
app.get("/buyer/:id", verifyToken, async (req, res) => {
    try {
        const buyer = await dbGet("SELECT * FROM buyer WHERE buyer_id = ?", [req.params.id]);
        
        if (!buyer) {
            return res.status(404).json({
                success: false,
                message: "Buyer tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            data: buyer
        });
    } catch (error) {
        console.error("Error get buyer:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data buyer"
        });
    }
});

// Tambah Buyer
app.post("/buyer", verifyToken, async (req, res) => {
    const { nama, alamat, no_hp } = req.body;

    if (!nama || !alamat || !no_hp) {
        return res.status(400).json({
            success: false,
            message: "Semua field harus diisi"
        });
    }

    try {
        const result = await dbRun(
            "INSERT INTO buyer (nama, alamat, no_hp) VALUES (?, ?, ?)",
            [nama, alamat, no_hp]
        );
        
        res.json({
            success: true,
            message: "Buyer berhasil disimpan",
            id: result.insertId
        });
    } catch (error) {
        console.error("Error add buyer:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal menyimpan buyer",
            error: error.message
        });
    }
});

// Edit Buyer
app.put("/buyer/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const { nama, alamat, no_hp } = req.body;

    if (!nama || !alamat || !no_hp) {
        return res.status(400).json({
            success: false,
            message: "Semua field harus diisi"
        });
    }

    try {
        const result = await dbRun(
            "UPDATE buyer SET nama = ?, alamat = ?, no_hp = ? WHERE buyer_id = ?",
            [nama, alamat, no_hp, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Buyer tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            message: "Buyer berhasil diperbarui"
        });
    } catch (error) {
        console.error("Error edit buyer:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal memperbarui buyer",
            error: error.message
        });
    }
});

// Hapus Buyer
app.delete("/buyer/:id", verifyToken, async (req, res) => {
    const id = req.params.id;

    try {
        // Cek apakah buyer memiliki order
        const orders = await dbQuery("SELECT COUNT(*) as count FROM orders WHERE buyer_id = ?", [id]);
        
        if (orders[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: "Buyer tidak dapat dihapus karena memiliki order"
            });
        }

        const result = await dbRun("DELETE FROM buyer WHERE buyer_id = ?", [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Buyer tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            message: "Buyer berhasil dihapus"
        });
    } catch (error) {
        console.error("Error delete buyer:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal menghapus buyer",
            error: error.message
        });
    }
});

// =========================
//     ORDER - CRUD
// =========================

// Get semua order
app.get("/order", verifyToken, async (req, res) => {
    try {
        const orders = await dbQuery(
            `SELECT 
                orders.order_id,
                orders.buyer_id,
                buyer.nama,
                buyer.no_hp,
                buyer.alamat,
                orders.orderdate,
                orders.subtotal,
                orders.jumlah_produk,
                FORMAT(orders.subtotal, 0) as subtotal_formatted,
                orders.status,
                DATE_FORMAT(orders.created_at, '%d-%m-%Y %H:%i') as dibuat_pada
            FROM orders
            JOIN buyer ON orders.buyer_id = buyer.buyer_id
            ORDER BY orders.orderdate DESC, orders.order_id DESC`
        );
        res.json(orders);
    } catch (error) {
        console.error("Error get orders:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data order"
        });
    }
});

// Get order by ID
app.get("/order/:id", verifyToken, async (req, res) => {
    try {
        const order = await dbGet(
            `SELECT orders.*, buyer.nama as buyer_nama, buyer.no_hp as buyer_hp
                FROM orders 
                JOIN buyer ON orders.buyer_id = buyer.buyer_id 
                WHERE order_id = ?`,
            [req.params.id]
        );
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        console.error("Error get order:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data order"
        });
    }
});

// Tambah Order
app.post("/order", verifyToken, async (req, res) => {
    const { buyer_id, orderdate, subtotal, status } = req.body;
    
    if (!buyer_id || !orderdate || !subtotal) {
        return res.status(400).json({
            success: false,
            message: "Buyer, tanggal, dan subtotal harus diisi"
        });
    }

    try {
        // Cek apakah buyer_id ada
        const buyerCheck = await dbQuery("SELECT buyer_id FROM buyer WHERE buyer_id = ?", [buyer_id]);
        
        if (buyerCheck.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Buyer tidak ditemukan"
            });
        }

        // Validasi subtotal harus kelipatan 13000
        const subtotalNum = parseFloat(subtotal);
        if (subtotalNum % HARGA_PER_PRODUK !== 0) {
            return res.status(400).json({
                success: false,
                message: `Subtotal harus kelipatan ${HARGA_PER_PRODUK.toLocaleString('id-ID')}`
            });
        }

        // Hitung jumlah produk
        const jumlah_produk = Math.round(subtotalNum / HARGA_PER_PRODUK);
        
        // Format tanggal (MySQL menerima format YYYY-MM-DD)
        const formattedDate = new Date(orderdate).toISOString().split('T')[0];
        
        const result = await dbRun(
            "INSERT INTO orders (buyer_id, orderdate, subtotal, jumlah_produk, status) VALUES (?, ?, ?, ?, ?)",
            [buyer_id, formattedDate, subtotalNum, jumlah_produk, status || 'pending']
        );
        
        res.json({
            success: true,
            message: "Order berhasil disimpan",
            order_id: result.insertId,
            jumlah_produk: jumlah_produk
        });
    } catch (error) {
        console.error("Error add order:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal menyimpan order",
            error: error.message
        });
    }
});

// Edit Order
app.put("/order/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const { buyer_id, orderdate, subtotal, status } = req.body;
    
    if (!buyer_id || !orderdate || !subtotal || !status) {
        return res.status(400).json({
            success: false,
            message: "Semua field harus diisi"
        });
    }

    try {
        // Cek apakah buyer_id ada
        const buyerCheck = await dbQuery("SELECT buyer_id FROM buyer WHERE buyer_id = ?", [buyer_id]);
        
        if (buyerCheck.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Buyer tidak ditemukan"
            });
        }

        // Validasi subtotal harus kelipatan 13000
        const subtotalNum = parseFloat(subtotal);
        if (subtotalNum % HARGA_PER_PRODUK !== 0) {
            return res.status(400).json({
                success: false,
                message: `Subtotal harus kelipatan ${HARGA_PER_PRODUK.toLocaleString('id-ID')}`
            });
        }

        // Hitung jumlah produk
        const jumlah_produk = Math.round(subtotalNum / HARGA_PER_PRODUK);
        
        // Format tanggal
        const formattedDate = new Date(orderdate).toISOString().split('T')[0];
        
        const result = await dbRun(
            "UPDATE orders SET buyer_id = ?, orderdate = ?, subtotal = ?, jumlah_produk = ?, status = ? WHERE order_id = ?",
            [buyer_id, formattedDate, subtotalNum, jumlah_produk, status, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Order tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            message: "Order berhasil diperbarui",
            jumlah_produk: jumlah_produk
        });
    } catch (error) {
        console.error("Error edit order:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal memperbarui order",
            error: error.message
        });
    }
});

// Hapus Order
app.delete("/order/:id", verifyToken, async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await dbRun("DELETE FROM orders WHERE order_id = ?", [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Order tidak ditemukan"
            });
        }
        
        res.json({
            success: true,
            message: "Order berhasil dihapus"
        });
    } catch (error) {
        console.error("Error delete order:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal menghapus order",
            error: error.message
        });
    }
});

// =========================
//     DASHBOARD - PERBAIKI DI SINI
// =========================

// GET DASHBOARD STATS - TANPA FILTER
app.get("/dashboard-stats", verifyToken, async (req, res) => {
    try {
        // Query untuk mendapatkan semua statistik tanpa filter
        const [totalBuyers] = await dbQuery("SELECT COUNT(*) as total_buyers FROM buyer");
        const [totalOrders] = await dbQuery("SELECT COUNT(*) as total_orders FROM orders");
        const [totalIncome] = await dbQuery("SELECT COALESCE(SUM(subtotal), 0) as total_income FROM orders WHERE status = 'done'");
        const [totalProducts] = await dbQuery("SELECT COALESCE(SUM(jumlah_produk), 0) as total_products FROM orders");
        const [pendingOrders] = await dbQuery("SELECT COUNT(*) as pending_orders FROM orders WHERE status = 'pending'");
        const [processOrders] = await dbQuery("SELECT COUNT(*) as process_orders FROM orders WHERE status = 'on process'");
        const [doneOrders] = await dbQuery("SELECT COUNT(*) as done_orders FROM orders WHERE status = 'done'");

        // Statistik untuk chart
        const orderStats = await dbQuery(`
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(subtotal), 0) as total_amount
            FROM orders 
            GROUP BY status
            ORDER BY FIELD(status, 'pending', 'on process', 'done')
        `);

        // Data harian untuk 30 hari terakhir
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const startDateStr = thirtyDaysAgo.toISOString().split('T')[0];
        const today = new Date().toISOString().split('T')[0];

        const dailyStats = await dbQuery(`
            SELECT 
                DATE(orderdate) as tanggal,
                COUNT(*) as jumlah_order,
                COALESCE(SUM(subtotal), 0) as total_pendapatan,
                COALESCE(SUM(jumlah_produk), 0) as total_produk
            FROM orders
            WHERE orderdate BETWEEN ? AND ?
            GROUP BY DATE(orderdate)
            ORDER BY tanggal`,
            [startDateStr, today]
        );

        res.json({
            success: true,
            stats: {
                total_buyers: parseInt(totalBuyers.total_buyers) || 0,
                total_orders: parseInt(totalOrders.total_orders) || 0,
                total_income: parseFloat(totalIncome.total_income) || 0,
                total_products: parseInt(totalProducts.total_products) || 0,
                pending_orders: parseInt(pendingOrders.pending_orders) || 0,
                process_orders: parseInt(processOrders.process_orders) || 0,
                done_orders: parseInt(doneOrders.done_orders) || 0,
                order_stats: orderStats,
                daily_stats: dailyStats
            }
        });
    } catch (error) {
        console.error("Dashboard error:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil statistik dashboard"
        });
    }
});

// GET DASHBOARD STATS DENGAN FILTER - PERBAIKI INI
app.get("/dashboard-filter", verifyToken, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        console.log("Filter params received:", { start_date, end_date });
        
        // Buat kondisi WHERE berdasarkan parameter
        let whereClause = "";
        const params = [];
        
        if (start_date && end_date) {
            whereClause = "WHERE orderdate BETWEEN ? AND ?";
            params.push(start_date, end_date);
        } else if (start_date) {
            whereClause = "WHERE orderdate >= ?";
            params.push(start_date);
        } else if (end_date) {
            whereClause = "WHERE orderdate <= ?";
            params.push(end_date);
        }
        
        console.log("WHERE clause:", whereClause);
        console.log("Params:", params);
        
        // Query untuk total pembeli (tidak terpengaruh filter tanggal)
        const [totalBuyers] = await dbQuery("SELECT COUNT(*) as total_buyers FROM buyer");
        
        // Query dengan filter untuk order-related stats
        let ordersQuery = `SELECT COUNT(*) as total_orders FROM orders`;
        let incomeQuery = `SELECT COALESCE(SUM(subtotal), 0) as total_income FROM orders WHERE status = 'done'`;
        let productsQuery = `SELECT COALESCE(SUM(jumlah_produk), 0) as total_products FROM orders`;
        let pendingQuery = `SELECT COUNT(*) as pending_orders FROM orders WHERE status = 'pending'`;
        let processQuery = `SELECT COUNT(*) as process_orders FROM orders WHERE status = 'on process'`;
        let doneQuery = `SELECT COUNT(*) as done_orders FROM orders WHERE status = 'done'`;
        
        if (whereClause) {
            ordersQuery += ` ${whereClause}`;
            incomeQuery += ` ${whereClause.replace('WHERE', 'AND')}`;
            productsQuery += ` ${whereClause}`;
            pendingQuery += ` ${whereClause.replace('WHERE', 'AND')}`;
            processQuery += ` ${whereClause.replace('WHERE', 'AND')}`;
            doneQuery += ` ${whereClause.replace('WHERE', 'AND')}`;
        }
        
        console.log("Queries:");
        console.log("Orders:", ordersQuery);
        console.log("Income:", incomeQuery);
        
        const [totalOrders] = await dbQuery(ordersQuery, params);
        const [totalIncome] = await dbQuery(incomeQuery, params);
        const [totalProducts] = await dbQuery(productsQuery, params);
        const [pendingOrders] = await dbQuery(pendingQuery, params);
        const [processOrders] = await dbQuery(processQuery, params);
        const [doneOrders] = await dbQuery(doneQuery, params);

        // Statistik untuk chart dengan filter yang sama
        let orderStatsQuery = `
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(subtotal), 0) as total_amount
            FROM orders 
            ${whereClause}
            GROUP BY status
            ORDER BY FIELD(status, 'pending', 'on process', 'done')
        `;
        
        // Data harian untuk chart dengan filter
        let dailyStatsQuery = `
            SELECT 
                DATE(orderdate) as tanggal,
                COUNT(*) as jumlah_order,
                COALESCE(SUM(subtotal), 0) as total_pendapatan,
                COALESCE(SUM(jumlah_produk), 0) as total_produk
            FROM orders
            ${whereClause}
            GROUP BY DATE(orderdate)
            ORDER BY tanggal
        `;

        const orderStats = await dbQuery(orderStatsQuery, params);
        const dailyStats = await dbQuery(dailyStatsQuery, params);

        const result = {
            success: true,
            stats: {
                total_buyers: parseInt(totalBuyers.total_buyers) || 0,
                total_orders: parseInt(totalOrders.total_orders) || 0,
                total_income: parseFloat(totalIncome.total_income) || 0,
                total_products: parseInt(totalProducts.total_products) || 0,
                pending_orders: parseInt(pendingOrders.pending_orders) || 0,
                process_orders: parseInt(processOrders.process_orders) || 0,
                done_orders: parseInt(doneOrders.done_orders) || 0,
                order_stats: orderStats,
                daily_stats: dailyStats
            }
        };
        
        console.log("Filter result:", result);
        
        res.json(result);
        
    } catch (error) {
        console.error("Dashboard filter error:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil statistik dengan filter",
            error: error.message
        });
    }
});

// =========================
//     ORDER - FILTER BY DATE (untuk halaman order)
// =========================

app.get("/order/filter", verifyToken, async (req, res) => {
    try {
        const { start_date, end_date, status } = req.query;
        
        let sql = `
            SELECT 
                orders.order_id,
                orders.buyer_id,
                buyer.nama,
                buyer.no_hp,
                buyer.alamat,
                orders.orderdate,
                orders.subtotal,
                orders.jumlah_produk,
                FORMAT(orders.subtotal, 0) as subtotal_formatted,
                orders.status,
                DATE_FORMAT(orders.created_at, '%d-%m-%Y %H:%i') as dibuat_pada
            FROM orders
            JOIN buyer ON orders.buyer_id = buyer.buyer_id
            WHERE 1=1
        `;
        
        const params = [];
        
        // Filter by date range
        if (start_date && end_date) {
            sql += " AND orders.orderdate BETWEEN ? AND ?";
            params.push(start_date, end_date);
        } else if (start_date) {
            sql += " AND orders.orderdate >= ?";
            params.push(start_date);
        } else if (end_date) {
            sql += " AND orders.orderdate <= ?";
            params.push(end_date);
        }
        
        // Filter by status
        if (status && status !== 'all') {
            sql += " AND orders.status = ?";
            params.push(status);
        }
        
        sql += " ORDER BY orders.orderdate DESC, orders.order_id DESC";
        
        const orders = await dbQuery(sql, params);
        res.json(orders);
        
    } catch (error) {
        console.error("Error filter orders:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal filter data order"
        });
    }
});

// =========================
//     ENDPOINT LAINNYA
// =========================

app.get("/product-price", (req, res) => {
    res.json({
        success: true,
        price_per_product: HARGA_PER_PRODUK,
        formatted_price: HARGA_PER_PRODUK.toLocaleString('id-ID')
    });
});

// =========================
//     MIGRATE EXISTING DATA
// =========================

async function migrateExistingData() {
    try {
        console.log("🔄 Checking for data migration...");
        const connection = await pool.getConnection();
        
        // Cek apakah kolom jumlah_produk sudah ada
        const [columns] = await connection.query(`
            SHOW COLUMNS FROM orders LIKE 'jumlah_produk'
        `);
        
        if (columns.length === 0) {
            console.log("📦 Adding jumlah_produk column to existing orders...");
            
            // Tambah kolom
            await connection.query(`
                ALTER TABLE orders 
                ADD COLUMN jumlah_produk INT NOT NULL DEFAULT 0
            `);
            
            console.log("✅ Column added successfully");
        }
        
        // Update data yang sudah ada jika jumlah_produk masih 0
        const [existingData] = await connection.query(`
            SELECT COUNT(*) as count FROM orders WHERE jumlah_produk = 0
        `);
        
        if (existingData[0].count > 0) {
            console.log("🔄 Updating existing order data...");
            await connection.query(`
                UPDATE orders 
                SET jumlah_produk = ROUND(subtotal / 13000)
                WHERE jumlah_produk = 0
            `);
            console.log(`✅ Updated ${existingData[0].count} orders`);
        }
        
        connection.release();
        console.log("🎉 Data migration complete!");
        
    } catch (error) {
        console.log("ℹ️ Migration not needed or already completed:", error.message);
    }
}

// =========================
//     SERVER START
// =========================

const PORT = 3000;

// Start server
initializeDatabase().then(async () => {
    // Panggil fungsi migrasi setelah database siap
    await migrateExistingData();
    
    app.listen(PORT, () => {
        console.log(`\n🚀 Server running on port ${PORT}`);
        console.log(`👉 Login dengan: username="admin", password="admin123"`);
        console.log(`👉 Database: MySQL (dimsum_keju_db)`);
        console.log(`👉 API URL: http://localhost:${PORT}`);
        console.log(`\n📊 Endpoints Dashboard:`);
        console.log(`   - GET /dashboard-stats (tanpa filter)`);
        console.log(`   - GET /dashboard-filter?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD (dengan filter)`);
        console.log(`\n📊 Database status:`);
        console.log(`   - Tabel siap: penjual, buyer, orders`);
        console.log(`   - Harga per produk: Rp ${HARGA_PER_PRODUK.toLocaleString('id-ID')}`);
    });
}).catch(error => {
    console.error("❌ Failed to start server:", error.message);
});