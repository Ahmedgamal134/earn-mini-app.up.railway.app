// بيانات المستخدم
let userData = {
    username: '',
    points: 0,
    spins: 0,
    lastCheckin: null,
    referrals: [],
    walletBalance: 0,
    pendingWithdrawals: []
};

// تهيئة عجلة الحظ
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const segments = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB', '#E67E22', '#2ECC71', '#F1C40F'];
let spinning = false;
let currentAngle = 0;

// مؤقتات الإعلانات
let adTimers = {
    '6113782': 0,
    '6113667': 0,
    '6113781': 0
};

// تهيئة البوت والتطبيق
document.addEventListener('DOMContentLoaded', function() {
    // الحصول على بيانات المستخدم من التليجرام
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        userData.username = tg.initDataUnsafe.user?.username || 'مستخدم';
        document.getElementById('username').textContent = userData.username;
        
        // تحميل بيانات المستخدم من الخادم
        loadUserData();
    }
    
    // رسم العجلة
    drawWheel();
    
    // تهيئة إعلانات onclicka
    initAds();
    
    // أحداث الأزرار
    document.getElementById('spinBtn').addEventListener('click', spinWheel);
    document.getElementById('watchAdForSpins').addEventListener('click', watchAdForSpins);
    document.getElementById('checkinBtn').addEventListener('click', dailyCheckin);
    document.getElementById('inviteFriendBtn').addEventListener('click', inviteFriend);
    document.getElementById('withdrawBtn').addEventListener('click', openWithdrawModal);
    
    // إغلاق النافذة المنبثقة
    document.querySelector('.close').addEventListener('click', function() {
        document.getElementById('withdrawModal').style.display = 'none';
    });
    
    // اختيار طريقة الدفع
    document.querySelectorAll('.payment-method').forEach(method => {
        method.addEventListener('click', function() {
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            this.classList.add('selected');
            document.getElementById('withdrawForm').style.display = 'block';
            document.getElementById('withdrawForm').dataset.method = this.dataset.method;
        });
    });
    
    // تقديم طلب السحب
    document.getElementById('withdrawForm').addEventListener('submit', function(e) {
        e.preventDefault();
        submitWithdrawal();
    });
    
    // تحديث المؤقتات كل ثانية
    setInterval(updateTimers, 1000);
});

