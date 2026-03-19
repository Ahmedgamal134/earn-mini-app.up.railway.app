const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');

require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ خطأ: التوكن مش موجود");
    process.exit(1);
}

// ✅ تحسين إعدادات Polling لتجنب Conflict
const bot = new TelegramBot(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

const appBaseUrl = process.env.APP_URL;
if (!appBaseUrl) {
    console.error("❌ خطأ: APP_URL مش موجود");
    process.exit(1);
}

// ----------------------------------------
// ✅ الاتصال بـ MongoDB
// ----------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("❌ خطأ: DATABASE_URL مش موجود");
    process.exit(1);
}

mongoose.connect(DATABASE_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
});

// ----------------------------------------
// ✅ Schema ونماذج MongoDB
// ----------------------------------------
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    points: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    spins: { type: Number, default: 3 },
    lastCheckin: { type: Date, default: null },
    referrals: { type: [String], default: [] },
    pendingWithdrawals: [{
        method: String,
        methodName: String,
        accountDetails: String,
        points: Number,
        amountEGP: Number,
        date: { type: Date, default: Date.now },
        status: { type: String, default: 'pending' }
    }],
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);
const Admin = mongoose.model('Admin', adminSchema);

// ----------------------------------------
// ✅ إعدادات Express
// ----------------------------------------
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

// ----------------------------------------
// ✅ الصفحة الرئيسية
// ----------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ----------------------------------------
// ✅ APIs
// ----------------------------------------

// API: Get user data
app.get('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        let user = await User.findOne({ username });
        
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`✅ مستخدم جديد: ${username}`);
        }
        
        user.lastActive = new Date();
        await user.save();
        
        res.json({
            username: user.username,
            points: user.points,
            walletBalance: user.walletBalance,
            spins: user.spins,
            lastCheckin: user.lastCheckin,
            referrals: user.referrals,
            pendingWithdrawals: user.pendingWithdrawals.filter(w => w.status === 'pending')
        });
    } catch (error) {
        console.error('خطأ في جلب المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// ✅ API حفظ النقاط (محدث مع تحسينات)
app.post('/api/save-user', async (req, res) => {
    try {
        const { username, data } = req.body;
        
        // ✅ التأكد من البيانات
        console.log("📥 بيانات واردة للحفظ:", { 
            username, 
            points: data.points,
            walletBalance: data.walletBalance 
        });

        // ✅ البحث عن المستخدم وتحديثه
        const user = await User.findOneAndUpdate(
            { username },
            {
                points: data.points,
                walletBalance: data.walletBalance,
                spins: data.spins,
                lastCheckin: data.lastCheckin,
                referrals: data.referrals,
                lastActive: new Date()
            },
            { 
                new: true, 
                upsert: true,
                runValidators: true
            }
        );
        
        console.log(`✅ تم حفظ نقاط ${username}: ${data.points}`);
        console.log("📤 البيانات بعد الحفظ:", {
            points: user.points,
            walletBalance: user.walletBalance
        });
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('❌ خطأ في حفظ المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم', details: error.message });
    }
});

// API: Invite friend
app.post('/api/invite', async (req, res) => {
    try {
        const { username, friendUsername } = req.body;
        
        const friend = await User.findOne({ username: friendUsername });
        if (!friend) {
            return res.json({ success: false, message: 'الصديق غير موجود' });
        }
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        
        if (user.referrals.includes(friendUsername)) {
            return res.json({ success: false, message: 'تمت الدعوة من قبل' });
        }
        
        user.referrals.push(friendUsername);
        await user.save();
        
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
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        
        user.pendingWithdrawals.push(withdrawal);
        user.walletBalance -= withdrawal.points;
        await user.save();
        
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

// ----------------------------------------
// ✅ لوحة التحكم
// ----------------------------------------
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });
        
        if (admin && await bcrypt.compare(password, admin.password)) {
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
        const users = await User.find().sort({ points: -1 });
        const stats = {
            totalUsers: users.length,
            totalPoints: users.reduce((sum, u) => sum + u.points, 0),
            totalWithdrawn: users.reduce((sum, u) => sum + u.walletBalance, 0),
            pendingWithdrawals: users.reduce((sum, u) => sum + u.pendingWithdrawals.filter(w => w.status === 'pending').length, 0)
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
        const user = await User.findOne({ username: req.params.username });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/admin/api/user/update-points', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    
    try {
        const { username, points, action } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        if (action === 'set') {
            user.points = points;
            user.walletBalance = points;
        } else if (action === 'add') {
            user.points += points;
            user.walletBalance += points;
        }
        
        await user.save();
        res.json({ success: true, user });
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
        const withdrawalId = req.params.id;
        const action = req.params.action;
        
        const user = await User.findOne({ 'pendingWithdrawals._id': withdrawalId });
        if (!user) {
            return res.status(404).json({ error: 'طلب السحب غير موجود' });
        }
        
        const withdrawal = user.pendingWithdrawals.id(withdrawalId);
        withdrawal.status = action === 'approve' ? 'approved' : 'rejected';
        
        if (action === 'reject') {
            user.walletBalance += withdrawal.points;
            user.points += withdrawal.points;
        }
        
        await user.save();
        
        bot.sendMessage(user.username, 
            action === 'approve' 
                ? `✅ تمت الموافقة على طلب السحب بقيمة ${withdrawal.amountEGP} جنيه`
                : `❌ تم رفض طلب السحب بقيمة ${withdrawal.amountEGP} جنيه`
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

// ----------------------------------------
// ✅ إنشاء مشرف افتراضي
// ----------------------------------------
async function createDefaultAdmin() {
    try {
        const adminExists = await Admin.findOne({ username: 'admin' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            const admin = new Admin({ username: 'admin', password: hashedPassword });
            await admin.save();
            console.log('✅ تم إنشاء مشرف افتراضي (admin/admin123)');
        }
    } catch (error) {
        console.error('خطأ في إنشاء المشرف:', error);
    }
}
createDefaultAdmin();

// ----------------------------------------
// ✅ أوامر البوت
// ----------------------------------------
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    console.log(`📩 /start من ${username}`);
    
    try {
        let user = await User.findOne({ username });
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`✅ مستخدم جديد: ${username}`);
        }
        
        const appUrl = `${appBaseUrl}/?user=${username}`;
        
        await bot.sendMessage(chatId, `مرحباً ${username}! 👋\n\n🎡 أهلاً بك في تطبيق عجلة الحظ\n💰 اكسب النقاط ودعوة الأصدقاء`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 فتح التطبيق', web_app: { url: appUrl } }],
                    [{ text: '📢 دعوة صديق', switch_inline_query: `انضم إلي في تطبيق الكسب!` }]
                ]
            }
        });
    } catch (error) {
        console.error('❌ خطأ في /start:', error.message);
    }
});

bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🔐 لوحة تحكم المشرف:\n${appBaseUrl}/admin/login`);
});

// استقبال أي رسالة نصية أخرى (للتأكد)
bot.on('message', (msg) => {
    console.log(`📨 رسالة واردة من ${msg.from.username || msg.from.first_name}: ${msg.text}`);
});

// ----------------------------------------
// ✅ تشغيل الخادم
// ----------------------------------------
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 رابط التطبيق: ${appBaseUrl}`);
});
