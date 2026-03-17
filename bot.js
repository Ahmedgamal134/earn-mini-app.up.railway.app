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
    console.error("❌ خطأ: التوكن مش موجود");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection for Railway internal DB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongodb:27017/earn_bot';
console.log('🔌 Connecting to MongoDB...');
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB successfully'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    points: { type: Number, default: 0 },
    spins: { type: Number, default: 3 },
    lastCheckin: { type: Date, default: null },
    referrals: [{ type: String }],
    walletBalance: { type: Number, default: 0 },
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
app.use(express.static(__dirname));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

// View engine setup for admin panel
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
            console.log(`✅ New user created: ${username}`);
        }
        
        user.lastActive = new Date();
        await user.save();
        
        res.json(user);
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Save user data
app.post('/api/save-user', async (req, res) => {
    try {
        const { username, data } = req.body;
        
        delete data._id;
        delete data.__v;
        delete data.createdAt;
        
        const user = await User.findOneAndUpdate(
            { username },
            { ...data, lastActive: new Date() },
            { new: true, upsert: true }
        );
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('Error saving user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Invite friend
app.post('/api/invite', async (req, res) => {
    try {
        const { username, friendUsername } = req.body;
        
        const friend = await User.findOne({ username: friendUsername });
        if (!friend) {
            return res.json({ success: false, message: 'الصديق مش موجود في التطبيق' });
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
        console.error('Error inviting friend:', error);
        res.status(500).json({ error: 'Server error' });
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
        
        // Notify admin
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (adminChatId) {
            bot.sendMessage(adminChatId, 
                `💰 طلب سحب جديد:\nالمستخدم: ${username}\nالطريقة: ${withdrawal.methodName}\nالمبلغ: ${withdrawal.amountEGP} جنيه\nالنقاط: ${withdrawal.points}\nالتفاصيل: ${withdrawal.accountDetails}`
            ).catch(e => console.log('Admin notification error:', e));
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error processing withdrawal:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin Panel Routes

// Create default admin (run once)
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
            console.log('✅ Default admin created (username: admin, password: admin123)');
        }
    } catch (error) {
        console.error('Error creating default admin:', error);
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
        console.error('Login error:', error);
        res.status(500).send('Server error');
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
            totalPoints: users.reduce((sum, u) => sum + u.points, 0),
            totalWithdrawn: users.reduce((sum, u) => sum + (u.walletBalance || 0), 0),
            pendingWithdrawals: users.reduce((sum, u) => sum + u.pendingWithdrawals.filter(w => w.status === 'pending').length, 0)
        };
        
        res.render('dashboard', { users, stats });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

// Admin API: Get user details
app.get('/admin/api/user/:username', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const user = await User.findOne({ username: req.params.username });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API: Update user points
app.post('/admin/api/user/update-points', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { username, points, action } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
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
        console.error('Error updating points:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API: Process withdrawal
app.post('/admin/api/withdrawal/:id/:action', async (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const withdrawalId = req.params.id;
        const action = req.params.action;
        
        const user = await User.findOne({ 'pendingWithdrawals._id': withdrawalId });
        if (!user) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }
        
        const withdrawal = user.pendingWithdrawals.id(withdrawalId);
        withdrawal.status = action === 'approve' ? 'approved' : 'rejected';
        
        if (action === 'reject') {
            user.walletBalance += withdrawal.points;
            user.points += withdrawal.points;
        }
        
        await user.save();
        
        // Notify user
        bot.sendMessage(user.username, 
            action === 'approve' 
                ? `✅ تمت الموافقة على طلب السحب بقيمة ${withdrawal.amountEGP} جنيه`
                : `❌ تم رفض طلب السحب بقيمة ${withdrawal.amountEGP} جنيه`
        ).catch(e => console.log('User notification error:', e));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error processing withdrawal:', error);
        res.status(500).json({ error: 'Server error' });
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
    
    try {
        let user = await User.findOne({ username });
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`✅ New user from bot: ${username}`);
        }
        
        const appBaseUrl = process.env.APP_URL || `https://${process.env.RAILWAY_STATIC_URL}`;
        const appUrl = `${appBaseUrl}/?user=${username}`;
        
        bot.sendMessage(chatId, `مرحباً ${username}! 👋\n\n🎡 اهلاً بك في تطبيق عجلة الحظ\n💰 اكسب النقاط ودعوة الأصدقاء`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 فتح التطبيق', web_app: { url: appUrl } }],
                    [{ text: '📢 دعوة صديق', switch_inline_query: `انضم إلي في تطبيق الكسب!` }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in /start:', error);
    }
});

bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    const appBaseUrl = process.env.APP_URL || `https://${process.env.RAILWAY_STATIC_URL}`;
    bot.sendMessage(chatId, `🔐 لوحة تحكم المشرف:\n${appBaseUrl}/admin/login`);
});

app.listen(PORT, () => {
    console.log(`✅ الخادم شغال على بورت ${PORT}`);
    console.log(`📁 الملفات بتتخدم من: ${__dirname}`);
    console.log(`🔗 الرابط: https://${process.env.RAILWAY_STATIC_URL || 'localhost'}`);
});
