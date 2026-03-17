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

// إعدادات السحب
const withdrawalSettings = {
    minPoints: 200,
    maxPoints: 8000,
    exchangeRate: 20,
    methods: {
        'orange': 'اورانج كاش',
        'vodafone': 'فودافون كاش', 
        'etisalat': 'اتصالات كاش',
        'paypal': 'PayPal'
    }
};

// تهيئة عجلة الحظ (من 0 إلى 50)
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const segments = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]; // بالظبط زي ما طلبت
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB', '#E67E22', '#2ECC71', '#F1C40F'];
let spinning = false;
let currentAngle = 0;
let spinResult = null; // لتخزين نتيجة اللفة
let spinEndTime = null; // وقت انتهاء اللفة

// مؤقتات الإعلانات
let adTimers = {
    '6113782': 0,
    '6113667': 0,
    '6113781': 0
};

// مؤقت إعلان النقاط
let pointsAdTimer = 0;

// متغيرات لتأخير إضافة النقاط
let pendingAdPoints = null; // للإعلانات العادية
let pendingPointsAd = null; // لإعلان النقاط
let pendingSpinPoints = null; // للعجلة

// تهيئة التطبيق
document.addEventListener('DOMContentLoaded', function() {
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        userData.username = tg.initDataUnsafe.user?.username || 'مستخدم';
        document.getElementById('username').textContent = userData.username;
        loadUserData();
    }
    
    drawWheel();
    initAds();
    
    // أحداث الأزرار
    document.getElementById('spinBtn').addEventListener('click', spinWheel);
    document.getElementById('watchAdForSpins').addEventListener('click', watchAdForPoints);
    document.getElementById('checkinBtn').addEventListener('click', dailyCheckin);
    document.getElementById('inviteFriendBtn').addEventListener('click', inviteFriend);
    document.getElementById('withdrawBtn').addEventListener('click', openWithdrawModal);
    
    document.querySelector('.close').addEventListener('click', function() {
        document.getElementById('withdrawModal').style.display = 'none';
    });
    
    document.querySelectorAll('.payment-method').forEach(method => {
        method.addEventListener('click', function() {
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            this.classList.add('selected');
            document.getElementById('withdrawForm').style.display = 'block';
            document.getElementById('withdrawForm').dataset.method = this.dataset.method;
            
            const amountInput = document.getElementById('withdrawAmount');
            amountInput.min = withdrawalSettings.minPoints;
            amountInput.max = Math.min(withdrawalSettings.maxPoints, userData.walletBalance);
            amountInput.placeholder = `من ${withdrawalSettings.minPoints} إلى ${amountInput.max} نقطة`;
        });
    });
    
    document.getElementById('withdrawForm').addEventListener('submit', function(e) {
        e.preventDefault();
        submitWithdrawal();
    });
    
    // تحديث المؤقتات كل ثانية
    setInterval(updateTimers, 1000);
    setInterval(checkPendingPoints, 100); // كل 100 ميللي ثانية نتحقق من النقاط المعلقة
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
    if (spinning) return;
    
    if (userData.points < 5) {
        alert('⚠️ مش معاك 5 نقاط! شاهد إعلان عشان تاخد نقطتين');
        return;
    }
    
    // خصم النقاط فوراً
    userData.points -= 5;
    updateUI();
    
    spinning = true;
    spinResult = null;
    document.getElementById('spinBtn').disabled = true;
    
    // زوايا عشوائية للدوران
    const spinAngle = 30 + Math.random() * 20; // عدد اللفات
    const targetAngle = currentAngle + spinAngle * Math.PI * 2;
    const duration = 3000; // 3 ثواني
    const startTime = Date.now();
    const startAngle = currentAngle;
    
    // حساب النتيجة بناءً على الزاوية النهائية
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
            // انتهى الدوران - نحسب الجائزة بدقة
            spinning = false;
            
            // حساب القطعة التي وقف عندها السهم (السهم في الزاوية 270 درجة أو -90 درجة)
            const arrowAngle = (Math.PI * 3) / 2; // 270 degrees
            const wheelAngle = currentAngle % (Math.PI * 2);
            let segmentAngle = (arrowAngle - wheelAngle + Math.PI * 2) % (Math.PI * 2);
            const anglePerSegment = (Math.PI * 2) / segments.length;
            let segmentIndex = Math.floor(segmentAngle / anglePerSegment);
            
            // التأكد من أن المؤشر داخل النطاق الصحيح
            if (segmentIndex >= segments.length) segmentIndex = 0;
            
            const prize = segments[segmentIndex];
            
            // تخزين النتيجة وإضافتها بعد 3 ثواني (وقت الدوران)
            spinResult = prize;
            spinEndTime = Date.now() + 3000; // هنضيفها بعد 3 ثواني من الآن
            
            // تحديث واجهة المستخدم
            document.getElementById('spinBtn').disabled = userData.points < 5;
            
            alert(`🎉 العجلة وقفت على ${prize} نقطة! هتضاف لحسابك بعد 3 ثواني`);
            
            saveUserData();
        }
    }
    
    requestAnimationFrame(animate);
}

