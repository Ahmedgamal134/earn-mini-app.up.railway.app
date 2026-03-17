const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// ✅ التوكن من متغيرات البيئة
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ خطأ: التوكن مش موجود");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ خدمة الملفات الثابتة من المجلد الحالي
app.use(express.static(__dirname));

// ✅ Route رئيسي عشان يخدم index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(cors());
app.use(bodyParser.json());

// تخزين بيانات المستخدمين
const userData = new Map();

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم شغال على بورت ${PORT}`);
    console.log(`📁 الملفات بتتخدم من: ${__dirname}`);
});

// أمر /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!userData.has(username)) {
        userData.set(username, {
            username: username,
            points: 0,
            spins: 3,
            lastCheckin: null,
            referrals: [],
            walletBalance: 0,
            pendingWithdrawals: []
        });
    }
    
    const appBaseUrl = process.env.APP_URL || `https://${process.env.RAILWAY_STATIC_URL}`;
    const appUrl = `${appBaseUrl}/?user=${username}`;
    
    bot.sendMessage(chatId, `مرحباً ${username}! 👋\n\n🎡 اهلاً بك في تطبيق عجلة الحظ\n💰 اكسب النقاط ودعوة الأصدقاء`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 فتح التطبيق', web_app: { url: appUrl } }],
                [{ text: '📢 دعوة صديق', switch_inline_query: 'انضم إلي في تطبيق الكسب!' }]
            ]
        }
    });
});

// API: استرجاع بيانات المستخدم
app.get('/api/user/:username', (req, res) => {
    const username = req.params.username;
    const data = userData.get(username) || null;
    res.json(data);
});

// API: حفظ بيانات المستخدم
app.post('/api/save-user', (req, res) => {
    const { username, data } = req.body;
    userData.set(username, data);
    res.json({ success: true });
});

// API: دعوة صديق
app.post('/api/invite', (req, res) => {
    const { username, friendUsername } = req.body;
    
    if (!userData.has(friendUsername)) {
        return res.json({ success: false, message: 'الصديق مش موجود' });
    }
    
    const inviterData = userData.get(username);
    
    if (inviterData.referrals.includes(friendUsername)) {
        return res.json({ success: false, message: 'تمت الدعوة من قبل' });
    }
    
    inviterData.referrals.push(friendUsername);
    res.json({ success: true });
});

// API: طلب سحب
app.post('/api/withdraw', (req, res) => {
    const { username, withdrawal } = req.body;
    const user = userData.get(username);
    
    if (user) {
        user.pendingWithdrawals.push(withdrawal);
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'المستخدم غير موجود' });
    }
});

console.log('🤖 البوت شغال...');
