from flask import Flask, jsonify, request, send_from_directory
import sqlite3
from datetime import datetime
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

DB_PATH = 'profit_bot.db'

@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/admin.html')
def serve_admin():
    return send_from_directory('.', 'admin.html')

@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user_data(user_id):
    # نسخة مبسطة للتجربة
    return jsonify({
        'success': True,
        'points': 1000,
        'total_earned': 1500,
        'ads_today': 10,
        'max_ads': 400,
        'streak': 5
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
