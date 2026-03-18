const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');

// Load environment variables
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ خطأ فادح: توكن البوت غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}

// ✅ استخدام Webhook بدلاً من Polling
const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ الحصول على رابط التطبيق الأساسي
const appBaseUrl = process.env.APP_URL;
if (!appBaseUrl) {
    console.error("❌ خطأ فادح: APP_URL غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}
const webhookUrl = `${appBaseUrl}/bot${token}`;
console.log(`🔗 محاولة تعيين Webhook إلى: ${webhookUrl}`);

// تعيين Webhook
bot.setWebHook(webhookUrl)
    .then(() => console.log('✅ Webhook تم تعيينه بنجاح'))
    .catch(err => console.error('❌ فشل تعيين Webhook:', err.message));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("❌ خطأ فادح: MONGODB_URI غير موجود. تأكد من إضافته في متغيرات البيئة.");
    process.exit(1);
}
console.log('🔌 جاري الاتصال بـ MongoDB...');
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ تم الاتصال بـ MongoDB بنجاح'))
    .catch(err => console.error('❌ فشل الاتصال بـ MongoDB:', err.message));

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    points: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    spins: { type: Number, default: 3 },
    lastCheckin: { type: Date, default: null },
    referrals: [{ type: String }],
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

// Admin Schema
const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);
const Admin = mongoose.model('Admin', adminSchema);

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // تأكد من وجود مجلد public أو استخدم __dirname لخدمة الملفات من الجذر
app.use(express.static(__dirname)); // لخدمة index.html من الجذر أيضاً
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-strong-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // في الإنتاج، قد تحتاج لضبطه على true إذا كنت تستخدم HTTPS
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ✅ Webhook endpoint
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Get user data
app.get('/api/user/:username', async (req, res) => {
    try {
        const username = req.params.username;
        let user = await User.findOne({ username });
        
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`✅ مستخدم جديد تم إنشاؤه: ${username}`);
        }
        
        user.lastActive = new Date();
        await user.save();
        
        res.json(user);
    } catch (error) {
        console.error('خطأ في جلب المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// API: Save user data
app.post('/api/save-user', async (req, res) => {
    try {
        const { username, data } = req.body;
        delete data._id;
        delete data.__v;
        
        const user = await User.findOneAndUpdate(
            { username },
            { ...data, lastActive: new Date() },
            { new: true, upsert: true }
        );
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('خطأ في حفظ المستخدم:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// API: Invite friend
app.post('/api/invite', async (req, res) => {
    try {
        const { username, friendUsername } = req.body;
        
        const friend = await User.findOne({ username: friendUsername });
        if (!friend) {
            return res.json({ success: false, message: 'الصديق غير موجود في التطبيق' });
        }
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        
        if (user.referrals.includes(friendUsername)) {
            return res.json({ success: false, message: 'تمت دعوة هذا الصديق من قبل' });
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

// Admin Panel Routes
async function createDefaultAdmin() {
    try {
        const adminExists = await Admin.findOne({ username: 'admin' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            const admin = new Admin({
                username: 'admin',
                password: hashedPassword
            });
            await admin.save();
            console.log('✅ تم إنشاء مشرف افتراضي (admin/admin123)');
        }
    } catch (error) {
        console.error('خطأ في إنشاء المشرف الافتراضي:', error);
    }
}
createDefaultAdmin();

// Admin login page
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Admin login API
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

// Admin dashboard
app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }
    
    try {
        const users = await User.find().sort({ points: -1 });
        const stats = {
            totalUsers: users.length,
            totalPoints: users.reduce((sum, u) => sum + (u.points || 0), 0),
            totalWithdrawn: users.reduce((sum, u) => sum + ((u.walletBalance || 0) - (u.points || 0)), 0),
            pendingWithdrawals: users.reduce((sum, u) => sum + u.pendingWithdrawals.filter(w => w.status === 'pending').length, 0)
        };
        
        res.render('dashboard', { users, stats });
    } catch (error) {
        console.error('خطأ في لوحة التحكم:', error);
        res.status(500).send('خطأ في الخادم');
    }
});

// Admin API: Get user details
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

// Admin API: Update user points
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

// Admin API: Process withdrawal
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

// Admin logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Bot commands
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    console.log(`📩 تم استلام /start من ${username} (Chat ID: ${chatId})`);
    
    try {
        let user = await User.findOne({ username });
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`✅ مستخدم جديد من البوت: ${username}`);
        }
        
        const appUrl = `${appBaseUrl}/?user=${username}`;
        console.log(`📤 جاري إرسال الرد إلى ${username}...`);
        
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

// استقبال أي رسالة نصية أخرى (للتأكد)
bot.on('message', (msg) => {
    console.log(`📨 رسالة واردة من ${msg.from.username || msg.from.first_name}: ${msg.text}`);
});

app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`📁 الملفات الثابتة تخدم من: ${__dirname}`);
    console.log(`🔗 رابط التطبيق: ${appBaseUrl}`);
});