// رسم عجلة الحظ
function drawWheel() {
    const anglePerSegment = (Math.PI * 2) / segments.length;
    
    for (let i = 0; i < segments.length; i++) {
        const startAngle = i * anglePerSegment + currentAngle;
        const endAngle = startAngle + anglePerSegment;
        
        ctx.beginPath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.moveTo(150, 150);
        ctx.arc(150, 150, 140, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
        
        // رسم النص
        ctx.save();
        ctx.translate(150, 150);
        ctx.rotate(startAngle + anglePerSegment / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(segments[i], 90, 10);
        ctx.restore();
    }
    
    // رسم السهم
    ctx.beginPath();
    ctx.fillStyle = '#333';
    ctx.moveTo(140, 20);
    ctx.lineTo(160, 20);
    ctx.lineTo(150, 40);
    ctx.closePath();
    ctx.fill();
}

// دورة العجلة
function spinWheel() {
    if (spinning || userData.spins <= 0) return;
    
    userData.spins--;
    updateUI();
    
    spinning = true;
    document.getElementById('spinBtn').disabled = true;
    
    const spinAngle = 30 + Math.random() * 20;
    const targetAngle = currentAngle + spinAngle * Math.PI * 2;
    const duration = 3000;
    const startTime = Date.now();
    const startAngle = currentAngle;
    
    function animate() {
        const now = Date.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function for smooth stop
        const easeOut = 1 - Math.pow(1 - progress, 3);
        currentAngle = startAngle + (targetAngle - startAngle) * easeOut;
        
        drawWheel();
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            spinning = false;
            document.getElementById('spinBtn').disabled = userData.spins <= 0;
            
            // تحديد الجائزة
            const segmentIndex = Math.floor(((currentAngle % (Math.PI * 2)) / (Math.PI * 2)) * segments.length) % segments.length;
            const prize = segments[segmentIndex];
            
            userData.points += prize;
            userData.walletBalance += prize;
            
            alert(`🎉 مبروك! ربحت ${prize} نقطة!`);
            updateUI();
            saveUserData();
        }
    }
    
    requestAnimationFrame(animate);
}

// تهيئة الإعلانات
function initAds() {
    // تهيئة محرك الإعلانات لكل سبوت
    const spotIds = ['6113782', '6113667', '6113781'];
    
    spotIds.forEach(spotId => {
        window.initCdTma?.({ id: spotId }).then(show => {
            window[`showAd_${spotId}`] = show;
        }).catch(e => console.log(`خطأ في تهيئة الإعلان ${spotId}:`, e));
    });
}

// تشغيل الإعلان
function playAd(spotId) {
    if (adTimers[spotId] > 0) {
        alert(`الرجاء الانتظار ${adTimers[spotId]} ثانية قبل مشاهدة إعلان آخر`);
        return;
    }
    
    const showFunc = window[`showAd_${spotId}`];
    if (!showFunc) {
        alert('جاري تهيئة الإعلان، الرجاء المحاولة مرة أخرى');
        return;
    }
    
    showFunc().then(() => {
        console.log(`تم تشغيل الإعلان ${spotId}`);
        
        // بدء المؤقت
        adTimers[spotId] = 20;
        
        // تحديث حالة الزر
        const adButton = document.querySelector(`[data-spot-id="${spotId}"] .btn-ad`);
        if (adButton) {
            adButton.disabled = true;
        }
        
        // منح المستخدم نقطة واحدة
        userData.points += 1;
        updateUI();
        saveUserData();
        
    }).catch(e => {
        console.log('خطأ في تشغيل الإعلان:', e);
        alert('حدث خطأ في تشغيل الإعلان');
    });
}

// مشاهدة إعلان للحصول على لفتين
function watchAdForSpins() {
    // استخدام أول سبوت متاح
    playAd('6113782').then(() => {
        if (!adTimers['6113782']) { // إذا تم تشغيل الإعلان بنجاح
            userData.spins += 2;
            updateUI();
            saveUserData();
        }
    });
}

// تحديث المؤقتات
function updateTimers() {
    let updated = false;
    
    for (let spotId in adTimers) {
        if (adTimers[spotId] > 0) {
            adTimers[spotId]--;
            updated = true;
            
            // تحديث واجهة المؤقت
            const cooldownSpan = document.getElementById(`cooldown${spotId.slice(-1)}`);
            if (cooldownSpan) {
                cooldownSpan.textContent = `⏳ ${adTimers[spotId]} ثانية`;
            }
            
            // تفعيل الزر عند انتهاء المؤقت
            if (adTimers[spotId] === 0) {
                const adButton = document.querySelector(`[data-spot-id="${spotId}"] .btn-ad`);
                if (adButton) {
                    adButton.disabled = false;
                }
                if (cooldownSpan) {
                    cooldownSpan.textContent = '';
                }
            }
        }
    }
    
    if (updated) {
        updateUI();
    }
}

// تسجيل الدخول اليومي
function dailyCheckin() {
    const today = new Date().toDateString();
    
    if (userData.lastCheckin === today) {
        alert('لقد قمت بتسجيل الدخول اليوم بالفعل!');
        return;
    }
    
    userData.lastCheckin = today;
    userData.points += 10;
    userData.walletBalance += 10;
    
    alert('✅ تم تسجيل دخولك اليومي! ربحت 10 نقاط');
    updateUI();
    saveUserData();
}

// دعوة صديق
function inviteFriend() {
    const friendUsername = document.getElementById('friendUsername').value.trim();
    
    if (!friendUsername) {
        alert('الرجاء إدخال معرف الصديق');
        return;
    }
    
    // التحقق من أن الصديق ليس نفس المستخدم
    if (friendUsername === userData.username) {
        alert('لا يمكنك دعوة نفسك!');
        return;
    }
    
    // التحقق من عدم تكرار الدعوة
    if (userData.referrals.includes(friendUsername)) {
        alert('لقد قمت بدعوة هذا الصديق من قبل');
        return;
    }
    
    // إرسال الدعوة إلى الخادم
    fetch('/api/invite', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: userData.username,
            friendUsername: friendUsername
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ تم إرسال الدعوة بنجاح! عند إنجاز الصديق للمهمة ستحصل على 30 نقطة');
            document.getElementById('friendUsername').value = '';
        } else {
            alert(data.message || 'حدث خطأ في إرسال الدعوة');
        }
    })
    .catch(error => {
        console.error('خطأ:', error);
        alert('حدث خطأ في الاتصال بالخادم');
    });
}

