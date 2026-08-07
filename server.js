const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// =========================================================
// ===== CONFIGURATION =====
// =========================================================
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'hostcloud_super_secret_key_change_this_in_production';

// =========================================================
// ===== DATABASE SETUP =====
// =========================================================
const dbPath = path.join(__dirname, 'hostcloud.db');
const db = new sqlite3.Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Create tables
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'client',
            subdomain TEXT UNIQUE,
            avatar TEXT,
            plan TEXT DEFAULT 'free',
            plan_status TEXT DEFAULT 'active',
            renewal_date TEXT,
            api_key TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Websites table
    db.run(`
        CREATE TABLE IF NOT EXISTS websites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            domain TEXT NOT NULL,
            template TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            container_id TEXT,
            port INTEGER,
            custom_domain TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Domains table
    db.run(`
        CREATE TABLE IF NOT EXISTS domains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            domain TEXT NOT NULL UNIQUE,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            verified_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Traffic stats table (for demo)
    db.run(`
        CREATE TABLE IF NOT EXISTS traffic_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            total_visitors INTEGER DEFAULT 0,
            today_visitors INTEGER DEFAULT 0,
            page_views INTEGER DEFAULT 0,
            date DATE DEFAULT CURRENT_DATE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Insert demo traffic data if empty
    db.get(`SELECT COUNT(*) as count FROM traffic_stats`, (err, row) => {
        if (err) {
            console.error('Error checking traffic stats:', err);
            return;
        }
        if (row.count === 0) {
            // Insert demo data for user 1 (will be created later)
            const stmt = db.prepare(`
                INSERT INTO traffic_stats (user_id, total_visitors, today_visitors, page_views)
                VALUES (?, ?, ?, ?)
            `);
            // We'll insert these after user creation
            stmt.finalize();
        }
    });

    console.log('✅ Database initialized successfully');
});

// =========================================================
// ===== MIDDLEWARE =====
// =========================================================
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', '*'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// ===== HELPER FUNCTIONS =====
// =========================================================
function generateApiKey() {
    return 'hc_live_' + Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

function generateSubdomain(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') + '.hostcloud.com';
}

function generateToken(userId) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

// =========================================================
// ===== AUTH MIDDLEWARE =====
// =========================================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
}

// =========================================================
// ===== DATABASE HELPERS =====
// =========================================================
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// =========================================================
// ===== INIT DEMO USER =====
// =========================================================
async function createDemoUser() {
    try {
        const existing = await getQuery('SELECT id FROM users WHERE email = ?', ['demo@hostcloud.com']);
        if (!existing) {
            const hashedPassword = await bcrypt.hash('demo123456', 10);
            const apiKey = generateApiKey();
            const subdomain = 'demo';
            
            const result = await runQuery(`
                INSERT INTO users (name, email, password, role, subdomain, api_key, plan, renewal_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, ['Demo User', 'demo@hostcloud.com', hashedPassword, 'client', subdomain, apiKey, 'pro', '2026-12-15']);

            // Insert demo websites
            const userId = result.lastID;
            await runQuery(`
                INSERT INTO websites (user_id, name, domain, template, status)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, 'مدونتي', 'demo-blog.hostcloud.com', 'مدونة', 'deployed']);
            
            await runQuery(`
                INSERT INTO websites (user_id, name, domain, template, status)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, 'متجري', 'demo-shop.hostcloud.com', 'متجر', 'deployed']);
            
            await runQuery(`
                INSERT INTO websites (user_id, name, domain, template, status)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, 'بورتفوليو', 'demo-work.hostcloud.com', 'بورتفوليو', 'draft']);

            // Insert demo traffic
            await runQuery(`
                INSERT INTO traffic_stats (user_id, total_visitors, today_visitors, page_views)
                VALUES (?, ?, ?, ?)
            `, [userId, 8247, 342, 24891]);

            console.log('✅ Demo user created successfully!');
            console.log('   Email: demo@hostcloud.com');
            console.log('   Password: demo123456');
        }
    } catch (error) {
        console.error('Error creating demo user:', error);
    }
}

// =========================================================
// ===== AUTH ROUTES =====
// =========================================================

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        // Check if user exists
        const existingUser = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const apiKey = generateApiKey();
        const subdomain = generateSubdomain(name);

        // Create user
        const result = await runQuery(`
            INSERT INTO users (name, email, password, api_key, subdomain)
            VALUES (?, ?, ?, ?, ?)
        `, [name, email, hashedPassword, apiKey, subdomain]);

        const userId = result.lastID;

        // Initialize traffic stats
        await runQuery(`
            INSERT INTO traffic_stats (user_id, total_visitors, today_visitors, page_views)
            VALUES (?, ?, ?, ?)
        `, [userId, 0, 0, 0]);

        // Generate token
        const token = generateToken(userId);

        // Get user data
        const user = await getQuery(`
            SELECT id, name, email, role, subdomain, avatar, plan, plan_status, renewal_date, api_key, created_at
            FROM users WHERE id = ?
        `, [userId]);

        res.status(201).json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                subdomain: user.subdomain,
                avatar: user.avatar,
                plan: user.plan,
                plan_status: user.plan_status,
                renewal_date: user.renewal_date,
                api_key: user.api_key,
                created_at: user.created_at
            }
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء التسجيل' });
    }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
        }

        // Find user
        const user = await getQuery(`
            SELECT id, name, email, password, role, subdomain, avatar, plan, plan_status, renewal_date, api_key, created_at
            FROM users WHERE email = ?
        `, [email]);

        if (!user) {
            return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }

        // Generate token
        const token = generateToken(user.id);

        // Update last login
        await runQuery(`UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                subdomain: user.subdomain,
                avatar: user.avatar,
                plan: user.plan,
                plan_status: user.plan_status,
                renewal_date: user.renewal_date,
                api_key: user.api_key,
                created_at: user.created_at
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery(`
            SELECT id, name, email, role, subdomain, avatar, plan, plan_status, renewal_date, api_key, created_at
            FROM users WHERE id = ?
        `, [req.userId]);

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // Get user stats
        const sites = await allQuery(`
            SELECT COUNT(*) as count FROM websites WHERE user_id = ? AND status = 'deployed'
        `, [req.userId]);
        
        const drafts = await allQuery(`
            SELECT COUNT(*) as count FROM websites WHERE user_id = ? AND status = 'draft'
        `, [req.userId]);

        const traffic = await getQuery(`
            SELECT total_visitors, today_visitors, page_views 
            FROM traffic_stats WHERE user_id = ? 
            ORDER BY date DESC LIMIT 1
        `, [req.userId]);

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                subdomain: user.subdomain,
                avatar: user.avatar,
                plan: user.plan,
                plan_status: user.plan_status,
                renewal_date: user.renewal_date,
                api_key: user.api_key,
                created_at: user.created_at,
                stats: {
                    sites: sites.length > 0 ? sites[0].count : 0,
                    drafts: drafts.length > 0 ? drafts[0].count : 0
                },
                traffic: {
                    total_visitors: traffic ? traffic.total_visitors : 0,
                    today_visitors: traffic ? traffic.today_visitors : 0,
                    page_views: traffic ? traffic.page_views : 0
                }
            }
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب البيانات' });
    }
});

