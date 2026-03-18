const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Load environment variables
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ خطأ فادح: توكن البوت غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}

const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

const appBaseUrl = process.env.APP_URL;
if (!appBaseUrl) {
    console.error("❌ خطأ فادح: APP_URL غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}
const webhookUrl = `${appBaseUrl}/bot${token}`;
console.log(`🔗 محاولة تعيين Webhook إلى: ${webhookUrl}`);

bot.setWebHook(webhookUrl)
    .then(() => console.log('✅ Webhook تم تعيينه بنجاح'))
    .catch(err => console.error('❌ فشل تعيين Webhook:', err.message));

// ✅ PostgreSQL Connection
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error("❌ خطأ فادح: DATABASE_URL غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
        rejectUnauthorized: false
    }
});

// إنشاء الجداول إذا لم تكن موجودة
const initDb = async () => {
    try {
        // جدول المستخدمين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                points INTEGER DEFAULT 0,
                wallet_balance INTEGER DEFAULT 0,
                spins INTEGER DEFAULT 3,
                last_checkin DATE,
                referrals TEXT[] DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // جدول طلبات السحب
        await pool.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) REFERENCES users(username),
                method VARCHAR(50),
                method_name VARCHAR(100),
                account_details TEXT,
                points INTEGER,
                amount_egp DECIMAL(10,2),
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'pending'
            )
        `);

        // جدول المشرفين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL
            )
        `);

        console.log('✅ تم إنشاء جداول PostgreSQL بنجاح');

        // إنشاء مشرف افتراضي
        const adminExists = await pool.query('SELECT * FROM admins WHERE username = $1', ['admin']);
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO admins (username, password) VALUES ($1, $2)',
                ['admin', hashedPassword]
            );
            console.log('✅ تم إنشاء مشرف افتراضي (admin/admin123)');
        }
    } catch (error) {
        console.error('❌ خطأ في إنشاء الجداول:', error.message);
    }
};

initDb();

