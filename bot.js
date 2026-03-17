const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const token = '8617943344:AAGrxfAedccd1nd1pRCpq1l5AI92psPahMA';
const bot = new TelegramBot(token, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// تخزين بيانات المستخدمين
const userData = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// تشغيل خادم ويب
app.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
});

// معالجة أمر /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // إنشاء بيانات للمستخدم الجديد
    if (!userData.has(username)) {
        userData.set(username, {
            username: username,
            points: 0,
            spins: 3, // بداية بثلاث لفات مجانية
            lastCheckin: null,
            referrals: [],
            walletBalance: 0,
            pendingWithdrawals: []
        });
    }
    
    // إرسال رابط التطبيق المصغر
    const appUrl = `https://earn-mini-appuprailwayapp-production.up.railway.app/?user=${username}`;
    
    bot.sendMessage(chatId, `مرحباً ${username}! 👋\n\nمرحباً بك في تطبيق Earn Mini App - عجلة الحظ!\n\n🎡 اكسب النقاط ودعوة الأصدقاء واستمتع بعجلة الحظ\n\n💰 ابدأ الآن:`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 فتح التطبيق', web_app: { url: appUrl } }],
                [{ text: '📢 دعوة صديق', switch_inline_query: 'انضم إلي في تطبيق الكسب!' }]
            ]
        }
    });
});

// معالجة الدعوات
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/invite ')) {
        const chatId = msg.chat.id;
        const inviter = msg.from.username || msg.from.first_name;
        const invited = msg.text.split(' ')[1];
        
        const inviterData = userData.get(inviter);
        
        if (inviterData && !inviterData.referrals.includes(invited)) {
            inviterData.referrals.push(invited);
            inviterData.points += 30;
            inviterData.walletBalance += 30;
            
            bot.sendMessage(chatId, `✅ تمت إضافة الصديق ${invited} بنجاح! ربحت 30 نقطة`);
        }
    }
});

// API endpoints
app.get('/api/user/:username', (req, res) => {
    const username = req.params.username;
    const data = userData.get(username) || null;
    res.json(data);
});

app.post('/api/save-user', (req, res) => {
    const { username, data } = req.body;
    userData.set(username, data);
    res.json({ success: true });
});

app.post('/api/invite', (req, res) => {
    const { username, friendUsername } = req.body;
    
    // التحقق من وجود الصديق في قاعدة البيانات
    if (!userData.has(friendUsername)) {
        return res.json({ 
            success: false, 
            message: 'الصديق غير موجود في التطبيق بعد. الرجاء التأكد من أن الصديق بدأ استخدام البوت أولاً' 
        });
    }
    
    const inviterData = userData.get(username);
    
    if (inviterData.referrals.includes(friendUsername)) {
        return res.json({ 
            success: false, 
            message: 'لقد قمت بدعوة هذا الصديق من قبل' 
        });
    }
    
    // إضافة الدعوة
    inviterData.referrals.push(friendUsername);
    
    // منح النقاط عندما ينجز الصديق المهمة (سيتم تحديثها لاحقاً)
    res.json({ success: true });
});

app.post('/api/withdraw', (req, res) => {
    const { username, withdrawal } = req.body;
    const user = userData.get(username);
    
    if (user) {
        user.pendingWithdrawals.push(withdrawal);
        // إرسال إشعار للمشرف (يمكنك تغيير هذا إلى معرف المشرف الخاص بك)
        bot.sendMessage('ADMIN_CHAT_ID', 
            `💰 طلب سحب جديد:\nالمستخدم: ${username}\nالطريقة: ${withdrawal.method}\nالمبلغ: ${withdrawal.amount} نقطة\nالتفاصيل: ${withdrawal.accountDetails}`
        );
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'المستخدم غير موجود' });
    }
});

console.log('البوت يعمل...');