// PUT /api/auth/update
app.put('/api/auth/update', authenticateToken, async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email) {
            return res.status(400).json({ error: 'الاسم والبريد الإلكتروني مطلوبان' });
        }

        // Check if email is taken by another user
        const existing = await getQuery(
            'SELECT id FROM users WHERE email = ? AND id != ?', 
            [email, req.userId]
        );
        if (existing) {
            return res.status(400).json({ error: 'البريد الإلكتروني مستخدم من قبل' });
        }

        let updateQuery = 'UPDATE users SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP';
        let params = [name, email];

        if (password && password.length >= 6) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery += ', password = ?';
            params.push(hashedPassword);
        }

        updateQuery += ' WHERE id = ?';
        params.push(req.userId);

        await runQuery(updateQuery, params);

        // Get updated user
        const user = await getQuery(`
            SELECT id, name, email, role, subdomain, avatar, plan, plan_status, renewal_date, api_key, created_at
            FROM users WHERE id = ?
        `, [req.userId]);

        res.json({
            message: 'تم تحديث البيانات بنجاح',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                subdomain: user.subdomain,
                avatar: user.avatar,
                plan: user.plan,
                plan_status: user.plan_status,
                renewal_date: user.renewal_date,
                api_key: user.api_key,
                created_at: user.created_at
            }
        });

    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث البيانات' });
    }
});

// =========================================================
// ===== WEBSITES ROUTES =====
// =========================================================

// GET /api/sites
app.get('/api/sites', authenticateToken, async (req, res) => {
    try {
        const sites = await allQuery(`
            SELECT id, name, domain, template, status, custom_domain, created_at, updated_at
            FROM websites WHERE user_id = ?
            ORDER BY created_at DESC
        `, [req.userId]);

        res.json({ sites });

    } catch (error) {
        console.error('Get sites error:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب المواقع' });
    }
});

// POST /api/sites
app.post('/api/sites', authenticateToken, async (req, res) => {
    try {
        const { name, domain, template } = req.body;

        if (!name || !template) {
            return res.status(400).json({ error: 'اسم الموقع والقالب مطلوبان' });
        }

        const finalDomain = domain || generateSubdomain(name);

        // Check domain uniqueness
        const existing = await getQuery(
            'SELECT id FROM websites WHERE domain = ?', 
            [finalDomain]
        );
        if (existing) {
            return res.status(400).json({ error: 'هذا النطاق مستخدم بالفعل' });
        }

        const result = await runQuery(`
            INSERT INTO websites (user_id, name, domain, template, status)
            VALUES (?, ?, ?, ?, ?)
        `, [req.userId, name, finalDomain, template, 'deploying']);

        // Simulate deployment
        setTimeout(async () => {
            await runQuery(
                'UPDATE websites SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['deployed', result.lastID]
            );
        }, 3000);

        const site = await getQuery(`
            SELECT id, name, domain, template, status, custom_domain, created_at, updated_at
            FROM websites WHERE id = ?
        `, [result.lastID]);

        res.status(201).json({
            message: 'تم إنشاء الموقع بنجاح',
            site
        });

    } catch (error) {
        console.error('Create site error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الموقع' });
    }
});