// فتح نافذة السحب
function openWithdrawModal() {
    if (userData.walletBalance < 100) {
        alert('الحد الأدنى للسحب هو 100 نقطة');
        return;
    }
    
    document.getElementById('withdrawModal').style.display = 'block';
}

// تقديم طلب السحب
function submitWithdrawal() {
    const method = document.getElementById('withdrawForm').dataset.method;
    const accountDetails = document.getElementById('accountDetails').value;
    const amount = parseInt(document.getElementById('withdrawAmount').value);
    
    if (!method) {
        alert('الرجاء اختيار طريقة الدفع');
        return;
    }
    
    if (!accountDetails) {
        alert('الرجاء إدخال بيانات الحساب');
        return;
    }
    
    if (amount < 100 || amount > userData.walletBalance) {
        alert('المبلغ غير صحيح');
        return;
    }
    
    const withdrawal = {
        method: method,
        accountDetails: accountDetails,
        amount: amount,
        date: new Date().toISOString(),
        status: 'pending'
    };
    
    // إرسال طلب السحب إلى الخادم
    fetch('/api/withdraw', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: userData.username,
            withdrawal: withdrawal
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ تم تقديم طلب السحب بنجاح! جاري الانتظار للموافقة');
            userData.walletBalance -= amount;
            userData.pendingWithdrawals.push(withdrawal);
            
            document.getElementById('withdrawModal').style.display = 'none';
            document.getElementById('withdrawForm').reset();
            document.getElementById('withdrawForm').style.display = 'none';
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            
            updateUI();
            saveUserData();
        } else {
            alert(data.message || 'حدث خطأ في تقديم الطلب');
        }
    })
    .catch(error => {
        console.error('خطأ:', error);
        alert('حدث خطأ في الاتصال بالخادم');
    });
}

// تحديث واجهة المستخدم
function updateUI() {
    document.getElementById('userPoints').textContent = userData.points;
    document.getElementById('availableSpins').textContent = userData.spins;
    document.getElementById('walletBalance').textContent = userData.walletBalance;
    document.getElementById('referralCount').textContent = userData.referrals.length;
    
    // حساب النقاط من الدعوات
    const referralPoints = userData.referrals.length * 30;
    document.getElementById('referralPoints').textContent = referralPoints;
    
    // تحديث حالة زر اللف
    document.getElementById('spinBtn').disabled = userData.spins <= 0 || spinning;
}

// حفظ بيانات المستخدم
function saveUserData() {
    fetch('/api/save-user', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: userData.username,
            data: userData
        })
    })
    .catch(error => console.error('خطأ في حفظ البيانات:', error));
}

// تحميل بيانات المستخدم
function loadUserData() {
    fetch(`/api/user/${userData.username}`)
    .then(response => response.json())
    .then(data => {
        if (data) {
            userData = {...userData, ...data};
            updateUI();
        }
    })
    .catch(error => console.error('خطأ في تحميل البيانات:', error));
}