// التحقق من النقاط المعلقة
function checkPendingPoints() {
    const now = Date.now();
    
    // نقاط العجلة
    if (spinResult !== null && spinEndTime && now >= spinEndTime) {
        userData.points += spinResult;
        userData.walletBalance += spinResult;
        
        alert(`✅ تمت إضافة ${spinResult} نقطة من عجلة الحظ!`);
        
        spinResult = null;
        spinEndTime = null;
        updateUI();
        saveUserData();
    }
    
    // نقاط الإعلانات العادية
    if (pendingAdPoints !== null && pendingAdPoints.endTime && now >= pendingAdPoints.endTime) {
        userData.points += 1; // نقطة واحدة
        userData.walletBalance += 1;
        
        alert(`✅ تمت إضافة نقطة من مشاهدة الإعلان!`);
        
        pendingAdPoints = null;
        updateUI();
        saveUserData();
    }
    
    // نقاط إعلان النقطتين
    if (pendingPointsAd !== null && pendingPointsAd.endTime && now >= pendingPointsAd.endTime) {
        userData.points += 2;
        userData.walletBalance += 2;
        
        alert(`✅ تمت إضافة نقطتين من مشاهدة الإعلان!`);
        
        pendingPointsAd = null;
        updateUI();
        saveUserData();
    }
}

// تهيئة الإعلانات
function initAds() {
    const spotIds = ['6113782', '6113667', '6113781'];
    
    spotIds.forEach(spotId => {
        window.initCdTma?.({ id: spotId }).then(show => {
            window[`showAd_${spotId}`] = show;
            console.log(`✅ إعلان ${spotId} جاهز`);
        }).catch(e => console.log(`خطأ في تهيئة الإعلان ${spotId}:`, e));
    });
}

// تشغيل الإعلان العادي
function playAd(spotId) {
    if (adTimers[spotId] > 0) {
        alert(`⏳ استنى ${adTimers[spotId]} ثانية قبل مشاهدة إعلان تاني`);
        return;
    }
    
    const showFunc = window[`showAd_${spotId}`];
    if (!showFunc) {
        alert('جاري تحضير الإعلان');
        return;
    }
    
    showFunc().then(() => {
        console.log(`✅ تم تشغيل الإعلان ${spotId}`);
        
        // بدء المؤقت (20 ثانية)
        adTimers[spotId] = 20;
        
        // تعطيل الزر
        const adButton = document.querySelector(`[data-spot-id="${spotId}"] .btn-ad`);
        if (adButton) {
            adButton.disabled = true;
        }
        
        // تخزين النقطة لتضاف بعد 20 ثانية
        pendingAdPoints = {
            spotId: spotId,
            endTime: Date.now() + (20 * 1000) // 20 ثانية
        };
        
        alert('✅ تم مشاهدة الإعلان! النقطة هتضاف بعد 20 ثانية');
        
    }).catch(e => {
        console.log('خطأ في تشغيل الإعلان:', e);
        alert('حدث خطأ في تشغيل الإعلان');
    });
}

