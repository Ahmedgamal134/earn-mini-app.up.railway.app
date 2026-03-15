from flask import Flask, jsonify, request, send_from_directory
import sqlite3
from datetime import datetime
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)

DB_PATH = 'profit_bot.db'
BOT_TOKEN = os.environ.get('BOT_TOKEN')
ADMIN_IDS = [1103784347]  # ⚠️ غير هذا الرقم بمعرفك

# =========== دوال الإشعارات للمشرفين ===========
def send_telegram_notification(user_id, action, details):
    """إرسال إشعار فوري للمشرف عن أي نشاط في الموقع"""
    try:
        # جلب معلومات المستخدم
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT first_name, points FROM users WHERE user_id=?", (user_id,))
        user = c.fetchone()
        conn.close()
        
        if not user:
            return
        
        name, points = user
        
        # أيقونة حسب نوع النشاط
        icons = {
            'watch_ad': '📺',
            'daily_checkin': '✅',
            'wheel_spin': '🎡',
            'withdraw_request': '💳'
        }
        icon = icons.get(action, '🔔')
        
        # تجهيز الرسالة
        message = f"{icon} **نشاط جديد في الموقع**\n\n"
        message += f"👤 **المستخدم:** {name}\n"
        message += f"🆔 **المعرف:** `{user_id}`\n"
        message += f"⚡ **الإجراء:** {action}\n"
        message += f"📝 **التفاصيل:** {details}\n"
        message += f"💰 **الرصيد:** {points}\n"
        message += f"🕐 **الوقت:** {datetime.now().strftime('%H:%M:%S')}"
        
        # إرسال لكل مشرف
        for admin_id in ADMIN_IDS:
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
            data = {
                'chat_id': admin_id,
                'text': message,
                'parse_mode': 'Markdown'
            }
            requests.post(url, json=data)
    except Exception as e:
        print(f"خطأ في إرسال الإشعار: {e}")

# =========== المسارات الرئيسية ===========
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

