/**
 * การตั้งค่าฐานข้อมูลกลาง (Google Sheets & Firebase)
 * -------------------------------------------------------------
 * 1. แนะนำ: ใช้งาน Google Sheets (ง่ายที่สุด ดูข้อมูลเป็นตารางได้ทันที)
 *    ใส่ Web App URL ของ Google Apps Script ที่ได้จากคู่มือ GOOGLE_SHEETS_SETUP_GUIDE.md
 * 
 * 2. หรือใช้งาน Firebase (ถ้าต้องการ Realtime แบบเดิม)
 */

// 📊 1. ตัวเลือก Google Sheets (แนะนำ)
window.GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbwKlyJiPMG3_iyk0ne_ZeJav9lsNyrhM19SaHxRmFQ4lj4Lg6TMjctJOuWWi50UB-9A/exec";

// 🔥 2. ตัวเลือก Firebase
window.DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  databaseURL: "", // ตัวอย่าง: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app"
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