// Middleware
app.use(express.static(__dirname));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-strong-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Get user data
app.get('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        let result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        
        if (result.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO users (username) VALUES ($1) RETURNING *',
                [username]
            );
            console.log(`✅ مستخدم جديد تم إنشاؤه: ${username}`);
        }
        
        await pool.query(
            'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE username = $1',
            [username]
        );
        
        const user = result.rows[0];
        // تحويل الـ referrals من array نصي إلى array
        user.referrals = user.referrals || [];
        
        res.json({
            username: user.username,
            points: user.points,
            walletBalance: user.wallet_balance,
            spins: user.spins,
            lastCheckin: user.last_checkin,
            referrals: user.referrals,
            pendingWithdrawals: [] // هنحسنها بعدين
        });
    } catch (error) {
        console.error('خطأ في جلب المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// API: Save user data
app.post('/api/save-user', async (req, res) => {
    try {
        const { username, data } = req.body;
        
        await pool.query(
            `UPDATE users SET 
                points = $1,
                wallet_balance = $2,
                spins = $3,
                last_checkin = $4,
                referrals = $5,
                last_active = CURRENT_TIMESTAMP
            WHERE username = $6`,
            [
                data.points || 0,
                data.walletBalance || 0,
                data.spins || 3,
                data.lastCheckin,
                data.referrals || [],
                username
            ]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في حفظ المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// API: Invite friend
app.post('/api/invite', async (req, res) => {
    try {
        const { username, friendUsername } = req.body;
        
        const friend = await pool.query('SELECT * FROM users WHERE username = $1', [friendUsername]);
        if (friend.rows.length === 0) {
            return res.json({ success: false, message: 'الصديق غير موجود في التطبيق' });
        }
        
        const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (user.rows.length === 0) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        
        const referrals = user.rows[0].referrals || [];
        if (referrals.includes(friendUsername)) {
            return res.json({ success: false, message: 'تمت دعوة هذا الصديق من قبل' });
        }
        
        referrals.push(friendUsername);
        await pool.query(
            'UPDATE users SET referrals = $1 WHERE username = $2',
            [referrals, username]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في دعوة صديق:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// API: Withdraw request
app.post('/api/withdraw', async (req, res) => {
    try {
        const { username, withdrawal } = req.body;
        
        const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (user.rows.length === 0) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        
        // إضافة طلب السحب
        await pool.query(
            `INSERT INTO withdrawals 
                (username, method, method_name, account_details, points, amount_egp, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                username,
                withdrawal.method,
                withdrawal.methodName,
                withdrawal.accountDetails,
                withdrawal.points,
                withdrawal.amountEGP,
                'pending'
            ]
        );
        
        // تحديث رصيد المحفظة
        await pool.query(
            'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE username = $2',
            [withdrawal.points, username]
        );
        
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            bot.sendMessage(adminChatId, 
                `💰 طلب سحب جديد:\nالمستخدم: ${username}\nالطريقة: ${withdrawal.methodName}\nالمبلغ: ${withdrawal.amountEGP} جنيه\nالنقاط: ${withdrawal.points}\nالتفاصيل: ${withdrawal.accountDetails}`
            ).catch(e => console.log('خطأ في إرسال إشعار للمشرف:', e.message));
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في معالجة طلب السحب:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Admin login page
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
        
        if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
            req.session.admin = true;
            res.redirect('/admin/dashboard');
        } else {
            res.send('<script>alert("خطأ في اسم المستخدم أو كلمة المرور"); window.location.href="/admin/login";</script>');
        }
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(500).send('خطأ في الخادم');
    }
});

app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }
    
    try {
        const usersResult = await pool.query('SELECT * FROM users ORDER BY points DESC');
        const withdrawalsResult = await pool.query("SELECT * FROM withdrawals WHERE status = 'pending'");
        
        const users = usersResult.rows.map(user => ({
            ...user,
            referrals: user.referrals || []
        }));
        
        const stats = {
            totalUsers: users.length,
            totalPoints: users.reduce((sum, u) => sum + (u.points || 0), 0),
            totalWithdrawn: users.reduce((sum, u) => sum + (u.wallet_balance || 0), 0),
            pendingWithdrawals: withdrawalsResult.rows.length
        };
        
        res.render('dashboard', { users, stats });
    } catch (error) {
        console.error('خطأ في لوحة التحكم:', error);
        res.status(500).send('خطأ في الخادم');
    }
});

app.get('/admin/api/user/:username', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [req.params.username]);
        const withdrawalsResult = await pool.query('SELECT * FROM withdrawals WHERE username = $1 ORDER BY date DESC', [req.params.username]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        const user = userResult.rows[0];
        user.pendingWithdrawals = withdrawalsResult.rows;
        user.referrals = user.referrals || [];
        
        res.json(user);
    } catch (error) {
        console.error('خطأ في جلب بيانات المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/admin/api/user/update-points', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    
    try {
        const { username, points, action } = req.body;
        
        if (action === 'set') {
            await pool.query(
                'UPDATE users SET points = $1, wallet_balance = $1 WHERE username = $2',
                [points, username]
            );
        } else if (action === 'add') {
            await pool.query(
                'UPDATE users SET points = points + $1, wallet_balance = wallet_balance + $1 WHERE username = $2',
                [points, username]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في تحديث النقاط:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/admin/api/withdrawal/:id/:action', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    
    try {
        const { id, action } = req.params;
        
        const withdrawalResult = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [id]);
        if (withdrawalResult.rows.length === 0) {
            return res.status(404).json({ error: 'طلب السحب غير موجود' });
        }
        
        const withdrawal = withdrawalResult.rows[0];
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        
        await pool.query('UPDATE withdrawals SET status = $1 WHERE id = $2', [newStatus, id]);
        
        if (action === 'reject') {
            await pool.query(
                'UPDATE users SET wallet_balance = wallet_balance + $1, points = points + $1 WHERE username = $2',
                [withdrawal.points, withdrawal.username]
            );
        }
        
        bot.sendMessage(withdrawal.username, 
            action === 'approve' 
                ? `✅ تمت الموافقة على طلب السحب بقيمة ${withdrawal.amount_egp} جنيه`
                : `❌ تم رفض طلب السحب بقيمة ${withdrawal.amount_egp} جنيه`
        ).catch(e => console.log('خطأ في إرسال إشعار للمستخدم:', e.message));
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في معالجة طلب السحب:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    console.log(`📩 تم استلام /start من ${username} (Chat ID: ${chatId})`);
    
    try {
        let result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        
        if (result.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO users (username) VALUES ($1) RETURNING *',
                [username]
            );
            console.log(`✅ مستخدم جديد من البوت: ${username}`);
        }
        
        await pool.query(
            'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE username = $1',
            [username]
        );
        
        const appUrl = `${appBaseUrl}/?user=${username}`;
        
        await bot.sendMessage(chatId, `مرحباً ${username}! 👋\n\n🎡 أهلاً بك في تطبيق عجلة الحظ\n💰 اكسب النقاط ودعوة الأصدقاء`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 فتح التطبيق', web_app: { url: appUrl } }],
                    [{ text: '📢 دعوة صديق', switch_inline_query: `انضم إلي في تطبيق الكسب!` }]
                ]
            }
        });
        console.log(`✅ تم إرسال الرد بنجاح إلى ${username}`);
    } catch (error) {
        console.error('❌ خطأ في معالجة /start:', error.message);
    }
});

bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🔐 لوحة تحكم المشرف:\n${appBaseUrl}/admin/login`);
});

app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 رابط التطبيق: ${appBaseUrl}`);
});
