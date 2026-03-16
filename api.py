from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # عشان يسمح للموقع يتصل بالـ API

# المسار لقاعدة بيانات البوت (هتحتاج تعدل المسار ده حسب مكان المشروع)
# في Railway، المسار هيكون /app/profit_bot.db لو مستودع profit-bot في نفس المشروع
DB_PATH = '/app/profit_bot.db'  # أو '../profit_bot.db' لو في مجلد منفصل

@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """جلب بيانات المستخدم للموقع"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # جلب بيانات المستخدم
        c.execute("SELECT points, total_earned, is_banned FROM users WHERE user_id=?", (user_id,))
        user = c.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # جلب إعلانات اليوم
        today = datetime.now().strftime('%Y-%m-%d')
        c.execute("SELECT ad_count FROM ads WHERE user_id=? AND ad_date=?", (user_id, today))
        ads = c.fetchone()
        
        conn.close()
        
        return jsonify({
            'success': True,
            'points': user[0],
            'total_earned': user[1],
            'ads_today': ads[0] if ads else 0,
            'max_ads': 400,
            'is_banned': user[2] == 1
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/add_points', methods=['POST'])
def add_points():
    """إضافة نقاط للمستخدم (بعد مشاهدة إعلان مثلاً)"""
    try:
        data = request.json
        user_id = data.get('user_id')
        points = data.get('points', 1)
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # التحقق من أن المستخدم غير محظور
        c.execute("SELECT is_banned FROM users WHERE user_id=?", (user_id,))
        result = c.fetchone()
        if result and result[0] == 1:
            conn.close()
            return jsonify({'success': False, 'error': 'User is banned'}), 403
        
        # إضافة النقاط
        c.execute("UPDATE users SET points = points + ?, total_earned = total_earned + ? WHERE user_id=?", 
                  (points, points, user_id))
        
        # تسجيل إعلان اليوم
        today = datetime.now().strftime('%Y-%m-%d')
        c.execute("SELECT ad_count FROM ads WHERE user_id=? AND ad_date=?", (user_id, today))
        result = c.fetchone()
        
        if not result:
            c.execute("INSERT INTO ads (user_id, ad_date, ad_count) VALUES (?, ?, ?)", (user_id, today, 1))
        else:
            c.execute("UPDATE ads SET ad_count = ad_count + 1 WHERE user_id=? AND ad_date=?", (user_id, today))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/daily_checkin', methods=['POST'])
def daily_checkin():
    """تسجيل دخول يومي"""
    try:
        data = request.json
        user_id = data.get('user_id')
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # التحقق من أن المستخدم غير محظور
        c.execute("SELECT is_banned FROM users WHERE user_id=?", (user_id,))
        result = c.fetchone()
        if result and result[0] == 1:
            conn.close()
            return jsonify({'success': False, 'error': 'User is banned'}), 403
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # التحقق من التسجيل اليوم
        c.execute("SELECT * FROM daily_checkin WHERE user_id=? AND check_date=?", (user_id, today))
        if c.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Already checked in today'}), 400
        
        # جلب آخر تسجيل لحساب السلسلة
        c.execute("SELECT streak FROM daily_checkin WHERE user_id=? ORDER BY check_date DESC LIMIT 1", (user_id,))
        last = c.fetchone()
        
        if last:
            streak = last[0] + 1
        else:
            streak = 1
        
        # تسجيل الدخول
        c.execute("INSERT INTO daily_checkin (user_id, check_date, streak) VALUES (?, ?, ?)", 
                  (user_id, today, streak))
        
        # إضافة 3 نقاط (بدل 5 زي ما طلبت)
        c.execute("UPDATE users SET points = points + 3, total_earned = total_earned + 3 WHERE user_id=?", (user_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'streak': streak})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/referral', methods=['POST'])
def process_referral():
    """معالجة الدعوات (لما صديق يسجل)"""
    try:
        data = request.json
        referrer_id = data.get('referrer_id')
        new_user_id = data.get('new_user_id')
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # التحقق من أن الدعوة جديدة
        c.execute("SELECT * FROM referrals WHERE referred_id=?", (new_user_id,))
        if c.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Already referred'}), 400
        
        # تسجيل الدعوة
        c.execute("INSERT INTO referrals (referrer_id, referred_id, referred_date) VALUES (?, ?, ?)",
                  (referrer_id, new_user_id, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
        
        # إضافة نقاط للداعي
        c.execute("UPDATE users SET points = points + 80, total_referrals = total_referrals + 1, referral_earned = referral_earned + 80 WHERE user_id=?", (referrer_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