# =========== API المستخدم ===========
@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user_data(user_id):
    """جلب بيانات المستخدم"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        c.execute("SELECT points, total_earned FROM users WHERE user_id=?", (user_id,))
        user = c.fetchone()
        
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        today = datetime.now().strftime('%Y-%m-%d')
        c.execute("SELECT ad_count FROM ads WHERE user_id=? AND ad_date=?", (user_id, today))
        ads = c.fetchone()
        
        c.execute("SELECT streak FROM daily_checkin WHERE user_id=? ORDER BY check_date DESC LIMIT 1", (user_id,))
        streak = c.fetchone()
        
        c.execute("SELECT total_referrals, referral_earned FROM users WHERE user_id=?", (user_id,))
        ref = c.fetchone()
        
        conn.close()
        
        return jsonify({
            'success': True,
            'points': user[0],
            'total_earned': user[1],
            'ads_today': ads[0] if ads else 0,
            'max_ads': 400,
            'streak': streak[0] if streak else 0,
            'referrals': ref[0] if ref else 0,
            'referral_earned': ref[1] if ref else 0
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== API مشاهدة الإعلان ===========
@app.route('/api/watch_ad/<int:user_id>', methods=['POST'])
def watch_ad(user_id):
    """تسجيل مشاهدة إعلان"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # التحقق من حد الإعلانات
        c.execute("SELECT ad_count FROM ads WHERE user_id=? AND ad_date=?", (user_id, today))
        result = c.fetchone()
        
        if result and result[0] >= 400:
            conn.close()
            return jsonify({'success': False, 'error': 'Daily limit reached'}), 400
        
        # تسجيل المشاهدة
        if not result:
            c.execute("INSERT INTO ads (user_id, ad_date, ad_count) VALUES (?, ?, ?)", (user_id, today, 1))
        else:
            c.execute("UPDATE ads SET ad_count = ad_count + 1 WHERE user_id=? AND ad_date=?", (user_id, today))
        
        # إضافة نقطة
        c.execute("UPDATE users SET points = points + 1, total_earned = total_earned + 1 WHERE user_id=?", (user_id,))
        
        # جلب البيانات الجديدة
        c.execute("SELECT points FROM users WHERE user_id=?", (user_id,))
        new_points = c.fetchone()[0]
        
        c.execute("SELECT ad_count FROM ads WHERE user_id=? AND ad_date=?", (user_id, today))
        new_ads = c.fetchone()[0]
        
        conn.commit()
        conn.close()
        
        # إرسال إشعار للمشرف
        send_telegram_notification(user_id, 'watch_ad', f'شاهد إعلان - إجمالي اليوم: {new_ads}')
        
        return jsonify({
            'success': True,
            'new_points': new_points,
            'new_ads_today': new_ads,
            'max_ads': 400
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== API التسجيل اليومي ===========
@app.route('/api/daily_checkin/<int:user_id>', methods=['POST'])
def daily_checkin(user_id):
    """تسجيل دخول يومي"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # التحقق من التسجيل اليوم
        c.execute("SELECT * FROM daily_checkin WHERE user_id=? AND check_date=?", (user_id, today))
        if c.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Already checked in'}), 400
        
        # جلب آخر تسجيل
        c.execute("SELECT streak FROM daily_checkin WHERE user_id=? ORDER BY check_date DESC LIMIT 1", (user_id,))
        last = c.fetchone()
        
        streak = (last[0] + 1) if last else 1
        
        # تسجيل الدخول
        c.execute("INSERT INTO daily_checkin (user_id, check_date, streak) VALUES (?, ?, ?)", (user_id, today, streak))
        
        # إضافة 5 نقاط
        c.execute("UPDATE users SET points = points + 5, total_earned = total_earned + 5 WHERE user_id=?", (user_id,))
        
        # مكافآت السلسلة
        bonus = 0
        if streak == 7:
            bonus = 20
            c.execute("UPDATE users SET points = points + ?, total_earned = total_earned + ? WHERE user_id=?", (bonus, bonus, user_id))
        elif streak == 30:
            bonus = 100
            c.execute("UPDATE users SET points = points + ?, total_earned = total_earned + ? WHERE user_id=?", (bonus, bonus, user_id))
        
        # جلب النقاط الجديدة
        c.execute("SELECT points FROM users WHERE user_id=?", (user_id,))
        new_points = c.fetchone()[0]
        
        conn.commit()
        conn.close()
        
        # إرسال إشعار للمشرف
        send_telegram_notification(user_id, 'daily_checkin', f'سلسلة: {streak} أيام - مكافأة: {bonus if bonus else 5}')
        
        return jsonify({
            'success': True,
            'new_points': new_points,
            'streak': streak,
            'bonus': bonus
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== API عجلة الحظ ===========
@app.route('/api/wheel_spin/<int:user_id>', methods=['POST'])
def wheel_spin(user_id):
    """تسجيل دوران عجلة الحظ"""
    try:
        data = request.json
        prize = data.get('prize', 0)
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        c.execute("UPDATE users SET points = points + ? WHERE user_id=?", (prize, user_id))
        c.execute("SELECT points FROM users WHERE user_id=?", (user_id,))
        new_points = c.fetchone()[0]
        
        conn.commit()
        conn.close()
        
        # إرسال إشعار للمشرف
        send_telegram_notification(user_id, 'wheel_spin', f'ربح {prize} نقطة')
        
        return jsonify({
            'success': True,
            'new_points': new_points
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== API طلب السحب ===========
@app.route('/api/withdraw_request', methods=['POST'])
def withdraw_request():
    """طلب سحب جديد"""
    try:
        data = request.json
        user_id = data.get('user_id')
        amount = data.get('amount')
        wallet_type = data.get('wallet_type')
        wallet_number = data.get('wallet_number')
        transaction_id = data.get('transaction_id')
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # تسجيل طلب السحب
        c.execute('''INSERT INTO withdrawals 
                     (user_id, amount, wallet_type, wallet_number, transaction_id, request_date) 
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (user_id, amount, wallet_type, wallet_number, transaction_id, 
                   datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
        
        # خصم النقاط
        c.execute("UPDATE users SET points = 0 WHERE user_id=?", (user_id,))
        
        conn.commit()
        conn.close()
        
        # إرسال إشعار للمشرف
        send_telegram_notification(user_id, 'withdraw_request', 
                                   f'طلب سحب {amount} جنيه - {wallet_type} - {wallet_number}')
        
        return jsonify({'success': True, 'transaction_id': transaction_id})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =========== API استقبال الإشعارات من الموقع ===========
@app.route('/api/notify', methods=['POST'])
def receive_notification():
    """استقبال إشعارات من الموقع"""
    try:
        data = request.json
        action = data.get('action')
        user_id = data.get('user_id')
        details = data.get('details', '')
        
        send_telegram_notification(user_id, action, details)
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