// مشاهدة إعلان عشان تاخد نقطتين
function watchAdForPoints() {
    if (pointsAdTimer > 0) {
        alert(`⏳ استنى ${pointsAdTimer} ثانية قبل ما تشاهد إعلان تاني`);
        return;
    }
    
    const spotId = '6113782';
    const showFunc = window[`showAd_${spotId}`];
    
    if (!showFunc) {
        alert('الإعلان مش جاهز، حاول تاني');
        return;
    }
    
    showFunc().then(() => {
        console.log('✅ تم تشغيل إعلان النقاط');
        
        // بدء المؤقت (15 ثانية)
        pointsAdTimer = 15;
        document.getElementById('watchAdForSpins').disabled = true;
        
        // تخزين النقطتين لتضاف بعد 15 ثانية
        pendingPointsAd = {
            endTime: Date.now() + (15 * 1000) // 15 ثانية
        };
        
        alert('✅ تم مشاهدة الإعلان! نقطتين هتضاف بعد 15 ثانية');
        
    }).catch(e => {
        console.log('خطأ في تشغيل الإعلان:', e);
        alert('حدث خطأ في تشغيل الإعلان');
    });
}

// تحديث المؤقتات
function updateTimers() {
    for (let spotId in adTimers) {
        if (adTimers[spotId] > 0) {
            adTimers[spotId]--;
            
            const index = Object.keys(adTimers).indexOf(spotId) + 1;
            const cooldownSpan = document.getElementById(`cooldown${index}`);
            if (cooldownSpan) {
                cooldownSpan.textContent = `⏳ ${adTimers[spotId]} ث`;
            }
            
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
    
    if (pointsAdTimer > 0) {
        pointsAdTimer--;
        
        const pointsAdButton = document.getElementById('watchAdForSpins');
        if (pointsAdButton) {
            pointsAdButton.textContent = `⏳ استنى ${pointsAdTimer} ث`;
        }
        
        if (pointsAdTimer === 0) {
            if (pointsAdButton) {
                pointsAdButton.textContent = '📺 شاهد إعلان (نقطتين)';
                pointsAdButton.disabled = false;
            }
        }
    }
}

// تسجيل الدخول اليومي
function dailyCheckin() {
    const today = new Date().toDateString();
    
    if (userData.lastCheckin === today) {
        alert('لقد سجلت دخولك النهاردة!');
        return;
    }
    
    userData.lastCheckin = today;
    userData.points += 10;
    userData.walletBalance += 10;
    
    alert('✅ تمت إضافة 10 نقاط');
    updateUI();
    saveUserData();
}

// دعوة صديق
function inviteFriend() {
    const friendUsername = document.getElementById('friendUsername').value.trim();
    
    if (!friendUsername) {
        alert('اكتب اسم الصديق');
        return;
    }
    
    if (friendUsername === userData.username) {
        alert('مش تنفع تدعو نفسك!');
        return;
    }
    
    if (userData.referrals.includes(friendUsername)) {
        alert('دعيت الصديق ده قبل كده');
        return;
    }
    
    fetch('/api/invite', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            username: userData.username,
            friendUsername: friendUsername
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('✅ تمت الدعوة! لما الصديق ينجز المهمة هتاخد 30 نقطة');
            document.getElementById('friendUsername').value = '';
        } else {
            alert(data.message || 'حصل خطأ');
        }
    })
    .catch(error => {
        console.error('خطأ:', error);
        alert('مشكلة في الاتصال');
    });
}