// DELETE /api/sites/:id
app.delete('/api/sites/:id', authenticateToken, async (req, res) => {
    try {
        const siteId = parseInt(req.params.id);

        // Check if site belongs to user
        const site = await getQuery(
            'SELECT id, user_id FROM websites WHERE id = ? AND user_id = ?',
            [siteId, req.userId]
        );

        if (!site) {
            return res.status(404).json({ error: 'الموقع غير موجود أو لا ينتمي لك' });
        }

        await runQuery('DELETE FROM websites WHERE id = ?', [siteId]);

        res.json({ message: 'تم حذف الموقع بنجاح' });

    } catch (error) {
        console.error('Delete site error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف الموقع' });
    }
});

// =========================================================
// ===== DOMAINS ROUTES =====
// =========================================================

// POST /api/domains/connect
app.post('/api/domains/connect', authenticateToken, async (req, res) => {
    try {
        const { domain } = req.body;

        if (!domain) {
            return res.status(400).json({ error: 'النطاق مطلوب' });
        }

        // Validate domain format (basic)
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
        if (!domainRegex.test(domain)) {
            return res.status(400).json({ error: 'صيغة النطاق غير صحيحة' });
        }

        // Check if domain already exists
        const existing = await getQuery(
            'SELECT id FROM domains WHERE domain = ?',
            [domain]
        );
        if (existing) {
            return res.status(400).json({ error: 'هذا النطاق مسجل بالفعل' });
        }

        await runQuery(`
            INSERT INTO domains (user_id, domain, status)
            VALUES (?, ?, ?)
        `, [req.userId, domain, 'verified']);

        // Update website with custom domain
        await runQuery(`
            UPDATE websites SET custom_domain = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND status = 'deployed'
            ORDER BY created_at DESC LIMIT 1
        `, [domain, req.userId]);

        res.json({
            message: `تم ربط النطاق "${domain}" بنجاح`,
            success: true
        });

    } catch (error) {
        console.error('Connect domain error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء ربط النطاق' });
    }
});

// =========================================================
// ===== TRAFFIC ROUTES (for demo) =====
// =========================================================

// GET /api/traffic
app.get('/api/traffic', authenticateToken, async (req, res) => {
    try {
        const traffic = await getQuery(`
            SELECT total_visitors, today_visitors, page_views 
            FROM traffic_stats WHERE user_id = ? 
            ORDER BY date DESC LIMIT 1
        `, [req.userId]);

        // If no traffic data, create default
        if (!traffic) {
            await runQuery(`
                INSERT INTO traffic_stats (user_id, total_visitors, today_visitors, page_views)
                VALUES (?, ?, ?, ?)
            `, [req.userId, 0, 0, 0]);
            
            return res.json({
                total_visitors: 0,
                today_visitors: 0,
                page_views: 0
            });
        }

        res.json(traffic);

    } catch (error) {
        console.error('Get traffic error:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب الإحصائيات' });
    }
});

// POST /api/traffic/update (for simulating traffic)
app.post('/api/traffic/update', authenticateToken, async (req, res) => {
    try {
        await runQuery(`
            UPDATE traffic_stats 
            SET total_visitors = total_visitors + 1,
                today_visitors = today_visitors + 1,
                page_views = page_views + 1
            WHERE user_id = ?
        `, [req.userId]);

        res.json({ message: 'تم تحديث الإحصائيات' });

    } catch (error) {
        console.error('Update traffic error:', error);
        res.status(500).json({ error: 'حدث خطأ' });
    }
});

// =========================================================
// ===== HEALTH CHECK =====
// =========================================================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        timestamp: new Date().toISOString(),
        database: 'SQLite',
        version: '1.0.0'
    });
});

// =========================================================
// ===== ERROR HANDLING =====
// =========================================================
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'حدث خطأ في السيرفر',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// =========================================================
// ===== START SERVER =====
// =========================================================
async function startServer() {
    try {
        // Create demo user
        await createDemoUser();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`📊 API Documentation: http://localhost:${PORT}/api/health`);
            console.log('\n📝 Demo Account:');
            console.log('   Email: demo@hostcloud.com');
            console.log('   Password: demo123456');
            console.log('\n🔐 JWT Secret:', JWT_SECRET.substring(0, 10) + '...');
            console.log('📁 Database:', dbPath);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});