// فتح نافذة السحب
function openWithdrawModal() {
    if (userData.walletBalance < withdrawalSettings.minPoints) {
        const needed = withdrawalSettings.minPoints - userData.walletBalance;
        alert(`⚠️ مش معاك نقاط كافية!\nالحد الأدنى: ${withdrawalSettings.minPoints} نقطة (${(withdrawalSettings.minPoints / withdrawalSettings.exchangeRate).toFixed(2)} جنيه)\nناقصك: ${needed} نقطة`);
        return;
    }
    
    document.getElementById('withdrawModal').style.display = 'block';
    
    const amountInput = document.getElementById('withdrawAmount');
    amountInput.min = withdrawalSettings.minPoints;
    amountInput.max = Math.min(withdrawalSettings.maxPoints, userData.walletBalance);
    amountInput.placeholder = `من ${withdrawalSettings.minPoints} إلى ${amountInput.max} نقطة`;
}

// تقديم طلب السحب
function submitWithdrawal() {
    const method = document.getElementById('withdrawForm').dataset.method;
    const accountDetails = document.getElementById('accountDetails').value;
    const amount = parseInt(document.getElementById('withdrawAmount').value);
    
    if (!method) {
        alert('اختار طريقة الدفع');
        return;
    }
    
    if (!accountDetails) {
        alert('اكتب بيانات حسابك');
        return;
    }
    
    if (amount < withdrawalSettings.minPoints || amount > withdrawalSettings.maxPoints) {
        alert(`المبلغ يجب أن يكون بين ${withdrawalSettings.minPoints} و ${withdrawalSettings.maxPoints} نقطة`);
        return;
    }
    
    if (amount > userData.walletBalance) {
        alert('المبلغ أكبر من رصيدك');
        return;
    }
    
    const amountEGP = amount / withdrawalSettings.exchangeRate;
    
    const withdrawal = {
        method: method,
        methodName: withdrawalSettings.methods[method],
        accountDetails: accountDetails,
        points: amount,
        amountEGP: amountEGP,
        date: new Date().toISOString(),
        status: 'pending'
    };
    
    fetch('/api/withdraw', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            username: userData.username,
            withdrawal: withdrawal
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`✅ طلب السحب قيد المراجعة\nالمبلغ: ${amountEGP.toFixed(2)} جنيه (${amount} نقطة)`);
            userData.walletBalance -= amount;
            userData.pendingWithdrawals.push(withdrawal);
            
            document.getElementById('withdrawModal').style.display = 'none';
            document.getElementById('withdrawForm').reset();
            document.getElementById('withdrawForm').style.display = 'none';
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            
            updateUI();
            saveUserData();
        } else {
            alert(data.message || 'حصل خطأ');
        }
    })
    .catch(error => {
        console.error('خطأ:', error);
        alert('مشكلة في الاتصال');
    });
}

// تحديث واجهة المستخدم
function updateUI() {
    document.getElementById('userPoints').textContent = userData.points.toLocaleString();
    document.getElementById('availableSpins').textContent = userData.spins;
    document.getElementById('walletBalance').textContent = userData.walletBalance.toLocaleString();
    document.getElementById('referralCount').textContent = userData.referrals.length;
    
    const referralPoints = userData.referrals.length * 30;
    document.getElementById('referralPoints').textContent = referralPoints.toLocaleString();
    
    const spinBtn = document.getElementById('spinBtn');
    spinBtn.textContent = userData.points >= 5 ? '🎡 لف العجلة (5 نقاط)' : '⚠️ مش معاك 5 نقاط';
    spinBtn.disabled = userData.points < 5 || spinning;
}

// حفظ بيانات المستخدم
function saveUserData() {
    fetch('/api/save-user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            username: userData.username,
            data: userData
        })
    }).catch(error => console.error('خطأ في الحفظ:', error));
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
    .catch(error => console.error('خطأ في التحميل:', error));
        }
