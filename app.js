/**
 * TimeTrack Pro - Attendance Management System
 * Supports: Mobile, iPad/Tablet, Desktop
 * Features: Real-time Cloud Sync (Firebase), Camera Capture, GPS Geolocation, LocalStorage Fallback, CSV Export
 */

// --- Default Data & State ---
const DEFAULT_EMPLOYEES = [
  { id: 'EMP-001', name: 'สมชาย สายลุย', dept: 'ฝ่ายพัฒนาธุรกิจ', color: 'bg-sky-600', workStart: '08:30', workEnd: '17:30' },
  { id: 'EMP-002', name: 'กัญญาภัทร ใจมั่น', dept: 'ฝ่ายบุคคล (HR)', color: 'bg-indigo-600', workStart: '08:30', workEnd: '17:30' },
  { id: 'EMP-003', name: 'วิชัย มุ่งมั่น', dept: 'ฝ่ายไอทีและระบบ', color: 'bg-emerald-600', workStart: '08:30', workEnd: '17:30' },
  { id: 'EMP-004', name: 'ปิยะมาศ สดใส', dept: 'ฝ่ายการตลาด', color: 'bg-pink-600', workStart: '08:30', workEnd: '17:30' },
  { id: 'EMP-005', name: 'ณัฐพล คล่องแคล่ว', dept: 'ฝ่ายบริการลูกค้า', color: 'bg-amber-600', workStart: '08:30', workEnd: '17:30' },
  { id: 'EMP-006', name: 'อนันต์ ทรงคุณ', dept: 'ฝ่ายบัญชีและการเงิน', color: 'bg-teal-600', workStart: '08:30', workEnd: '17:30' }
];

const DEFAULT_SETTINGS = {
  startTime: '08:30',
  endTime: '17:30',
  graceMinutes: 0
};

// Storage Keys
const STORAGE_EMP_KEY = 'timetrack_employees_v2';
const STORAGE_ATT_KEY = 'timetrack_attendance_v2';
const STORAGE_SET_KEY = 'timetrack_settings_v2';
const STORAGE_CLOUD_KEY = 'timetrack_cloud_config_v1';
const STORAGE_GSHEET_KEY = 'timetrack_gsheet_url_v1';
const STORAGE_USERS_KEY = 'timetrack_users_v2';
const STORAGE_SESSION_KEY = 'timetrack_session_v2';

let state = {
  employees: [],
  attendances: [],
  settings: { ...DEFAULT_SETTINGS },
  users: [],
  currentUser: null, // { id, username, role: 'admin'|'user', name, empId, dept, password }
  selectedEmpId: ''
};

// Database Backend State
let activeBackend = 'local'; // 'gsheet' | 'firebase' | 'local'
let gsheetPollTimer = null;
let firebaseApp = null;
let firebaseDb = null;
let isCloudConnected = false;

// Camera & GPS State
let cameraStream = null;
let currentFacingMode = 'user';
let currentCapturedPhoto = null;
let currentGPS = null;

// Chart instances
let todayChartInstance = null;
let weeklyChartInstance = null;

// Map instances (Leaflet - Admin Attendance Map)
let attendanceMapInstance = null;
let attendanceMapMarkers = [];
let isAttendanceMapCollapsed = false;

// Standard Corporate Branch Locations & Coordinates (Bangkok & Greater Vicinity)
const BRANCH_LOCATIONS = {
  RANGSIT: { name: 'รังสิต', lat: '13.9890', lng: '100.6177', desc: 'สาขารังสิต (ปทุมธานี)' },
  SAINOI: { name: 'ไทรน้อย', lat: '13.9715', lng: '100.3261', desc: 'สาขาไทรน้อย (นนทบุรี)' },
  CHARAN: { name: 'จรัญสนิทวงศ์', lat: '13.7650', lng: '100.4850', desc: 'สาขาจรัญสนิทวงศ์' },
  RAMA2: { name: 'พระราม 2 (DOPA)', lat: '13.6644', lng: '100.4421', desc: 'สาขาพระราม 2 (DOPA)' },
  LAMLUKKA: { name: 'ลำลูกกา/ปักษีเลิศ', lat: '13.9736', lng: '100.6582', desc: 'สาขาลำลูกกา / ปักษีเลิศ' },
  HQ: { name: 'สำนักงานใหญ่', lat: '13.7563', lng: '100.5018', desc: 'สำนักงานใหญ่ (พระนคร)' }
};

function detectBranchGPS(target = '') {
  let str = '';
  if (typeof target === 'string') {
    str = target;
  } else if (target && typeof target === 'object') {
    str = `${target.id || target.empId || ''} ${target.name || target.empName || ''} ${target.dept || ''} ${target.location || ''}`;
  }
  str = str.toLowerCase();

  if (str.includes('พระราม') || str.includes('dopa') || str.includes('b001')) {
    return BRANCH_LOCATIONS.RAMA2;
  }
  if (str.includes('รังสิต') || str.includes('rangsit')) {
    return BRANCH_LOCATIONS.RANGSIT;
  }
  if (str.includes('ไทรน้อย') || str.includes('sainoi') || str.includes('b11')) {
    return BRANCH_LOCATIONS.SAINOI;
  }
  if (str.includes('จรัญ') || str.includes('charan') || str.includes('r001')) {
    return BRANCH_LOCATIONS.CHARAN;
  }
  if (str.includes('ปักษี') || str.includes('ลำลูกกา') || str.includes('p11')) {
    return BRANCH_LOCATIONS.LAMLUKKA;
  }
  return null;
}

// --- Helper Functions ---
function getTodayDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  const mIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (mIso) {
    return `${mIso[1]}-${String(mIso[2]).padStart(2, '0')}-${String(mIso[3]).padStart(2, '0')}`;
  }
  const mThai = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (mThai) {
    let year = parseInt(mThai[3], 10);
    if (year > 2500) year -= 543;
    return `${year}-${String(mThai[2]).padStart(2, '0')}-${String(mThai[1]).padStart(2, '0')}`;
  }
  return s.substring(0, 10);
}

function cleanEmployeeId(id) {
  return String(id || '')
    .replace(/^['*^\s\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E]+/, '')
    .trim()
    .toLowerCase();
}

function isSameEmpId(id1, id2) {
  if (id1 === undefined || id2 === undefined || id1 === null || id2 === null) return false;
  return cleanEmployeeId(id1) === cleanEmployeeId(id2);
}

function isSameDate(d1, d2) {
  if (!d1 || !d2) return false;
  return normalizeDateStr(d1) === normalizeDateStr(d2);
}

/**
 * รวมรายการบันทึกเวลาเข้า-ออกงานของพนักงานคนเดียวกันในวันเดียวกันให้มาอยู่ในบรรทัดเดียวกัน
 */
function mergeSplitAttendances(records) {
  if (!Array.isArray(records)) return [];
  const mergedMap = new Map();

  records.forEach(item => {
    if (!item) return;
    const empKey = cleanEmployeeId(item.empId);
    const dateKey = normalizeDateStr(item.date);
    const key = `${empKey}_${dateKey}`;

    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...item, date: dateKey });
    } else {
      const existing = mergedMap.get(key);

      // Merge checkIn and checkOut into the same single row
      if (!existing.checkIn && item.checkIn) {
        existing.checkIn = item.checkIn;
        if (item.checkInGPS) existing.checkInGPS = item.checkInGPS;
      }
      if (!existing.checkOut && item.checkOut) {
        existing.checkOut = item.checkOut;
        if (item.checkOutGPS) existing.checkOutGPS = item.checkOutGPS;
      }
      if (item.gps && !existing.gps) existing.gps = item.gps;
      if (item.photo && !existing.photo) existing.photo = item.photo;
      if (!existing.location && item.location) existing.location = item.location;

      // Clean up note
      if (existing.checkIn && existing.note && existing.note.includes('ไม่ได้ตอกเข้า')) {
        existing.note = existing.note.replace(' (ไม่ได้ตอกเข้า)', '').replace('ไม่ได้ตอกเข้า', '').trim();
      }
      if (item.note && !existing.note) {
        existing.note = item.note;
      }
    }
  });

  return Array.from(mergedMap.values());
}

function formatThaiDate(dateObj) {
  const thaiDays = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const dayName = thaiDays[dateObj.getDay()];
  const day = dateObj.getDate();
  const month = thaiMonths[dateObj.getMonth()];
  const year = dateObj.getFullYear() + 543;
  return `${dayName}ที่ ${day} ${month} ${year}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[0], 10) + 543;
  const shortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${shortMonths[m]} ${y}`;
}

function generateSampleAvatar(name, bg = '#0284c7') {
  const initials = (name || 'พ').slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="${bg}"/>
    <circle cx="100" cy="80" r="45" fill="#ffffff" opacity="0.9"/>
    <path d="M 30 180 Q 100 120 170 180" fill="#ffffff" opacity="0.9"/>
    <text x="50%" y="88%" font-family="Prompt, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Sound Synthesizer via Web Audio API
function playSound(type = 'success') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (type === 'success') {
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playTone(587.33, 0, 0.12);
      playTone(880, 0.12, 0.25);
    } else if (type === 'shutter') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'warning') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    console.log('Audio disabled or not supported');
  }
}

// Toast Notifications
function showToast(title, message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastInner = document.getElementById('toast-inner');
  const toastIcon = document.getElementById('toast-icon');
  const toastTitle = document.getElementById('toast-title');
  const toastMsg = document.getElementById('toast-message');

  if (!toast) return;

  toastTitle.textContent = title;
  toastMsg.textContent = message;

  if (type === 'success') {
    toastInner.className = 'p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-medium bg-emerald-50 border-emerald-200 text-emerald-950';
    toastIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-emerald-500 text-white';
    toastIcon.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i>`;
  } else if (type === 'warning') {
    toastInner.className = 'p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-medium bg-amber-50 border-amber-200 text-amber-950';
    toastIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-amber-500 text-white';
    toastIcon.innerHTML = `<i data-lucide="alert-triangle" class="w-4 h-4"></i>`;
  } else {
    toastInner.className = 'p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-medium bg-rose-50 border-rose-200 text-rose-950';
    toastIcon.className = 'w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-rose-500 text-white';
    toastIcon.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i>`;
  }

  lucide.createIcons();

  toast.classList.remove('translate-y-[-150%]', 'opacity-0', 'pointer-events-none');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.add('translate-y-[-150%]', 'opacity-0', 'pointer-events-none');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3500);
}

// Generate Realistic Seed Attendance Data if empty
function generateDemoAttendance(employees) {
  const attendances = [];
  const today = new Date();
  const sampleCoordinates = [
    { lat: '13.7563', lng: '100.5018', accuracy: 12 },
    { lat: '13.7469', lng: '100.5349', accuracy: 15 },
    { lat: '13.7214', lng: '100.5283', accuracy: 8 },
    { lat: '13.7801', lng: '100.5489', accuracy: 20 },
    { lat: '13.7198', lng: '100.5843', accuracy: 14 }
  ];

  for (let i = 4; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getTodayDateString(d);
    
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    employees.forEach((emp, index) => {
      if (i > 0 && Math.random() < 0.15) return;

      let hour = 8;
      let minute = 10 + Math.floor(Math.random() * 25);
      if (index === 2 && i % 2 === 0) {
        hour = 8;
        minute = 45;
      }

      const checkInStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:15`;
      const isLate = (hour > 8 || (hour === 8 && minute > 30));
      
      let checkOutStr = null;
      if (i > 0) {
        checkOutStr = `17:${String(30 + Math.floor(Math.random() * 25)).padStart(2, '0')}:00`;
      } else if (index < 3) {
        checkOutStr = null;
      } else {
        return;
      }

      const locations = ['สำนักงานใหญ่', 'สำนักงานใหญ่', 'สำนักงานใหญ่', 'Work from Home', 'นอกสถานที่'];
      const loc = locations[(index + i) % locations.length];
      const coords = sampleCoordinates[(index + i) % sampleCoordinates.length];

      attendances.push({
        id: 'ATT-' + Math.random().toString(36).substr(2, 9),
        empId: emp.id,
        empName: emp.name,
        dept: emp.dept,
        date: dateStr,
        checkIn: checkInStr,
        checkOut: checkOutStr,
        location: loc,
        status: isLate ? 'LATE' : 'ON_TIME',
        photo: generateSampleAvatar(emp.name, index % 2 === 0 ? '#0284c7' : '#4f46e5'),
        gps: coords,
        note: isLate ? 'รถติดชั่วโมงเร่งด่วน' : (loc === 'Work from Home' ? 'ขออนุมัติ WFH' : '')
      });
    });
  }

  return attendances;
}

// --- Data Persistence (Local & Cloud Sync) ---
function loadLocalData() {
  try {
    const empData = localStorage.getItem(STORAGE_EMP_KEY);
    state.employees = empData ? JSON.parse(empData) : [...DEFAULT_EMPLOYEES];

    const setData = localStorage.getItem(STORAGE_SET_KEY);
    state.settings = setData ? { ...DEFAULT_SETTINGS, ...JSON.parse(setData) } : { ...DEFAULT_SETTINGS };

    const attData = localStorage.getItem(STORAGE_ATT_KEY);
    if (attData) {
      state.attendances = JSON.parse(attData);
    } else {
      state.attendances = generateDemoAttendance(state.employees);
      saveLocalData();
    }

    // Ensure Admin (chana.p) is excluded from employee punch records
    state.employees = (state.employees || []).filter(e => {
      const id = String(e.id || '').trim().toLowerCase();
      const name = String(e.name || '').trim().toLowerCase();
      return id !== 'chana.p' && id !== 'admin' && !name.includes('ผู้ดูแลระบบ');
    }).map(e => ({
      ...e,
      workStart: e.workStart || state.settings.startTime || '08:30',
      workEnd: e.workEnd || state.settings.endTime || '17:30'
    }));
    state.attendances = (state.attendances || []).filter(a => {
      const id = String(a.empId || '').trim().toLowerCase();
      return id !== 'chana.p' && id !== 'admin';
    });

    // Auto-correct any demo/existing records of บุ๊ค พระรามสอง with fake Dinso Rd coords (13.7563) to real Rama 2
    state.attendances.forEach(a => {
      const isRama2 = (a.empId === 'B001') || (a.empName && a.empName.includes('พระรามสอง'));
      if (isRama2 && a.gps && a.gps.lat === '13.7563') {
        a.gps = { lat: '13.6644', lng: '100.4421', accuracy: 15 };
        a.checkInGPS = { lat: '13.6644', lng: '100.4421', accuracy: 15 };
        a.checkOutGPS = { lat: '13.6644', lng: '100.4421', accuracy: 15 };
      }
    });
  } catch (e) {
    console.error('Error loading local data:', e);
    state.employees = [...DEFAULT_EMPLOYEES];
    state.attendances = [];
    state.settings = { ...DEFAULT_SETTINGS };
  }
}

function saveLocalData() {
  try {
    localStorage.setItem(STORAGE_EMP_KEY, JSON.stringify(state.employees));
    localStorage.setItem(STORAGE_ATT_KEY, JSON.stringify(state.attendances));
    localStorage.setItem(STORAGE_SET_KEY, JSON.stringify(state.settings));
  } catch (e) {
    console.error('Failed to save local data:', e);
  }
}

// --- User Authentication & Access Control ---

const DEFAULT_ADMIN_USER = {
  id: 'chana.p',
  username: 'chana.p',
  role: 'admin',
  name: 'chana.p (ผู้ดูแลระบบ)',
  password: '11223344'
};

function syncUserAccountsWithEmployees() {
  if (!Array.isArray(state.users)) state.users = [];

  // Remove Admin (chana.p / admin) from state.employees - Admin does NOT record attendance
  state.employees = (state.employees || []).filter(e => {
    const id = String(e.id || '').trim().toLowerCase();
    const name = String(e.name || '').trim().toLowerCase();
    return id !== 'chana.p' && id !== 'admin' && !name.includes('ผู้ดูแลระบบ');
  });

  // Remove any attendance records for admin
  state.attendances = mergeSplitAttendances((state.attendances || []).filter(a => {
    const id = String(a.empId || '').trim().toLowerCase();
    return id !== 'chana.p' && id !== 'admin';
  }));

  // Remove generic 'admin' account so chana.p is the ONLY Admin
  state.users = state.users.filter(u => u.username && u.username.toLowerCase() !== 'admin');

  // 1. Ensure chana.p exists as the sole Admin
  let admin = state.users.find(u => u.username && u.username.toLowerCase() === 'chana.p');
  if (!admin) {
    admin = { ...DEFAULT_ADMIN_USER };
    state.users.unshift(admin);
  } else {
    admin.role = 'admin';
    admin.name = 'chana.p (ผู้ดูแลระบบ)';
    if (!admin.password || admin.password === '1234') {
      admin.password = '11223344';
    }
  }

  // Ensure no other user is admin
  state.users.forEach(u => {
    if (u.username.toLowerCase() !== 'chana.p') {
      u.role = 'user';
    }
  });

  // 2. Ensure each employee has an account
  state.employees.forEach(emp => {
    let existing = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
    if (!existing) {
      state.users.push({
        id: emp.id,
        username: emp.id,
        role: 'user',
        name: emp.name,
        empId: emp.id,
        dept: emp.dept,
        password: '1234'
      });
    } else {
      existing.name = emp.name;
      existing.empId = emp.id;
      existing.dept = emp.dept;
      if (!existing.password) existing.password = '1234';
    }
  });

  saveUsersData();
}

function loadUsersData() {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    if (raw) {
      state.users = JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error loading users data:', e);
    state.users = [];
  }
  syncUserAccountsWithEmployees();
}

function saveUsersData() {
  try {
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(state.users));
  } catch (e) {
    console.error('Failed to save users data:', e);
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_SESSION_KEY) || localStorage.getItem(STORAGE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // If session was old generic 'admin', clear it
      if (parsed.username && parsed.username.toLowerCase() === 'admin') {
        clearSession();
        return false;
      }
      const matched = state.users.find(u => u.username.toLowerCase() === (parsed.username || '').toLowerCase());
      if (matched) {
        state.currentUser = matched;
        return true;
      }
    }
  } catch (e) {
    console.error('Error loading session:', e);
  }
  state.currentUser = null;
  return false;
}

function saveSession(user) {
  try {
    const sessionObj = { username: user.username, role: user.role };
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sessionObj));
    sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sessionObj));
  } catch (e) {}
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    sessionStorage.removeItem(STORAGE_SESSION_KEY);
  } catch (e) {}
  state.currentUser = null;
}

function login(username, password) {
  const cleanU = (username || '').trim().toLowerCase();
  const cleanP = (password || '').trim();

  if (!cleanU) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้หรือรหัสพนักงาน' };
  }

  // Find user by username, empId, or Thai employee name
  const user = state.users.find(u => 
    (u.username && u.username.toLowerCase() === cleanU) || 
    (u.empId && u.empId.toLowerCase() === cleanU) ||
    (u.name && u.name.toLowerCase() === cleanU)
  );

  if (!user) {
    return { success: false, message: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ โปรดตรวจสอบชื่อผู้ใช้' };
  }

  // Exact password check
  const isMatch = (user.password === cleanP);
  if (!isMatch) {
    return { success: false, message: 'รหัสผ่านไม่ถูกต้อง โปรดลองอีกครั้ง' };
  }

  state.currentUser = user;
  saveSession(user);
  applyRolePermissions();
  return { success: true, user };
}

function logout() {
  if (!confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) return;
  clearSession();
  applyRolePermissions();
  showLoginModal();
  showToast('ออกจากระบบแล้ว', 'เข้าสู่ระบบใหม่อีกครั้งเมื่อต้องการใช้งาน', 'success');
}

function showLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) {
    modal.classList.remove('hidden');
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    const errAlert = document.getElementById('login-error-alert');
    if (uInput) uInput.value = '';
    if (pInput) pInput.value = '';
    if (errAlert) errAlert.classList.add('hidden');
  }
}

function hideLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) modal.classList.add('hidden');
}


function applyRolePermissions() {
  if (!state.currentUser) {
    showLoginModal();
    return;
  }

  hideLoginModal();

  const isAdmin = state.currentUser.role === 'admin';

  // 1. Update Header User Badge
  const badgeName = document.getElementById('user-badge-name');
  const badgeRole = document.getElementById('user-badge-role');
  const badgeAvatar = document.getElementById('user-badge-avatar');

  if (badgeName) {
    badgeName.textContent = isAdmin ? 'chana.p' : state.currentUser.name;
  }
  if (badgeRole) {
    badgeRole.textContent = isAdmin ? 'Admin' : (state.currentUser.empId || 'User');
    badgeRole.className = isAdmin ? 'text-[10px] font-bold text-amber-600' : 'text-[10px] font-semibold text-sky-600';
  }
  if (badgeAvatar) {
    badgeAvatar.classList.add('hidden');
    badgeAvatar.textContent = '';
  }

  // 2. Show/Hide Admin-Only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (isAdmin) {
    setTimeout(initAttendanceMap, 100);
  }

  // 3. Punch Card: Hide for Admin (Admin does NOT record attendance), Show for Regular Employees
  const punchCard = document.getElementById('punch-card');
  const chartContainer = document.getElementById('chart-container');
  const empSelectContainer = document.getElementById('container-employee-select');
  const selectEmployee = document.getElementById('select-employee');

  if (isAdmin) {
    // Admin does NOT record attendance -> Hide punch card completely!
    if (punchCard) punchCard.classList.add('hidden');
    if (chartContainer) {
      chartContainer.classList.remove('lg:col-span-7');
      chartContainer.classList.add('lg:col-span-12');
    }
  } else {
    // Regular employee: show punch card and lock to own account
    if (punchCard) punchCard.classList.remove('hidden');
    if (chartContainer) {
      chartContainer.classList.remove('lg:col-span-12');
      chartContainer.classList.add('lg:col-span-7');
    }
    if (empSelectContainer) empSelectContainer.classList.add('hidden');
    if (selectEmployee && state.currentUser) {
      selectEmployee.value = state.currentUser.empId;
      selectEmployee.disabled = true;
    }
    if (state.currentUser) {
      state.selectedEmpId = state.currentUser.empId;
    }
    updateSelectedEmployeeCard();
  }

  // Trigger chart re-render and resize for wide layout
  setTimeout(() => {
    if (typeof updateAttendanceCharts === 'function') updateAttendanceCharts();
    window.dispatchEvent(new Event('resize'));
  }, 100);

  refreshAllUI();
}

// --- Database Synchronization Engine (Google Sheets & Firebase) ---

function getActiveGSheetUrl() {
  const saved = localStorage.getItem(STORAGE_GSHEET_KEY);
  if (saved && saved.trim()) return saved.trim();
  if (window.GOOGLE_SHEET_URL && window.GOOGLE_SHEET_URL.trim()) return window.GOOGLE_SHEET_URL.trim();
  return '';
}

function getActiveFirebaseConfig() {
  const saved = localStorage.getItem(STORAGE_CLOUD_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  if (window.DEFAULT_FIREBASE_CONFIG && window.DEFAULT_FIREBASE_CONFIG.databaseURL) {
    return window.DEFAULT_FIREBASE_CONFIG;
  }
  return null;
}

// Helper: Sanitize time string to HH:mm
function formatTimeHHmm(val, defaultVal = '08:30') {
  if (!val) return defaultVal;
  const match = String(val).match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
  return defaultVal;
}

// 1. Google Sheets Operations
async function fetchGoogleSheetData(silent = false) {
  const url = getActiveGSheetUrl();
  if (!url) return;

  try {
    const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const res = await fetch(fetchUrl, {
      cache: 'no-store'
    });
    const data = await res.json();
    if (data && data.status === 'success') {
      if (Array.isArray(data.employees) && data.employees.length > 0) {
        state.employees = data.employees
          .filter(emp => {
            const id = String(emp.id || '').trim().toLowerCase();
            const name = String(emp.name || '').trim().toLowerCase();
            return id !== 'chana.p' && id !== 'admin' && !name.includes('ผู้ดูแลระบบ');
          })
          .map(emp => {
            const localEmp = state.employees.find(e => e.id === emp.id);
            return {
              id: emp.id,
              name: emp.name,
              dept: emp.dept,
              color: emp.color || 'bg-sky-600',
              workStart: emp.workStart || (localEmp ? localEmp.workStart : null) || state.settings.startTime || '08:30',
              workEnd: emp.workEnd || (localEmp ? localEmp.workEnd : null) || state.settings.endTime || '17:30'
            };
          });

        // Sync usernames and passwords from Google Sheets into state.users
        let missingPasswordInSheet = false;
        data.employees.forEach(emp => {
          let userAcc = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
          const userPwd = (emp.password && String(emp.password).trim() !== '') ? emp.password : (userAcc ? userAcc.password : '1234');
          const userName = emp.username || emp.id;

          if (!emp.password || String(emp.password).trim() === '') {
            missingPasswordInSheet = true;
          }

          if (!userAcc) {
            state.users.push({
              id: emp.id,
              username: userName,
              role: 'user',
              name: emp.name,
              empId: emp.id,
              dept: emp.dept,
              password: userPwd
            });
          } else {
            userAcc.name = emp.name;
            userAcc.dept = emp.dept;
            if (emp.username) userAcc.username = userName;
            if (emp.password && String(emp.password).trim() !== '') {
              userAcc.password = emp.password;
            }
          }
        });
        saveUsersData();

        // If any employee in Google Sheets is missing password in Column D,
        // automatically push passwords from web app up to Google Sheets!
        if (missingPasswordInSheet) {
          postToGoogleSheet({
            action: 'syncAll',
            employees: state.employees.map(e => {
              const u = state.users.find(usr => usr.empId === e.id || (usr.username && usr.username.toLowerCase() === e.id.toLowerCase()));
              return {
                ...e,
                password: (u && u.password) ? u.password : '1234'
              };
            }),
            attendances: state.attendances
          });
        }
      }
      if (Array.isArray(data.attendances)) {
        state.attendances = data.attendances.filter(a => {
          const id = String(a.empId || '').trim().toLowerCase();
          return id !== 'chana.p' && id !== 'admin';
        }).map(a => {
          // Parse string coordinates from Google Sheets if returned as text
          if (typeof a.checkInGPS === 'string') {
            const p = a.checkInGPS.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
            if (p.length >= 2) a.checkInGPS = { lat: p[0], lng: p[1] };
          }
          if (typeof a.checkOutGPS === 'string') {
            const p = a.checkOutGPS.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
            if (p.length >= 2) a.checkOutGPS = { lat: p[0], lng: p[1] };
          }

          // Keep locally stored real checkOutGPS/checkInGPS if sheet only has single GPS
          const existingLocal = state.attendances.find(loc => loc.id === a.id || (isSameEmpId(loc.empId, a.empId) && isSameDate(loc.date, a.date)));
          if (existingLocal) {
            if (!a.checkOutGPS && existingLocal.checkOutGPS) {
              a.checkOutGPS = existingLocal.checkOutGPS;
            }
            if (!a.checkInGPS && existingLocal.checkInGPS) {
              a.checkInGPS = existingLocal.checkInGPS;
            }

            // If local device (e.g. mobile) has the actual checkOutGPS that is missing/duplicate in sheet, sync to Google Sheet!
            if (existingLocal.checkOutGPS && existingLocal.checkOutGPS.lat) {
              const sheetOutNeedsUpdate = !a.checkOutGPS || (a.checkInGPS && a.checkOutGPS.lat === a.checkInGPS.lat && existingLocal.checkOutGPS.lat !== a.checkInGPS.lat);
              if (sheetOutNeedsUpdate) {
                a.checkOutGPS = existingLocal.checkOutGPS;
                postToGoogleSheet({
                  action: 'clockOut',
                  id: a.id,
                  empId: a.empId,
                  date: a.date,
                  checkOut: a.checkOut,
                  checkOutGPS: a.checkOutGPS,
                  outLat: a.checkOutGPS.lat,
                  outLng: a.checkOutGPS.lng
                });
              }
            }
          }

          // Align branch coordinates if record has default fallback 13.7563
          const branch = detectBranchGPS(a);
          if (branch) {
            if (a.checkInGPS && (a.checkInGPS.lat === '13.7563' || !a.checkInGPS.lat)) {
              a.checkInGPS = { lat: branch.lat, lng: branch.lng, accuracy: 15 };
            }
            if (a.checkOutGPS && (a.checkOutGPS.lat === '13.7563' || !a.checkOutGPS.lat)) {
              a.checkOutGPS = { lat: branch.lat, lng: branch.lng, accuracy: 15 };
            }
            if (a.gps && (a.gps.lat === '13.7563' || !a.gps.lat)) {
              a.gps = { lat: branch.lat, lng: branch.lng, accuracy: 15 };
            }
          }
          if (a.checkIn && !a.checkInGPS && a.gps) a.checkInGPS = { ...a.gps };

          // If employee has a checkOut time and checkOutGPS is still missing, fallback gracefully
          if (a.checkOut && !a.checkOutGPS) {
            if (a.gps && a.gps.lat && a.gps.lat !== '13.7563') {
              a.checkOutGPS = { ...a.gps };
            } else if (branch) {
              a.checkOutGPS = { lat: branch.lat, lng: branch.lng, accuracy: 15 };
            } else if (a.checkInGPS) {
              a.checkOutGPS = { ...a.checkInGPS };
            }
          }

          if (!a.gps) a.gps = a.checkInGPS || a.checkOutGPS || null;
          return a;
        });
        state.attendances = mergeSplitAttendances(state.attendances);
      }
      if (data.settings) {
        state.settings = {
          startTime: formatTimeHHmm(data.settings.startTime, '08:30'),
          endTime: formatTimeHHmm(data.settings.endTime, '17:30'),
          graceMinutes: parseInt(data.settings.graceMinutes, 10) || 0
        };
      }
      saveLocalData();
      renderEmployeeDropdown();
      renderEmployeeRoster();
      updateSettingLabels();
      refreshAllUI();
      if (!silent) {
        showToast('ซิงค์ Google Sheets สำเร็จ!', 'ดึงข้อมูลพนักงานและประวัติล่าสุดเรียบร้อย', 'success');
      }
    }
  } catch (err) {
    console.warn('GSheet fetch error:', err);
    if (!silent) {
      showToast('เชื่อมต่อ Google Sheets ไม่สำเร็จ', 'โปรดตรวจสอบการ Deploy Web App เป็น "Anyone"', 'warning');
    }
  }
}

function postToGoogleSheet(payload) {
  const url = getActiveGSheetUrl();
  if (!url) return;

  // Use text/plain and no-cors to reliably trigger Google Apps Script without preflight rejection
  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).catch(err => {
    console.warn('GSheet post error:', err);
  });
}

// Upload current local state to Google Sheets (Bulk migration)
async function uploadLocalDataToGoogleSheet() {
  const url = getActiveGSheetUrl();
  if (!url) {
    alert('กรุณาเชื่อมต่อ Google Sheets ก่อนทำการอัปโหลดครับ');
    return;
  }

  showToast('กำลังอัปโหลดข้อมูล...', 'กำลังส่งรายชื่อพนักงานและประวัติขึ้น Google Sheets', 'warning');

  postToGoogleSheet({
    action: 'syncAll',
    employees: state.employees.map(emp => {
      const u = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
      return {
        ...emp,
        username: u ? u.username : emp.id,
        password: u ? u.password : '1234'
      };
    }),
    attendances: state.attendances
  });

  setTimeout(async () => {
    await fetchGoogleSheetData(true);
    showToast('อัปโหลดสำเร็จ!', 'ข้อมูลทั้งหมดรวมถึง User และ Password ถูกบันทึกลง Google Sheets เรียบร้อยแล้ว', 'success');
  }, 2500);
}

// 2. Initialize Unified Database Sync
async function initDatabaseSync() {
  // Check URL Hash for auto-config from mobile share link
  if (window.location.hash) {
    if (window.location.hash.includes('gsheetUrl=')) {
      try {
        const urlStr = decodeURIComponent(window.location.hash.split('gsheetUrl=')[1].split('&')[0]);
        if (urlStr) {
          localStorage.setItem(STORAGE_GSHEET_KEY, urlStr);
          try { history.replaceState(null, null, window.location.pathname + window.location.search); } catch (e) {}
          showToast('รับค่า Google Sheets แล้ว!', 'เชื่อมต่อฐานข้อมูลจากลิงก์เรียบร้อย', 'success');
        }
      } catch (e) { }
    } else if (window.location.hash.includes('cloudConfig=')) {
      try {
        const hashStr = window.location.hash.split('cloudConfig=')[1].split('&')[0];
        const decodedJson = decodeURIComponent(escape(atob(decodeURIComponent(hashStr))));
        const decodedConfig = JSON.parse(decodedJson);
        if (decodedConfig && decodedConfig.databaseURL) {
          localStorage.setItem(STORAGE_CLOUD_KEY, JSON.stringify(decodedConfig));
          try { history.replaceState(null, null, window.location.pathname + window.location.search); } catch (e) {}
          showToast('รับค่าคลาวด์แล้ว!', 'เชื่อมต่อฐานข้อมูลจากลิงก์เรียบร้อย', 'success');
        }
      } catch (e) { }
    }
  }

  // Priority 1: Google Sheets
  const gsheetUrl = getActiveGSheetUrl();
  if (gsheetUrl) {
    activeBackend = 'gsheet';
    updateDatabaseStatusUI('gsheet', 'ซิงค์ผ่าน Google Sheets');
    await fetchGoogleSheetData(true);

    // Auto-poll Google Sheets every 30 seconds for background multi-device sync
    if (gsheetPollTimer) clearInterval(gsheetPollTimer);
    gsheetPollTimer = setInterval(() => {
      if (activeBackend === 'gsheet') {
        fetchGoogleSheetData(true);
      }
    }, 30000);
    return;
  }

  // Priority 2: Firebase Realtime Database
  const firebaseConfig = getActiveFirebaseConfig();
  if (firebaseConfig && firebaseConfig.databaseURL && typeof firebase !== 'undefined') {
    try {
      if (!firebaseApp) {
        if (firebase.apps && firebase.apps.length > 0) {
          firebaseApp = firebase.apps[0];
        } else {
          firebaseApp = firebase.initializeApp(firebaseConfig);
        }
      }
      firebaseDb = firebase.database();
      activeBackend = 'firebase';
      updateDatabaseStatusUI('firebase', 'คลาวด์ออนไลน์ (Firebase)');

      // Realtime listener for attendances
      firebaseDb.ref('attendances').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Array.isArray(val) ? val : Object.values(val);
          state.attendances = list.filter(item => item && item.id);
          saveLocalData();
          refreshAllUI();
        }
      });

      // Realtime listener for employees
      firebaseDb.ref('employees').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Array.isArray(val) ? val : Object.values(val);
          state.employees = list.filter(emp => emp && emp.id);
          saveLocalData();
          renderEmployeeDropdown();
          renderEmployeeRoster();
          refreshAllUI();
        }
      });

      // Realtime listener for settings
      firebaseDb.ref('settings').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          state.settings = { ...DEFAULT_SETTINGS, ...val };
          saveLocalData();
          updateSettingLabels();
        }
      });
      return;
    } catch (err) {
      console.warn('Firebase init error:', err);
    }
  }

  // Priority 3: LocalStorage only
  activeBackend = 'local';
  updateDatabaseStatusUI('local', 'โหมดในเครื่อง (ออฟไลน์)');
}

function updateDatabaseStatusUI(type, text) {
  isCloudConnected = (type !== 'local');
  const statusBadge = document.getElementById('btn-cloud-status');
  const badgeDot = document.getElementById('cloud-badge-dot');
  const badgeText = document.getElementById('cloud-badge-text');
  const indicatorDot = document.getElementById('cloud-indicator-dot');
  const punchCloudPill = document.getElementById('punch-cloud-pill');
  const punchStatusText = document.getElementById('punch-cloud-status-text');
  const storageSource = document.getElementById('table-storage-source');
  const modalBanner = document.getElementById('cloud-modal-banner');
  const modalDot = document.getElementById('cloud-modal-dot');
  const modalTitle = document.getElementById('cloud-modal-title');
  const modalDesc = document.getElementById('cloud-modal-desc');

  if (type === 'gsheet') {
    if (statusBadge) {
      statusBadge.className = 'hidden sm:inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 transition cursor-pointer hover:bg-emerald-100';
    }
    if (badgeDot) badgeDot.className = 'inline-block w-1.5 h-1.5 rounded-full mr-1.5 bg-emerald-500 animate-pulse';
    if (badgeText) badgeText.textContent = text || 'ซิงค์ผ่าน Google Sheets';
    if (indicatorDot) indicatorDot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse';

    if (punchCloudPill) {
      punchCloudPill.className = 'flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-300';
    }
    if (punchStatusText) punchStatusText.textContent = 'บันทึกลง Google Sheets';

    if (storageSource) storageSource.textContent = 'แหล่งข้อมูล: Google Sheets กลาง (ซิงค์ทุกเครื่อง)';

    if (modalBanner) {
      modalBanner.className = 'p-3.5 rounded-2xl border flex items-center justify-between bg-emerald-50 border-emerald-300 text-emerald-950 text-xs';
    }
    if (modalDot) modalDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0';
    if (modalTitle) modalTitle.textContent = 'สถานะ: เชื่อมต่อ Google Sheets เรียบร้อยแล้ว (Online)';
    if (modalDesc) modalDesc.textContent = 'ข้อมูลเข้า-ออกงาน รูปถ่าย และพิกัดจะถูกส่งไปบันทึกใน Google Sheets อัตโนมัติ';
  } else if (type === 'firebase') {
    if (statusBadge) {
      statusBadge.className = 'hidden sm:inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border bg-sky-50 text-sky-700 border-sky-300 transition cursor-pointer hover:bg-sky-100';
    }
    if (badgeDot) badgeDot.className = 'inline-block w-1.5 h-1.5 rounded-full mr-1.5 bg-sky-500 animate-pulse';
    if (badgeText) badgeText.textContent = text || 'คลาวด์ออนไลน์ (Firebase)';
    if (indicatorDot) indicatorDot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-500 animate-pulse';

    if (punchCloudPill) {
      punchCloudPill.className = 'flex items-center gap-1.5 text-xs text-sky-700 font-semibold bg-sky-50 px-2.5 py-1 rounded-full border border-sky-300';
    }
    if (punchStatusText) punchStatusText.textContent = 'ซิงค์ผ่าน Firebase';

    if (storageSource) storageSource.textContent = 'แหล่งข้อมูล: Firebase Cloud (ซิงค์ทุกเครื่อง)';

    if (modalBanner) {
      modalBanner.className = 'p-3.5 rounded-2xl border flex items-center justify-between bg-sky-50 border-sky-200 text-sky-950 text-xs';
    }
    if (modalDot) modalDot.className = 'w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse shrink-0';
    if (modalTitle) modalTitle.textContent = 'สถานะ: เชื่อมต่อ Firebase Realtime Database';
    if (modalDesc) modalDesc.textContent = 'ข้อมูลเข้า-ออกงานจะซิงค์สดข้ามทุกเครื่อง';
  } else {
    if (statusBadge) {
      statusBadge.className = 'hidden sm:inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border bg-amber-50 text-amber-800 border-amber-200 transition cursor-pointer hover:bg-amber-100';
    }
    if (badgeDot) badgeDot.className = 'inline-block w-1.5 h-1.5 rounded-full mr-1.5 bg-amber-500';
    if (badgeText) badgeText.textContent = text || 'โหมดในเครื่อง (ออฟไลน์)';
    if (indicatorDot) indicatorDot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500';

    if (punchCloudPill) {
      punchCloudPill.className = 'flex items-center gap-1.5 text-xs text-amber-800 font-semibold bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200';
    }
    if (punchStatusText) punchStatusText.textContent = 'โหมดในเครื่อง';

    if (storageSource) storageSource.textContent = 'แหล่งข้อมูล: ในเครื่องนี้เท่านั้น (LocalStorage)';

    if (modalBanner) {
      modalBanner.className = 'p-3.5 rounded-2xl border flex items-center justify-between bg-amber-50 border-amber-200 text-amber-900 text-xs';
    }
    if (modalDot) modalDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0';
    if (modalTitle) modalTitle.textContent = 'สถานะ: ใช้งานโหมดในเครื่อง (LocalStorage)';
    if (modalDesc) modalDesc.textContent = 'เชื่อมต่อ Google Sheets เพื่อให้ข้อมูลซิงค์กันข้ามทุกเครื่อง';
  }
}

// Write Attendance record
function saveAttendanceRecord(record) {
  state.attendances.unshift(record);
  saveLocalData();

  if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
    postToGoogleSheet({ action: 'clockIn', record });
  }
  if (activeBackend === 'firebase' && firebaseDb) {
    firebaseDb.ref('attendances/' + record.id).set(record).catch(err => {
      console.warn('Firebase write error:', err);
    });
  }
}

// Update Attendance record (Clock Out)
function updateAttendanceRecord(record) {
  saveLocalData();

  if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
    postToGoogleSheet({
      action: 'clockOut',
      id: record.id,
      record,
      empId: record.empId,
      date: record.date,
      checkOut: record.checkOut,
      photo: record.photo,
      gps: record.checkOutGPS || record.gps,
      checkInGPS: record.checkInGPS,
      checkOutGPS: record.checkOutGPS,
      outLat: record.checkOutGPS ? record.checkOutGPS.lat : (record.gps ? record.gps.lat : ''),
      outLng: record.checkOutGPS ? record.checkOutGPS.lng : (record.gps ? record.gps.lng : ''),
      note: record.note
    });
  }
  if (activeBackend === 'firebase' && firebaseDb) {
    firebaseDb.ref('attendances/' + record.id).set(record).catch(err => {
      console.warn('Firebase update error:', err);
    });
  }
}

// Delete Attendance record
function removeAttendanceRecord(id) {
  const item = state.attendances.find(a => a.id === id);
  state.attendances = state.attendances.filter(a => a.id !== id);
  saveLocalData();

  if (getActiveGSheetUrl()) {
    postToGoogleSheet({
      action: 'deleteAttendance',
      id: id,
      empId: item ? item.empId : '',
      date: item ? item.date : ''
    });
  }
  if (activeBackend === 'firebase' && firebaseDb) {
    firebaseDb.ref('attendances/' + id).remove().catch(err => {
      console.warn('Firebase delete error:', err);
    });
  }
}

// --- Camera Management ---
async function startCamera(facing = currentFacingMode) {
  const video = document.getElementById('camera-video');
  const placeholder = document.getElementById('camera-placeholder');
  const controlsOverlay = document.getElementById('camera-controls-overlay');
  const preview = document.getElementById('camera-photo-preview');
  const statusPill = document.getElementById('camera-status-pill');

  if (!video) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('ไม่รองรับกล้องตรง', 'เบราว์เซอร์ไม่อนุญาต ให้กดปุ่ม "เลือกรูป/ถ่ายรูป" แทนได้ครับ', 'warning');
    return;
  }

  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    currentFacingMode = facing;
    const constraints = {
      video: {
        facingMode: currentFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraStream;
    await video.play();

    if (currentFacingMode === 'user') {
      video.classList.add('video-mirrored');
    } else {
      video.classList.remove('video-mirrored');
    }

    video.classList.remove('hidden');
    preview.classList.add('hidden');
    placeholder.classList.add('hidden');
    controlsOverlay.classList.remove('hidden');
    document.getElementById('btn-clear-photo')?.classList.add('hidden');
    document.getElementById('btn-snap-photo')?.classList.remove('hidden');

    if (statusPill) {
      statusPill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> กล้องพร้อมถ่าย`;
    }

    showToast('เปิดกล้องแล้ว', 'ส่องหน้าให้อยู่ในกรอบเพื่อบันทึกเวลา', 'success');
  } catch (err) {
    console.warn('Camera access denied or error:', err);
    showToast('ไม่สามารถเปิดกล้องได้', 'สามารถกดปุ่ม "เลือกรูป/ถ่ายรูป" เพื่อใช้กล้องจากมือถือได้ครับ', 'warning');
  }
}

function switchCamera() {
  const newFacing = currentFacingMode === 'user' ? 'environment' : 'user';
  startCamera(newFacing);
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const preview = document.getElementById('camera-photo-preview');
  const cameraBox = document.getElementById('camera-box');
  const statusPill = document.getElementById('camera-status-pill');
  const btnSnap = document.getElementById('btn-snap-photo');
  const btnClear = document.getElementById('btn-clear-photo');

  if (!video || !canvas || video.videoWidth === 0) {
    return null;
  }

  cameraBox.classList.add('camera-flash-active');
  setTimeout(() => cameraBox.classList.remove('camera-flash-active'), 350);
  playSound('shutter');

  const width = 240;
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 180;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (currentFacingMode === 'user') {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
  currentCapturedPhoto = dataUrl;

  preview.src = dataUrl;
  preview.classList.remove('hidden');
  video.classList.add('hidden');

  if (statusPill) {
    statusPill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> ถ่ายภาพแล้ว`;
  }
  if (btnSnap) btnSnap.classList.add('hidden');
  if (btnClear) btnClear.classList.remove('hidden');

  return dataUrl;
}

function clearCapturedPhoto() {
  const video = document.getElementById('camera-video');
  const preview = document.getElementById('camera-photo-preview');
  const statusPill = document.getElementById('camera-status-pill');
  const btnSnap = document.getElementById('btn-snap-photo');
  const btnClear = document.getElementById('btn-clear-photo');

  currentCapturedPhoto = null;
  if (preview) {
    preview.src = '';
    preview.classList.add('hidden');
  }

  if (cameraStream && video) {
    video.classList.remove('hidden');
    if (statusPill) statusPill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> กล้องพร้อมถ่าย`;
    if (btnSnap) btnSnap.classList.remove('hidden');
    if (btnClear) btnClear.classList.add('hidden');
  } else {
    document.getElementById('camera-placeholder')?.classList.remove('hidden');
    document.getElementById('camera-controls-overlay')?.classList.add('hidden');
  }
}

function setupCameraFileInput() {
  const fileInput = document.getElementById('camera-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.getElementById('camera-canvas');
        const preview = document.getElementById('camera-photo-preview');
        const placeholder = document.getElementById('camera-placeholder');
        const controls = document.getElementById('camera-controls-overlay');
        const btnClear = document.getElementById('btn-clear-photo');
        const btnSnap = document.getElementById('btn-snap-photo');
        const statusPill = document.getElementById('camera-status-pill');

        const width = 240;
        const height = Math.round((img.height / img.width) * width) || 180;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        currentCapturedPhoto = dataUrl;

        preview.src = dataUrl;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        controls.classList.remove('hidden');
        if (btnClear) btnClear.classList.remove('hidden');
        if (btnSnap) btnSnap.classList.add('hidden');
        if (statusPill) statusPill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> ถ่ายภาพแล้ว`;

        playSound('shutter');
        showToast('แนบรูปถ่ายแล้ว', 'พร้อมสำหรับการลงเวลาเข้า-ออกงาน', 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- GPS Geolocation Management (Auto-sync with Google Maps) ---
let gpsWatchId = null;

async function fetchIPFallbackLocation() {
  try {
    const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.latitude && data.longitude) {
      return {
        lat: parseFloat(data.latitude).toFixed(5),
        lng: parseFloat(data.longitude).toFixed(5),
        accuracy: data.accuracy || 200,
        city: data.city || ''
      };
    }
  } catch (e) {
    console.warn('IP location fallback error:', e);
  }
  return null;
}

function updateGPSUI(lat, lng, acc, isApprox = false, label = '') {
  currentGPS = { lat: String(lat), lng: String(lng), accuracy: acc || 20 };
  const gpsText = document.getElementById('gps-status-text');
  const liveMapBtn = document.getElementById('btn-open-live-map');

  let desc = '';
  if (label) {
    desc = `<span class="text-sky-700 font-semibold text-[10px]">(${label})</span>`;
  } else if (isApprox) {
    desc = `<span class="text-amber-600 font-medium text-[10px]">(ซิงค์จากเครือข่าย)</span>`;
  } else {
    desc = `<span class="text-emerald-600 font-semibold text-[10px]">(ซิงค์ดาวเทียม ±${acc}ม.)</span>`;
  }

  if (gpsText) {
    gpsText.innerHTML = `📍 <span class="text-sky-700 font-bold">${lat}, ${lng}</span> ${desc}`;
  }

  if (liveMapBtn) {
    liveMapBtn.href = `https://www.google.com/maps?q=${lat},${lng}`;
    liveMapBtn.classList.remove('hidden');
  }

  const manualLat = document.getElementById('manual-lat');
  const manualLng = document.getElementById('manual-lng');
  if (manualLat && !manualLat.value) manualLat.value = lat;
  if (manualLng && !manualLng.value) manualLng.value = lng;
}

// Function to acquire real-time fresh GPS right when clock-in / clock-out is clicked
async function acquireFreshGPS(targetEmp = null) {
  if (!navigator.geolocation) {
    const ipLoc = await fetchIPFallbackLocation();
    if (ipLoc) return { lat: ipLoc.lat, lng: ipLoc.lng, accuracy: ipLoc.accuracy };
    return currentGPS;
  }

  // Step 1: Try High Accuracy GPS with fresh fix (maximumAge: 0)
  const tryGetPosition = (highAccuracy, timeoutMs) => {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error('timeout'));
        }
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            const lat = pos.coords.latitude.toFixed(5);
            const lng = pos.coords.longitude.toFixed(5);
            const acc = Math.round(pos.coords.accuracy);
            updateGPSUI(lat, lng, acc, false);
            resolve({ lat, lng, accuracy: acc });
          }
        },
        (err) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject(err);
          }
        },
        { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 }
      );
    });
  };

  try {
    return await tryGetPosition(true, 4000);
  } catch (errHigh) {
    // Step 2: Fallback to fast standard accuracy (network/wifi/cell tower)
    try {
      return await tryGetPosition(false, 3000);
    } catch (errLow) {
      // Step 3: Try fresh IP-based Geolocation
      try {
        const ipLoc = await fetchIPFallbackLocation();
        if (ipLoc) {
          updateGPSUI(ipLoc.lat, ipLoc.lng, ipLoc.accuracy, true);
          return { lat: ipLoc.lat, lng: ipLoc.lng, accuracy: ipLoc.accuracy };
        }
      } catch (e) {}

      if (currentGPS && currentGPS.lat && currentGPS.lat !== '13.7563') {
        return currentGPS;
      }
      return null;
    }
  }
}

function openAdjustGPSDialog() {
  const options = [
    '1. 🏢 รังสิต (13.9890, 100.6177)',
    '2. 🏢 ไทรน้อย (13.9715, 100.3261)',
    '3. 🏢 จรัญสนิทวงศ์ (13.7650, 100.4850)',
    '4. 🏢 พระราม 2 (DOPA) (13.6644, 100.4421)',
    '5. 🏢 ลำลูกกา / ปักษีเลิศ (13.9736, 100.6582)',
    '6. 🏢 สำนักงานใหญ่ (13.7563, 100.5018)',
    '7. 📡 ดึงสัญญาณดาวเทียม GPS สดจากอุปกรณ์',
    '8. ✏️ พิมพ์พิกัด ละติจูด, ลองจิจูด เอง'
  ];
  const choice = prompt('📍 เลือกหรือปรับพิกัดสถานที่ลงเวลา:\n\n' + options.join('\n') + '\n\nพิมพ์หมายเลข 1 ถึง 8:');
  if (choice === '1') {
    updateGPSUI(BRANCH_LOCATIONS.RANGSIT.lat, BRANCH_LOCATIONS.RANGSIT.lng, 15, false, BRANCH_LOCATIONS.RANGSIT.name);
    showToast('ตั้งพิกัดแล้ว', `📍 ${BRANCH_LOCATIONS.RANGSIT.name} (${BRANCH_LOCATIONS.RANGSIT.lat}, ${BRANCH_LOCATIONS.RANGSIT.lng})`, 'success');
  } else if (choice === '2') {
    updateGPSUI(BRANCH_LOCATIONS.SAINOI.lat, BRANCH_LOCATIONS.SAINOI.lng, 15, false, BRANCH_LOCATIONS.SAINOI.name);
    showToast('ตั้งพิกัดแล้ว', `📍 ${BRANCH_LOCATIONS.SAINOI.name} (${BRANCH_LOCATIONS.SAINOI.lat}, ${BRANCH_LOCATIONS.SAINOI.lng})`, 'success');
  } else if (choice === '3') {
    updateGPSUI(BRANCH_LOCATIONS.CHARAN.lat, BRANCH_LOCATIONS.CHARAN.lng, 15, false, BRANCH_LOCATIONS.CHARAN.name);
    showToast('ตั้งพิกัดแล้ว', `📍 ${BRANCH_LOCATIONS.CHARAN.name} (${BRANCH_LOCATIONS.CHARAN.lat}, ${BRANCH_LOCATIONS.CHARAN.lng})`, 'success');
  } else if (choice === '4') {
    updateGPSUI(BRANCH_LOCATIONS.RAMA2.lat, BRANCH_LOCATIONS.RAMA2.lng, 15, false, BRANCH_LOCATIONS.RAMA2.name);
    showToast('ตั้งพิกัดแล้ว', `📍 ${BRANCH_LOCATIONS.RAMA2.name}`, 'success');
  } else if (choice === '5') {
    updateGPSUI(BRANCH_LOCATIONS.LAMLUKKA.lat, BRANCH_LOCATIONS.LAMLUKKA.lng, 15, false, BRANCH_LOCATIONS.LAMLUKKA.name);
    showToast('ตั้งพิกัดแล้ว', `📍 ${BRANCH_LOCATIONS.LAMLUKKA.name}`, 'success');
  } else if (choice === '6') {
    updateGPSUI(BRANCH_LOCATIONS.HQ.lat, BRANCH_LOCATIONS.HQ.lng, 20, false, BRANCH_LOCATIONS.HQ.name);
    showToast('ตั้งพิกัดแล้ว', `🏢 ${BRANCH_LOCATIONS.HQ.name}`, 'success');
  } else if (choice === '7') {
    if (navigator.geolocation) {
      showToast('กำลังค้นหา...', 'กำลังเชื่อมต่อดาวเทียม GPS...', 'warning');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(5);
          const lng = pos.coords.longitude.toFixed(5);
          const acc = Math.round(pos.coords.accuracy);
          updateGPSUI(lat, lng, acc, false);
          showToast('ได้พิกัด GPS แล้ว', `${lat}, ${lng} (±${acc}ม.)`, 'success');
        },
        (err) => {
          alert('⚠️ ไม่สามารถดึง GPS จากอุปกรณ์ได้: ' + err.message + '\n\nคำแนะนำ: กรุณาเปิด Location ในการตั้งค่าเครื่อง หรือเลือกหมายเลขสาขาด้านบนครับ');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    }
  } else if (choice === '8') {
    const coords = prompt('กรุณากรอก ละติจูด, ลองจิจูด (คั่นด้วยเครื่องหมายจุลภาค):', currentGPS ? `${currentGPS.lat}, ${currentGPS.lng}` : '13.9890, 100.6177');
    if (coords) {
      const parts = coords.split(',').map(s => s.trim());
      if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
        updateGPSUI(parseFloat(parts[0]).toFixed(5), parseFloat(parts[1]).toFixed(5), 10, false, 'กำหนดเอง');
        showToast('บันทึกพิกัดแล้ว', `${parts[0]}, ${parts[1]}`, 'success');
      } else {
        alert('รูปแบบพิกัดไม่ถูกต้อง ตัวอย่าง: 13.9890, 100.6177');
      }
    }
  }
}

function fetchGPSLocation() {
  const gpsText = document.getElementById('gps-status-text');

  if (!navigator.geolocation) {
    if (gpsText) gpsText.textContent = 'เบราว์เซอร์ไม่รองรับ GPS';
    fetchIPFallbackLocation().then(ipLoc => {
      if (ipLoc) updateGPSUI(ipLoc.lat, ipLoc.lng, ipLoc.accuracy, true);
    });
    return;
  }

  if (gpsText && !currentGPS) {
    gpsText.innerHTML = `<span class="inline-flex items-center gap-1 text-slate-500"><span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping"></span> กำลังซิงค์ Google Maps อัตโนมัติ...</span>`;
  }

  const onGeoSuccess = (pos) => {
    const lat = pos.coords.latitude.toFixed(5);
    const lng = pos.coords.longitude.toFixed(5);
    const acc = Math.round(pos.coords.accuracy);
    updateGPSUI(lat, lng, acc, false);
  };

  const onGeoError = async (err) => {
    console.warn('GPS location error:', err.message);
    if (!currentGPS || currentGPS.lat === '13.7563') {
      const ipLoc = await fetchIPFallbackLocation();
      if (ipLoc) {
        updateGPSUI(ipLoc.lat, ipLoc.lng, ipLoc.accuracy, true);
      } else {
        updateGPSUI('13.7563', '100.5018', 50, true);
      }
    }
  };

  // 1. Immediate position request
  navigator.geolocation.getCurrentPosition(onGeoSuccess, onGeoError, {
    enableHighAccuracy: true,
    timeout: 8000,
    maximumAge: 0
  });

  // 2. Start continuous watchPosition for live auto-sync with Google Maps
  try {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 5000
    });
  } catch (e) {
    console.warn('watchPosition failed:', e);
  }

  // 3. Periodic background refresh every 15 seconds to ensure GPS is kept fresh
  if (!window._gpsAutoInterval) {
    window._gpsAutoInterval = setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(onGeoSuccess, () => {}, {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 5000
        });
      }
    }, 15000);
  }
}

// --- Live Clock ---
function startLiveClock() {
  const timeEl = document.getElementById('live-time');
  const dateEl = document.getElementById('live-date');

  function update() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    if (timeEl) timeEl.textContent = `${hours}:${minutes}:${seconds}`;
    if (dateEl) dateEl.textContent = formatThaiDate(now);
  }

  update();
  setInterval(update, 1000);
}

// --- UI Rendering ---

function renderEmployeeDropdown() {
  const select = document.getElementById('select-employee');
  const manualSelect = document.getElementById('manual-emp-select');
  if (!select) return;

  select.innerHTML = '';
  if (manualSelect) manualSelect.innerHTML = '';

  state.employees.forEach(emp => {
    const option = document.createElement('option');
    option.value = emp.id;
    option.textContent = `${emp.id} - ${emp.name} (${emp.dept})`;
    select.appendChild(option);

    if (manualSelect) {
      const opt2 = option.cloneNode(true);
      manualSelect.appendChild(opt2);
    }
  });

  if (state.employees.length > 0) {
    if (!state.selectedEmpId || !state.employees.some(e => e.id === state.selectedEmpId)) {
      state.selectedEmpId = state.employees[0].id;
    }
    select.value = state.selectedEmpId;
    updateSelectedEmployeeCard();
  }
}

// Render Dropdown Filters for Employee Name and Department (Admin Only)
function renderFilterDropdowns() {
  const empSelect = document.getElementById('filter-employee');
  const deptSelect = document.getElementById('filter-department');
  if (!empSelect || !deptSelect) return;

  const currentEmpVal = empSelect.value || 'ALL';
  const currentDeptVal = deptSelect.value || 'ALL';

  // 1. Render Employees filter dropdown
  empSelect.innerHTML = '<option value="ALL">👤 พนักงานทุกคน</option>';
  state.employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.name} (${emp.id})`;
    empSelect.appendChild(opt);
  });
  if (state.employees.some(e => e.id === currentEmpVal)) {
    empSelect.value = currentEmpVal;
  } else {
    empSelect.value = 'ALL';
  }

  // 2. Render Departments filter dropdown (unique non-empty departments)
  const deptSet = new Set();
  state.employees.forEach(e => {
    if (e.dept && e.dept.trim()) deptSet.add(e.dept.trim());
  });
  state.attendances.forEach(a => {
    if (a.dept && a.dept.trim()) deptSet.add(a.dept.trim());
  });

  deptSelect.innerHTML = '<option value="ALL">🏢 แผนกทั้งหมด</option>';
  Array.from(deptSet).sort().forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    deptSelect.appendChild(opt);
  });
  if (deptSet.has(currentDeptVal)) {
    deptSelect.value = currentDeptVal;
  } else {
    deptSelect.value = 'ALL';
  }
}

// --- Leaflet Map Engine (Admin Attendance Map) ---

function initAttendanceMap() {
  const mapEl = document.getElementById('attendance-leaflet-map');
  if (!mapEl || typeof L === 'undefined') return;
  if (attendanceMapInstance) {
    attendanceMapInstance.invalidateSize();
    return;
  }

  try {
    // Default to center of Bangkok
    attendanceMapInstance = L.map('attendance-leaflet-map', {
      center: [13.7563, 100.5018],
      zoom: 12,
      zoomControl: true
    });

    // Google Maps Tile Layers (Roadmap & Satellite Hybrid)
    const googleRoadmap = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    const googleSatellite = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    // Default to Google Maps Roadmap
    googleRoadmap.addTo(attendanceMapInstance);

    // Add Layer Control to switch between Normal Map and Satellite Map
    const baseLayers = {
      '🗺️ แผนที่ Google Maps': googleRoadmap,
      '🛰️ แผนที่ดาวเทียม': googleSatellite
    };
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(attendanceMapInstance);

    // Setup Fit Bounds button
    document.getElementById('btn-map-fit-bounds')?.addEventListener('click', () => {
      if (attendanceMapMarkers.length > 0 && attendanceMapInstance) {
        const group = L.featureGroup(attendanceMapMarkers);
        attendanceMapInstance.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
      }
    });

    // Setup Toggle Collapse button
    const btnToggle = document.getElementById('btn-map-toggle-collapse');
    const mapWrapper = document.getElementById('admin-map-wrapper');
    const iconCollapse = document.getElementById('icon-map-collapse');
    const textCollapse = document.getElementById('text-map-collapse');

    btnToggle?.addEventListener('click', () => {
      isAttendanceMapCollapsed = !isAttendanceMapCollapsed;
      if (isAttendanceMapCollapsed) {
        mapWrapper?.classList.add('map-collapsed');
        if (textCollapse) textCollapse.textContent = 'แสดงแผนที่';
        if (iconCollapse) iconCollapse.setAttribute('data-lucide', 'chevron-down');
      } else {
        mapWrapper?.classList.remove('map-collapsed');
        if (textCollapse) textCollapse.textContent = 'ย่อแผนที่';
        if (iconCollapse) iconCollapse.setAttribute('data-lucide', 'chevron-up');
        setTimeout(() => {
          if (attendanceMapInstance) {
            attendanceMapInstance.invalidateSize();
            if (attendanceMapMarkers.length > 0) {
              const group = L.featureGroup(attendanceMapMarkers);
              attendanceMapInstance.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
            }
          }
        }, 200);
      }
      lucide.createIcons();
    });

    setTimeout(() => {
      if (attendanceMapInstance) attendanceMapInstance.invalidateSize();
    }, 250);

  } catch (err) {
    console.warn('Error initializing Leaflet map:', err);
  }
}

function updateAttendanceMap(records) {
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const mapContainer = document.getElementById('admin-map-container');
  if (!isAdmin || !mapContainer) return;

  if (!attendanceMapInstance) {
    initAttendanceMap();
  }
  if (!attendanceMapInstance || typeof L === 'undefined') return;

  // Clear previous markers
  attendanceMapMarkers.forEach(m => {
    try { attendanceMapInstance.removeLayer(m); } catch (e) {}
  });
  attendanceMapMarkers = [];

  let countIn = 0;
  let countOut = 0;
  const overlay = document.getElementById('map-empty-overlay');
  const countInEl = document.getElementById('map-count-in');
  const countOutEl = document.getElementById('map-count-out');

  const validItems = records || state.attendances;

  // Track placed locations to avoid overlapping pins
  const placedLocations = [];
  function getJitteredCoord(rawLat, rawLng) {
    let lat = parseFloat(rawLat);
    let lng = parseFloat(rawLng);
    let overlaps = 0;
    for (const loc of placedLocations) {
      if (Math.abs(loc.lat - lat) < 0.0004 && Math.abs(loc.lng - lng) < 0.0004) {
        overlaps++;
      }
    }
    if (overlaps > 0) {
      const angle = (overlaps * 137.5) * (Math.PI / 180);
      const dist = 0.00045 * Math.ceil(overlaps / 3);
      lat += Math.sin(angle) * dist;
      lng += Math.cos(angle) * dist;
    }
    placedLocations.push({ lat, lng });
    return [lat, lng];
  }

  validItems.forEach(item => {
    const inGpsObj = item.checkInGPS || item.gps;
    const outGpsObj = item.checkOutGPS || item.gps;

    const photoSrc = item.photo || generateSampleAvatar(item.empName);

    // 1. Check-In Marker (🟢 ตรงเวลา หรือ 🟠 มาสาย)
    if (item.checkIn && inGpsObj && inGpsObj.lat && inGpsObj.lng) {
      const rawInLat = parseFloat(inGpsObj.lat);
      const rawInLng = parseFloat(inGpsObj.lng);
      if (!isNaN(rawInLat) && !isNaN(rawInLng)) {
        countIn++;
        const [inLat, inLng] = getJitteredCoord(rawInLat, rawInLng);
        const isLate = item.status === 'LATE';
        const badgeClass = isLate ? 'pin-bubble-in late' : 'pin-bubble-in';
        const timeStr = item.checkIn.substring(0, 5);
        const inGmapsLink = `https://www.google.com/maps?q=${rawInLat},${rawInLng}`;

        const inIcon = L.divIcon({
          className: 'custom-map-pin',
          html: `
            <div class="pin-bubble ${badgeClass}">
              <span>🟢</span>
              <span>${item.empName ? item.empName.split(' ')[0] : 'เข้า'}: ${timeStr}</span>
              <span class="pin-tail"></span>
            </div>
          `,
          iconSize: [120, 32],
          iconAnchor: [60, 32],
          popupAnchor: [0, -32]
        });

        const popupInHtml = `
          <div class="p-3 w-64 text-slate-800 text-xs">
            <div class="flex items-center gap-2.5 pb-2.5 mb-2 border-b border-slate-100">
              <div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                <i data-lucide="user" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="font-bold text-slate-900 text-sm leading-tight">${item.empName}</h4>
                <p class="text-[11px] text-slate-500">${item.empId} • ${item.dept}</p>
              </div>
            </div>
            <div class="space-y-1 text-[11px]">
              <div class="flex items-center justify-between">
                <span class="text-slate-500">ประเภท:</span>
                <span class="font-bold ${isLate ? 'text-amber-600' : 'text-emerald-600'}">🟢 บันทึกเข้างาน</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">เวลาเข้า:</span>
                <span class="font-semibold text-slate-800">${item.checkIn} น.</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">วันที่:</span>
                <span class="text-slate-700">${item.date}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">สถานที่:</span>
                <span class="text-slate-700 font-medium">${item.location || 'สำนักงานใหญ่'}</span>
              </div>
              <div class="flex items-center justify-between pt-1 border-t border-slate-100 mt-1">
                <span class="text-slate-400 font-mono text-[10px]">📍 ${rawInLat.toFixed(4)}, ${rawInLng.toFixed(4)}</span>
                <a href="${inGmapsLink}" target="_blank" class="inline-flex items-center gap-1 text-[10px] text-sky-600 hover:text-sky-800 font-semibold">
                  <span>เปิด Google Maps</span>
                  <i data-lucide="external-link" class="w-3 h-3"></i>
                </a>
              </div>
            </div>
          </div>
        `;

        const markerIn = L.marker([inLat, inLng], { icon: inIcon }).addTo(attendanceMapInstance);
        markerIn.bindPopup(popupInHtml);
        markerIn.recordId = item.id;
        markerIn.pinType = 'in';
        attendanceMapMarkers.push(markerIn);
      }
    }

    // 2. Check-Out Marker (🔴 ออกงาน)
    if (item.checkOut && outGpsObj && outGpsObj.lat && outGpsObj.lng) {
      const rawOutLat = parseFloat(outGpsObj.lat);
      const rawOutLng = parseFloat(outGpsObj.lng);
      if (!isNaN(rawOutLat) && !isNaN(rawOutLng)) {
        countOut++;
        const [outLat, outLng] = getJitteredCoord(rawOutLat, rawOutLng);
        const timeStr = item.checkOut.substring(0, 5);
        const outGmapsLink = `https://www.google.com/maps?q=${rawOutLat},${rawOutLng}`;

        const outIcon = L.divIcon({
          className: 'custom-map-pin',
          html: `
            <div class="pin-bubble pin-bubble-out">
              <span>🔴</span>
              <span>${item.empName ? item.empName.split(' ')[0] : 'ออก'}: ${timeStr}</span>
              <span class="pin-tail"></span>
            </div>
          `,
          iconSize: [120, 32],
          iconAnchor: [60, 32],
          popupAnchor: [0, -32]
        });

        const popupOutHtml = `
          <div class="p-3 w-64 text-slate-800 text-xs">
            <div class="flex items-center gap-2.5 pb-2.5 mb-2 border-b border-slate-100">
              <div class="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-xs shrink-0">
                <i data-lucide="user" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="font-bold text-slate-900 text-sm leading-tight">${item.empName}</h4>
                <p class="text-[11px] text-slate-500">${item.empId} • ${item.dept}</p>
              </div>
            </div>
            <div class="space-y-1 text-[11px]">
              <div class="flex items-center justify-between">
                <span class="text-slate-500">ประเภท:</span>
                <span class="font-bold text-rose-600">🔴 บันทึกออกงาน</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">เวลาออก:</span>
                <span class="font-semibold text-slate-800">${item.checkOut} น.</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">วันที่:</span>
                <span class="text-slate-700">${item.date}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-500">สถานที่:</span>
                <span class="text-slate-700 font-medium">${item.location || 'สำนักงานใหญ่'}</span>
              </div>
              <div class="flex items-center justify-between pt-1 border-t border-slate-100 mt-1">
                <span class="text-slate-400 font-mono text-[10px]">📍 ${rawOutLat.toFixed(4)}, ${rawOutLng.toFixed(4)}</span>
                <a href="${outGmapsLink}" target="_blank" class="inline-flex items-center gap-1 text-[10px] text-sky-600 hover:text-sky-800 font-semibold">
                  <span>เปิด Google Maps</span>
                  <i data-lucide="external-link" class="w-3 h-3"></i>
                </a>
              </div>
            </div>
          </div>
        `;

        const markerOut = L.marker([outLat, outLng], { icon: outIcon }).addTo(attendanceMapInstance);
        markerOut.bindPopup(popupOutHtml);
        markerOut.recordId = item.id;
        markerOut.pinType = 'out';
        attendanceMapMarkers.push(markerOut);
      }
    }
  });

  if (countInEl) countInEl.textContent = countIn;
  if (countOutEl) countOutEl.textContent = countOut;

  if (attendanceMapMarkers.length > 0) {
    if (overlay) overlay.classList.add('hidden');
    try {
      const group = L.featureGroup(attendanceMapMarkers);
      attendanceMapInstance.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
    } catch (e) {}
  } else {
    if (overlay) overlay.classList.remove('hidden');
  }

  setTimeout(() => {
    if (attendanceMapInstance) attendanceMapInstance.invalidateSize();
  }, 100);
}

window.focusAttendanceMapMarker = function(recordId, type = 'in') {
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const item = state.attendances.find(a => a.id === recordId);
  if (!isAdmin) {
    if (item && item.gps && item.gps.lat) {
      window.open(`https://www.google.com/maps?q=${item.gps.lat},${item.gps.lng}`, '_blank');
    }
    return;
  }

  // Scroll to map
  const mapContainer = document.getElementById('admin-map-container');
  if (mapContainer) {
    mapContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // If map is collapsed, uncollapse it
  if (isAttendanceMapCollapsed) {
    document.getElementById('btn-map-toggle-collapse')?.click();
  }

  // Find matching marker by recordId and pinType
  const marker = attendanceMapMarkers.find(m => m.recordId === recordId && m.pinType === type) ||
                 attendanceMapMarkers.find(m => m.recordId === recordId);
  if (marker && attendanceMapInstance) {
    setTimeout(() => {
      attendanceMapInstance.flyTo(marker.getLatLng(), 16, { duration: 0.8 });
      setTimeout(() => marker.openPopup(), 900);
    }, 300);
  } else {
    const targetGPS = (type === 'out' && item && item.checkOutGPS) ? item.checkOutGPS : (item && (item.checkInGPS || item.gps));
    if (targetGPS && targetGPS.lat) {
      window.open(`https://www.google.com/maps?q=${targetGPS.lat},${targetGPS.lng}`, '_blank');
    }
  }
};

function updateSelectedEmployeeCard() {
  const emp = state.employees.find(e => e.id === state.selectedEmpId);
  if (!emp) return;

  const avatarEl = document.getElementById('emp-avatar');
  const nameEl = document.getElementById('emp-name');
  const roleEl = document.getElementById('emp-role');
  const statusBadgeEl = document.getElementById('emp-status-badge');

  if (avatarEl) {
    avatarEl.textContent = emp.name.slice(0, 2);
  }
  if (nameEl) nameEl.textContent = emp.name;
  const startStr = emp.workStart || state.settings.startTime || '08:30';
  const endStr = emp.workEnd || state.settings.endTime || '17:30';
  if (roleEl) roleEl.innerHTML = `ID: ${emp.id} • ${emp.dept} <span class="text-sky-600 font-semibold font-mono">(${startStr}-${endStr} น.)</span>`;


  const todayStr = getTodayDateString();
  const todayRec = state.attendances.find(a => a.empId === emp.id && a.date === todayStr);

  if (!todayRec) {
    statusBadgeEl.innerHTML = `
      <span class="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-slate-200 text-slate-700">
        ยังไม่เข้างาน
      </span>
    `;
  } else if (todayRec.checkIn && !todayRec.checkOut) {
    const statusText = todayRec.status === 'LATE' ? 'มาสาย' : 'ตรงเวลา';
    const color = todayRec.status === 'LATE' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
    statusBadgeEl.innerHTML = `
      <span class="px-2 py-0.5 text-[11px] font-semibold rounded-full ${color}">
        เข้าแล้ว ${todayRec.checkIn.substring(0, 5)} น. (${statusText})
      </span>
    `;
  } else if (todayRec.checkIn && todayRec.checkOut) {
    statusBadgeEl.innerHTML = `
      <span class="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-100 text-blue-800">
        ออกงานแล้ว ${todayRec.checkOut.substring(0, 5)} น.
      </span>
    `;
  }
}

function updateKPICards() {
  const totalEmpEl = document.getElementById('kpi-total-employees');
  const checkedInEl = document.getElementById('kpi-checked-in');
  const checkedInRateEl = document.getElementById('kpi-checked-in-rate');
  const lateEl = document.getElementById('kpi-late');
  const absentEl = document.getElementById('kpi-absent');
  const statAvgIn = document.getElementById('stat-avg-in');
  const statWfhCount = document.getElementById('stat-wfh-count');
  const statOnTimeRate = document.getElementById('stat-on-time-rate');

  const todayStr = getTodayDateString();
  const isUser = state.currentUser && state.currentUser.role === 'user';

  if (isUser) {
    // Personal metrics for the logged-in employee
    const myEmpId = state.currentUser.empId;
    const myTodayRec = state.attendances.find(a => a.empId === myEmpId && a.date === todayStr);
    const myAllRecords = state.attendances.filter(a => a.empId === myEmpId);
    const myCheckedInToday = myTodayRec && myTodayRec.checkIn ? 1 : 0;
    const myLateTotal = myAllRecords.filter(a => a.status === 'LATE').length;
    const myOnTimeTotal = myAllRecords.filter(a => a.status === 'ON_TIME').length;

    if (totalEmpEl) totalEmpEl.textContent = '1';
    if (checkedInEl) checkedInEl.textContent = myCheckedInToday ? '1' : '0';
    if (checkedInRateEl) checkedInRateEl.textContent = myCheckedInToday ? 'เข้างานแล้ว' : 'ยังไม่เข้า';
    if (lateEl) lateEl.textContent = myLateTotal;
    if (absentEl) absentEl.textContent = myCheckedInToday ? '0' : '1';

    const myWfh = myAllRecords.filter(a => a.location === 'Work from Home').length;
    if (statWfhCount) statWfhCount.textContent = `${myWfh} ครั้ง`;

    if (myTodayRec && myTodayRec.checkIn) {
      if (statAvgIn) statAvgIn.textContent = `${myTodayRec.checkIn.substring(0, 5)} น.`;
    } else {
      if (statAvgIn) statAvgIn.textContent = '--:--';
    }

    const myTotalDays = myOnTimeTotal + myLateTotal;
    const onTimeRate = myTotalDays > 0 ? Math.round((myOnTimeTotal / myTotalDays) * 100) : 100;
    if (statOnTimeRate) statOnTimeRate.textContent = `${onTimeRate}%`;
    return;
  }

  // Admin: full organization overview
  const todayRecords = state.attendances.filter(a => a.date === todayStr);
  const total = state.employees.length;
  const currentEmpIds = new Set(state.employees.map(e => e.id));
  const activeTodayRecords = todayRecords.filter(a => currentEmpIds.has(a.empId));

  const checkedInEmpIds = new Set(activeTodayRecords.filter(a => a.checkIn).map(a => a.empId));
  const checkedIn = checkedInEmpIds.size;
  const rate = total > 0 ? Math.min(100, Math.round((checkedIn / total) * 100)) : 0;

  const lateEmpIds = new Set(activeTodayRecords.filter(a => a.status === 'LATE').map(a => a.empId));
  const late = lateEmpIds.size;
  const absent = Math.max(0, total - checkedIn);

  if (totalEmpEl) totalEmpEl.textContent = total;
  if (checkedInEl) checkedInEl.textContent = checkedIn;
  if (checkedInRateEl) checkedInRateEl.textContent = `${rate}%`;
  if (lateEl) lateEl.textContent = late;
  if (absentEl) absentEl.textContent = absent;

  const wfhCount = activeTodayRecords.filter(a => a.location === 'Work from Home').length;
  if (statWfhCount) statWfhCount.textContent = `${wfhCount} คน`;

  if (checkedIn > 0) {
    const onTimeCount = Math.max(0, checkedIn - late);
    const onTimePercentage = Math.round((onTimeCount / checkedIn) * 100);
    if (statOnTimeRate) statOnTimeRate.textContent = `${Math.max(0, onTimePercentage)}%`;

    let totalMinutes = 0;
    activeTodayRecords.forEach(r => {
      if (r.checkIn) {
        const [h, m] = r.checkIn.split(':').map(Number);
        totalMinutes += (h * 60 + m);
      }
    });
    const avgMin = Math.round(totalMinutes / (activeTodayRecords.length || 1));
    const avgH = String(Math.floor(avgMin / 60)).padStart(2, '0');
    const avgM = String(avgMin % 60).padStart(2, '0');
    if (statAvgIn) statAvgIn.textContent = `${avgH}:${avgM} น.`;
  } else {
    if (statOnTimeRate) statOnTimeRate.textContent = '100%';
    if (statAvgIn) statAvgIn.textContent = '--:--';
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendance-tbody');
  const emptyState = document.getElementById('table-empty-state');
  const countVisibleEl = document.getElementById('count-visible');
  if (!tbody) return;

  const searchQuery = (document.getElementById('filter-search')?.value || '').trim().toLowerCase();
  const employeeFilter = document.getElementById('filter-employee')?.value || 'ALL';
  const departmentFilter = document.getElementById('filter-department')?.value || 'ALL';
  const dateFilter = document.getElementById('filter-date')?.value || '';
  const statusFilter = document.getElementById('filter-status')?.value || 'ALL';

  const filtered = state.attendances.filter(item => {
    // Role filter: Regular employee can ONLY see their own records!
    if (state.currentUser && state.currentUser.role === 'user') {
      if (item.empId !== state.currentUser.empId) return false;
    }

    if (searchQuery) {
      const matchName = item.empName.toLowerCase().includes(searchQuery);
      const matchId = item.empId.toLowerCase().includes(searchQuery);
      const matchDept = item.dept.toLowerCase().includes(searchQuery);
      if (!matchName && !matchId && !matchDept) return false;
    }
    if (employeeFilter !== 'ALL' && item.empId !== employeeFilter) {
      return false;
    }
    if (departmentFilter !== 'ALL' && item.dept !== departmentFilter) {
      return false;
    }
    if (dateFilter && item.date !== dateFilter) {
      return false;
    }
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'WFH' && item.location !== 'Work from Home') return false;
      if (statusFilter === 'ON_TIME' && item.status !== 'ON_TIME') return false;
      if (statusFilter === 'LATE' && item.status !== 'LATE') return false;
      if (statusFilter === 'LEAVE' && item.status !== 'LEAVE') return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.checkIn || '').localeCompare(a.checkIn || '');
  });

  tbody.innerHTML = '';
  if (countVisibleEl) countVisibleEl.textContent = filtered.length;

  const isAdmin = state.currentUser && state.currentUser.role === 'admin';

  if (filtered.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (isAdmin) updateAttendanceMap([]);
    return;
  } else {
    if (emptyState) emptyState.classList.add('hidden');
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/80 transition-colors border-b border-slate-100';

    let badgeHtml = '';
    if (item.status === 'ON_TIME') {
      badgeHtml = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>ตรงเวลา
      </span>`;
    } else if (item.status === 'LATE') {
      badgeHtml = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>มาสาย
      </span>`;
    } else if (item.status === 'LEAVE') {
      badgeHtml = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
        <span class="w-1.5 h-1.5 rounded-full bg-purple-500 mr-1.5"></span>ลางาน
      </span>`;
    }

    let locBadge = item.location || 'สำนักงานใหญ่';
    let locIcon = 'building-2';
    if (locBadge === 'Work from Home') locIcon = 'home';
    if (locBadge === 'นอกสถานที่') locIcon = 'map-pin';

    const inGpsObj = item.checkInGPS || (item.checkIn ? (item.gps || detectBranchGPS(item)) : null);
    const outGpsObj = item.checkOutGPS || (item.checkOut ? (item.gps || item.checkInGPS || detectBranchGPS(item)) : null);

    let inGpsHtml = '';
    if (inGpsObj && inGpsObj.lat && inGpsObj.lng) {
      const inMapsUrl = `https://www.google.com/maps?q=${inGpsObj.lat},${inGpsObj.lng}`;
      const latFmt = !isNaN(parseFloat(inGpsObj.lat)) ? parseFloat(inGpsObj.lat).toFixed(4) : inGpsObj.lat;
      const lngFmt = !isNaN(parseFloat(inGpsObj.lng)) ? parseFloat(inGpsObj.lng).toFixed(4) : inGpsObj.lng;
      inGpsHtml = `
        <div class="flex items-center gap-1">
          <button onclick="focusAttendanceMapMarker('${item.id}', 'in')" title="คลิกเพื่อดูหมุดเข้างาน (เขียว) บนแผนที่" class="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 transition cursor-pointer">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span class="font-semibold">เข้า:</span>
            <span>${latFmt}, ${lngFmt}</span>
          </button>
          <a href="${inMapsUrl}" target="_blank" title="เปิด Google Maps (เวลาเข้า)" class="p-0.5 text-slate-400 hover:text-emerald-600 transition">
            <i data-lucide="external-link" class="w-3 h-3"></i>
          </a>
        </div>
      `;
    } else if (item.checkIn) {
      inGpsHtml = `<div class="text-[11px] text-slate-400 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span><span>เข้า: ไม่ระบุ</span></div>`;
    }

    let outGpsHtml = '';
    if (outGpsObj && outGpsObj.lat && outGpsObj.lng) {
      const outMapsUrl = `https://www.google.com/maps?q=${outGpsObj.lat},${outGpsObj.lng}`;
      const latFmt = !isNaN(parseFloat(outGpsObj.lat)) ? parseFloat(outGpsObj.lat).toFixed(4) : outGpsObj.lat;
      const lngFmt = !isNaN(parseFloat(outGpsObj.lng)) ? parseFloat(outGpsObj.lng).toFixed(4) : outGpsObj.lng;
      outGpsHtml = `
        <div class="flex items-center gap-1">
          <button onclick="focusAttendanceMapMarker('${item.id}', 'out')" title="คลิกเพื่อดูหมุดออกงาน (แดง) บนแผนที่" class="inline-flex items-center gap-1 text-[11px] font-mono text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 px-1.5 py-0.5 rounded border border-rose-200 transition cursor-pointer">
            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
            <span class="font-semibold">ออก:</span>
            <span>${latFmt}, ${lngFmt}</span>
          </button>
          <a href="${outMapsUrl}" target="_blank" title="เปิด Google Maps (เวลาออก)" class="p-0.5 text-slate-400 hover:text-rose-600 transition">
            <i data-lucide="external-link" class="w-3 h-3"></i>
          </a>
        </div>
      `;
    } else if (item.checkOut) {
      outGpsHtml = `<div class="text-[11px] text-slate-400 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span><span>ออก: ไม่ระบุ</span></div>`;
    }

    let gpsHtml = '<span class="text-slate-400 text-xs">-</span>';
    if (inGpsHtml || outGpsHtml) {
      gpsHtml = `<div class="flex flex-col gap-1 min-w-[170px]">${inGpsHtml}${outGpsHtml}</div>`;
    }

    let actionsHtml = '';
    if (isAdmin) {
      actionsHtml = `
        <div class="flex items-center justify-end gap-1">
          <button onclick="openEditAttendanceModal('${item.id}')" title="แก้ไขบันทึกเวลานี้" class="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition cursor-pointer">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteAttendanceRecord('${item.id}')" title="ลบรายการนี้" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      `;
    } else {
      actionsHtml = `
        <span class="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-100">
          <i data-lucide="lock" class="w-3 h-3 text-slate-400"></i>
          <span>ดูอย่างเดียว</span>
        </span>
      `;
    }

    tr.innerHTML = `
      <td class="px-3 py-3" data-label="พนักงาน">
        <div class="flex items-center gap-2">
          <div>
            <span class="font-bold text-slate-900 block text-xs sm:text-sm">${item.empName}</span>
            <span class="text-[11px] text-slate-400 font-mono">${item.empId}</span>
          </div>
        </div>
      </td>
      <td class="px-3 py-3 text-xs text-slate-600" data-label="แผนก">
        ${item.dept}
      </td>
      <td class="px-3 py-3 text-xs font-medium text-slate-700 whitespace-nowrap" data-label="วันที่">
        ${formatDisplayDate(item.date)}
      </td>
      <td class="px-3 py-3 text-xs font-bold font-mono text-emerald-600" data-label="เวลาเข้า">
        ${item.checkIn ? item.checkIn.substring(0, 5) + ' น.' : '-'}
      </td>
      <td class="px-3 py-3 text-xs font-bold font-mono text-rose-600" data-label="เวลาออก">
        ${item.checkOut ? item.checkOut.substring(0, 5) + ' น.' : '<span class="text-slate-400 font-normal">ยังไม่ออก</span>'}
      </td>
      <td class="px-3 py-3 text-xs text-slate-600" data-label="สถานที่">
        <span class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg text-[11px]">
          <i data-lucide="${locIcon}" class="w-3.5 h-3.5 text-slate-500"></i>
          <span>${locBadge}</span>
        </span>
      </td>
      <td class="px-3 py-3" data-label="พิกัด GPS">
        ${gpsHtml}
      </td>
      <td class="px-3 py-3" data-label="สถานะ">
        ${badgeHtml}
        ${item.note ? `<span class="block text-[10px] text-slate-400 mt-0.5 truncate max-w-[120px]" title="${item.note}">${item.note}</span>` : ''}
      </td>
      <td class="px-3 py-3 text-right no-print" data-label="จัดการ">
        ${actionsHtml}
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Update Leaflet Map with filtered records (Admin Only)
  if (isAdmin) {
    updateAttendanceMap(filtered);
  }

  lucide.createIcons();
}

function initCharts() {
  const doughnutCtx = document.getElementById('todayStatusChart')?.getContext('2d');
  const barCtx = document.getElementById('weeklyTrendsChart')?.getContext('2d');

  if (doughnutCtx) {
    todayChartInstance = new Chart(doughnutCtx, {
      type: 'doughnut',
      data: {
        labels: ['ตรงเวลา', 'มาสาย', 'ยังไม่เข้า / ขาด'],
        datasets: [{
          data: [0, 0, 0],
          backgroundColor: ['#10b981', '#f59e0b', '#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${item.raw} คน`
            }
          }
        }
      }
    });
  }

  if (barCtx) {
    weeklyChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'],
        datasets: [{
          label: 'ผู้เข้างาน (คน)',
          data: [0, 0, 0, 0, 0, 0, 0],
          backgroundColor: '#0ea5e9',
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#94a3b8', font: { family: 'Prompt', size: 10 } },
            grid: { color: '#f1f5f9' }
          },
          x: {
            ticks: { color: '#64748b', font: { family: 'Prompt', size: 11, weight: '500' } },
            grid: { display: false }
          }
        }
      }
    });
  }

  updateCharts();
}

function updateCharts() {
  const todayStr = getTodayDateString();
  const isUser = state.currentUser && state.currentUser.role === 'user';

  if (isUser) {
    const myEmpId = state.currentUser.empId;
    const myTodayRec = state.attendances.find(a => a.empId === myEmpId && a.date === todayStr);

    let onTime = 0, late = 0, pending = 1;
    if (myTodayRec && myTodayRec.checkIn) {
      pending = 0;
      if (myTodayRec.status === 'LATE') late = 1;
      else onTime = 1;
    }

    if (todayChartInstance) {
      todayChartInstance.data.datasets[0].data = [onTime, late, pending];
      todayChartInstance.update();
    }

    if (weeklyChartInstance) {
      const today = new Date();
      const daysLabel = [];
      const counts = [];
      const thaiShortDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dStr = getTodayDateString(d);
        daysLabel.push(thaiShortDays[d.getDay()]);

        const myDayRec = state.attendances.find(a => a.date === dStr && a.empId === myEmpId && a.checkIn);
        counts.push(myDayRec ? 1 : 0);
      }

      weeklyChartInstance.data.labels = daysLabel;
      weeklyChartInstance.data.datasets[0].data = counts;
      weeklyChartInstance.update();
    }
    return;
  }

  // Admin
  const todayRecords = state.attendances.filter(a => a.date === todayStr);
  const total = state.employees.length;
  const currentEmpIds = new Set(state.employees.map(e => e.id));
  const activeTodayRecords = todayRecords.filter(a => currentEmpIds.has(a.empId));

  const checkedInEmpIds = new Set(activeTodayRecords.filter(a => a.checkIn).map(a => a.empId));
  const checkedIn = checkedInEmpIds.size;
  const lateEmpIds = new Set(activeTodayRecords.filter(a => a.status === 'LATE').map(a => a.empId));
  const late = lateEmpIds.size;
  const onTime = Math.max(0, checkedIn - late);
  const pending = Math.max(0, total - checkedIn);

  if (todayChartInstance) {
    todayChartInstance.data.datasets[0].data = [onTime, late, pending];
    todayChartInstance.update();
  }

  if (weeklyChartInstance) {
    const today = new Date();
    const daysLabel = [];
    const counts = [];
    const thaiShortDays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dStr = getTodayDateString(d);
      daysLabel.push(thaiShortDays[d.getDay()]);

      const dayRecords = state.attendances.filter(a => a.date === dStr && a.checkIn && currentEmpIds.has(a.empId));
      const dayUniqueEmpIds = new Set(dayRecords.map(a => a.empId));
      counts.push(dayUniqueEmpIds.size);
    }

    weeklyChartInstance.data.labels = daysLabel;
    weeklyChartInstance.data.datasets[0].data = counts;
    weeklyChartInstance.update();
  }
}

function renderEmployeeRoster(filterText = '') {
  const list = document.getElementById('employee-roster-list');
  if (!list) return;

  const countBadge = document.getElementById('roster-count-badge');
  if (countBadge) {
    countBadge.textContent = `${state.employees.length} คน`;
  }

  const searchInput = document.getElementById('input-search-roster');
  const query = String(filterText || (searchInput ? searchInput.value : '')).trim().toLowerCase();

  const filtered = state.employees.filter(emp => {
    if (!query) return true;
    const combined = `${emp.name || ''} ${emp.id || ''} ${emp.dept || ''} ${emp.workStart || ''} ${emp.workEnd || ''}`.toLowerCase();
    return combined.includes(query);
  });

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="py-10 text-center text-slate-400">
        <i data-lucide="search-x" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
        <p class="text-xs font-semibold text-slate-600">ไม่พบข้อมูลพนักงานที่ตรงกับ "${query}"</p>
        <p class="text-[11px] text-slate-400 mt-0.5">ลองค้นหาด้วยชื่อ, แผนก หรือรหัสพนักงานอื่น</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filtered.forEach(emp => {
    const userAcc = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
    const pwd = userAcc ? userAcc.password : '1234';
    const startStr = emp.workStart || state.settings.startTime || '08:30';
    const endStr = emp.workEnd || state.settings.endTime || '17:30';

    const item = document.createElement('div');
    item.className = 'flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl border border-slate-200 bg-white hover:bg-sky-50/40 hover:border-sky-200 transition-all gap-2.5 shadow-2xs';
    item.innerHTML = `
      <div class="flex items-start sm:items-center gap-3">
        <div class="w-9 h-9 rounded-xl ${emp.color || 'bg-sky-600'} text-white font-bold flex items-center justify-center text-xs shrink-0 shadow-2xs">
          ${emp.name ? emp.name.substring(0, 2) : 'พน'}
        </div>
        <div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <h5 class="text-xs sm:text-sm font-bold text-slate-800">${emp.name}</h5>
            <span class="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 border border-sky-200" title="เวลาทำงานของพนักงานท่านนี้">
              <i data-lucide="clock" class="w-3 h-3 text-sky-500"></i> ${startStr} - ${endStr} น.
            </span>
          </div>
          <p class="text-[11px] text-slate-500 mt-0.5">${emp.id} • ${emp.dept}</p>
          <p class="text-[10px] text-indigo-600 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
            <span>👤 User: <strong class="font-bold text-slate-800">${emp.id}</strong></span>
            <span>|</span>
            <span>🔑 password: <strong class="font-bold text-slate-800">${pwd}</strong></span>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
        <button onclick="promptChangeEmployeeSchedule('${emp.id}')" title="กำหนดเวลาเข้างาน-ออกงาน" class="text-sky-700 bg-sky-50 hover:bg-sky-100 hover:text-sky-800 p-2 px-3 rounded-xl transition cursor-pointer flex items-center gap-1.5 border border-sky-200 text-xs font-semibold shadow-2xs">
          <i data-lucide="clock" class="w-4 h-4 text-sky-600"></i>
          <span>กำหนดเวลา</span>
        </button>
        <button onclick="promptChangeEmployeePassword('${emp.id}')" title="เปลี่ยนรหัสผ่านพนักงาน" class="text-slate-500 hover:text-amber-600 hover:bg-amber-50 p-2 rounded-xl transition cursor-pointer border border-transparent hover:border-slate-200">
          <i data-lucide="key" class="w-4 h-4"></i>
        </button>
        <button onclick="deleteEmployee('${emp.id}')" title="ลบพนักงาน" class="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-xl transition cursor-pointer border border-transparent hover:border-slate-200">
          <i data-lucide="trash" class="w-4 h-4"></i>
        </button>
      </div>
    `;
    list.appendChild(item);
  });
  lucide.createIcons();
}

// --- Punch Actions ---

async function handleClockIn() {
  const emp = state.employees.find(e => e.id === state.selectedEmpId);
  if (!emp) {
    showToast('ไม่พบข้อมูล', 'กรุณาเลือกพนักงานก่อนบันทึก', 'warning');
    return;
  }

  const todayStr = getTodayDateString();
  const existing = state.attendances.find(a => isSameEmpId(a.empId, emp.id) && isSameDate(a.date, todayStr));

  if (existing && existing.checkIn) {
    playSound('warning');
    showToast('ลงเวลาซ้ำ', `${emp.name} ได้ลงเวลาเข้างานวันนี้แล้วเมื่อ ${existing.checkIn.substring(0, 5)} น.`, 'warning');
    return;
  }

  let photo = null;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const checkInTime = `${hours}:${minutes}:${seconds}`;

  const targetStartTime = (emp.workStart && emp.workStart.includes(':')) ? emp.workStart : state.settings.startTime;
  const [targetH, targetM] = targetStartTime.split(':').map(Number);
  const grace = parseInt(state.settings.graceMinutes, 10) || 0;
  const targetTotalMin = targetH * 60 + targetM + grace;
  const currentTotalMin = now.getHours() * 60 + now.getMinutes();
  const isLate = currentTotalMin > targetTotalMin;

  const locRadio = document.querySelector('input[name="work_location"]:checked');
  const location = locRadio ? locRadio.value : 'สำนักงานใหญ่';
  const noteInput = document.getElementById('input-note');
  const note = noteInput ? noteInput.value.trim() : '';

  // 1. Acquire real-time fresh GPS directly at punch moment
  const freshGPS = await acquireFreshGPS(emp);
  let recordGPS = freshGPS;

  if (!recordGPS || !recordGPS.lat || recordGPS.lat === '13.7563') {
    if (currentGPS && currentGPS.lat && currentGPS.lat !== '13.7563') {
      recordGPS = currentGPS;
    } else {
      const branchInfo = detectBranchGPS(emp) || (location && detectBranchGPS(location));
      if (branchInfo) {
        recordGPS = { lat: branchInfo.lat, lng: branchInfo.lng, accuracy: 15 };
      } else {
        recordGPS = currentGPS || { lat: '13.7563', lng: '100.5018', accuracy: 20 };
      }
    }
  }

  const newRecord = {
    id: 'ATT-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    empId: emp.id,
    empName: emp.name,
    dept: emp.dept,
    date: todayStr,
    checkIn: checkInTime,
    checkOut: null,
    location: location,
    status: isLate ? 'LATE' : 'ON_TIME',
    photo: photo,
    gps: recordGPS,
    checkInGPS: recordGPS,
    checkOutGPS: null,
    note: note
  };

  saveAttendanceRecord(newRecord);

  playSound('success');
  if (!isLate && window.confetti) {
    window.confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.8 }
    });
  }

  if (noteInput) noteInput.value = '';

  const statusMsg = isLate ? 'เข้างานสาย (หลังเวลาที่กำหนด)' : 'เข้างานตรงเวลา ขอบคุณที่ตรงต่อเวลาครับ!';
  showToast('บันทึกเข้างานสำเร็จ!', `${emp.name} บันทึกพิกัด ${recordGPS.lat}, ${recordGPS.lng} เรียบร้อย (${statusMsg})`, isLate ? 'warning' : 'success');

  clearCapturedPhoto();
  refreshAllUI();
}

async function handleClockOut() {
  const emp = state.employees.find(e => e.id === state.selectedEmpId);
  if (!emp) {
    showToast('ไม่พบข้อมูล', 'กรุณาเลือกพนักงานก่อนบันทึก', 'warning');
    return;
  }

  const todayStr = getTodayDateString();
  // ค้นหารายการลงเวลาของพนักงานคนนี้ในวันนี้ (优先 แถวที่มีเวลาเข้าแล้วและยังไม่มีเวลาออก)
  let existing = state.attendances.find(a => isSameEmpId(a.empId, emp.id) && isSameDate(a.date, todayStr) && a.checkIn && !a.checkOut)
              || state.attendances.find(a => isSameEmpId(a.empId, emp.id) && isSameDate(a.date, todayStr));

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const checkOutTime = `${hours}:${minutes}:${seconds}`;

  let photo = null;

  // 1. Acquire real-time fresh GPS directly at punch moment
  const freshGPS = await acquireFreshGPS(emp);
  let recordGPS = freshGPS;

  if (!recordGPS || !recordGPS.lat || recordGPS.lat === '13.7563') {
    if (currentGPS && currentGPS.lat && currentGPS.lat !== '13.7563') {
      recordGPS = currentGPS;
    } else {
      const branchInfo = detectBranchGPS(emp) || (existing && existing.location && detectBranchGPS(existing.location));
      if (branchInfo) {
        recordGPS = { lat: branchInfo.lat, lng: branchInfo.lng, accuracy: 15 };
      } else {
        recordGPS = currentGPS || { lat: '13.7563', lng: '100.5018', accuracy: 20 };
      }
    }
  }

  if (!existing) {
    const confirmPunch = confirm(`${emp.name} ยังไม่มีข้อมูลลงเวลาเข้างานวันนี้\nคุณต้องการบันทึกเลิกงานทันทีหรือไม่?`);
    if (!confirmPunch) return;

    const locRadio = document.querySelector('input[name="work_location"]:checked');
    const location = locRadio ? locRadio.value : 'สำนักงานใหญ่';
    const noteInput = document.getElementById('input-note');
    const note = noteInput ? noteInput.value.trim() : '';

    const newRecord = {
      id: 'ATT-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      empId: emp.id,
      empName: emp.name,
      dept: emp.dept,
      date: todayStr,
      checkIn: null,
      checkOut: checkOutTime,
      location: location,
      status: 'ON_TIME',
      photo: photo,
      gps: recordGPS,
      checkInGPS: null,
      checkOutGPS: recordGPS,
      note: note ? `${note} (ไม่ได้ตอกเข้า)` : 'ไม่ได้ตอกเข้า'
    };

    saveAttendanceRecord(newRecord);
  } else {
    if (existing.checkOut) {
      const confirmOverwrite = confirm(`${emp.name} ได้ลงเวลาออกงานแล้วเมื่อ ${existing.checkOut.substring(0, 5)} น.\nต้องการอัปเดตเวลาออกงานใหม่หรือไม่?`);
      if (!confirmOverwrite) return;
    }
    existing.checkOut = checkOutTime;
    if (currentCapturedPhoto) {
      existing.photo = currentCapturedPhoto;
    }
    if (!existing.checkInGPS && existing.gps) {
      existing.checkInGPS = { ...existing.gps };
    }
    existing.checkOutGPS = recordGPS;
    existing.gps = existing.checkInGPS || recordGPS;
    if (existing.checkIn && existing.note && existing.note.includes('ไม่ได้ตอกเข้า')) {
      existing.note = existing.note.replace(' (ไม่ได้ตอกเข้า)', '').replace('ไม่ได้ตอกเข้า', '').trim();
    }
    updateAttendanceRecord(existing);
    state.attendances = mergeSplitAttendances(state.attendances);
    saveLocalData();
  }

  playSound('success');
  showToast('บันทึกออกงานสำเร็จ!', `${emp.name} ออกงานเวลา ${checkOutTime.substring(0, 5)} น. พิกัด ${recordGPS.lat}, ${recordGPS.lng} กลับบ้านปลอดภัยครับ!`, 'success');

  clearCapturedPhoto();
  refreshAllUI();
}

// Open Photo Viewer Modal
window.openPhotoViewer = function(recordId) {
  const item = state.attendances.find(a => a.id === recordId);
  if (!item) return;

  const modal = document.getElementById('modal-photo-viewer');
  const imgEl = document.getElementById('viewer-photo-img');
  const nameEl = document.getElementById('viewer-emp-name');
  const deptEl = document.getElementById('viewer-emp-dept');
  const dateEl = document.getElementById('viewer-date-text');
  const timeTag = document.getElementById('viewer-time-tag');
  const statusTag = document.getElementById('viewer-status-tag');
  const gpsEl = document.getElementById('viewer-gps-text');
  const locEl = document.getElementById('viewer-location-text');
  const mapsBtn = document.getElementById('viewer-maps-link');

  if (!modal) return;

  imgEl.src = item.photo || generateSampleAvatar(item.empName);
  nameEl.textContent = item.empName;
  deptEl.textContent = `${item.empId} • ${item.dept}`;
  dateEl.textContent = formatThaiDate(new Date(item.date));
  locEl.textContent = item.location || 'สำนักงานใหญ่';

  const checkInText = item.checkIn ? item.checkIn.substring(0, 5) : '-';
  const checkOutText = item.checkOut ? item.checkOut.substring(0, 5) : 'ยังไม่ออก';
  timeTag.textContent = `เข้า ${checkInText} น. | ออก ${checkOutText} น.`;

  if (item.status === 'LATE') {
    statusTag.textContent = 'มาสาย';
    statusTag.className = 'font-bold text-amber-400';
  } else {
    statusTag.textContent = 'ตรงเวลา';
    statusTag.className = 'font-bold text-emerald-400';
  }

  const inGps = item.checkInGPS || (item.checkIn ? item.gps : null);
  const outGps = item.checkOutGPS || (item.checkOut && !item.checkIn ? item.gps : null);

  let gpsParts = [];
  if (inGps && inGps.lat) {
    const latStr = !isNaN(parseFloat(inGps.lat)) ? parseFloat(inGps.lat).toFixed(4) : inGps.lat;
    const lngStr = !isNaN(parseFloat(inGps.lng)) ? parseFloat(inGps.lng).toFixed(4) : inGps.lng;
    gpsParts.push(`เข้า: ${latStr}, ${lngStr}`);
  }
  if (outGps && outGps.lat) {
    const latStr = !isNaN(parseFloat(outGps.lat)) ? parseFloat(outGps.lat).toFixed(4) : outGps.lat;
    const lngStr = !isNaN(parseFloat(outGps.lng)) ? parseFloat(outGps.lng).toFixed(4) : outGps.lng;
    gpsParts.push(`ออก: ${latStr}, ${lngStr}`);
  }

  if (gpsParts.length > 0) {
    gpsEl.textContent = gpsParts.join(' | ');
    const primaryGPS = outGps || inGps;
    mapsBtn.href = `https://www.google.com/maps?q=${primaryGPS.lat},${primaryGPS.lng}`;
    mapsBtn.classList.remove('hidden');
  } else if (item.gps && item.gps.lat && item.gps.lng) {
    gpsEl.textContent = `${item.gps.lat}, ${item.gps.lng} (±${item.gps.accuracy || 15}ม.)`;
    mapsBtn.href = `https://www.google.com/maps?q=${item.gps.lat},${item.gps.lng}`;
    mapsBtn.classList.remove('hidden');
  } else {
    gpsEl.textContent = 'ไม่มีพิกัดบันทึก';
    mapsBtn.classList.add('hidden');
  }

  modal.classList.remove('hidden');
};

// Edit attendance record (Admin Only)
window.openEditAttendanceModal = function(id) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลได้', 'warning');
    return;
  }

  const item = state.attendances.find(a => a.id === id);
  if (!item) return;

  const modal = document.getElementById('modal-edit-attendance');
  if (!modal) return;

  document.getElementById('edit-att-id').value = item.id;
  document.getElementById('edit-att-avatar').textContent = item.empName ? item.empName.slice(0, 2) : 'พ';
  document.getElementById('edit-att-name').textContent = item.empName;
  document.getElementById('edit-att-dept').textContent = `รหัส: ${item.empId} • ${item.dept}`;
  document.getElementById('edit-att-date').value = item.date || getTodayDateString();
  document.getElementById('edit-att-clock-in').value = item.checkIn ? item.checkIn.substring(0, 8) : '';
  document.getElementById('edit-att-clock-out').value = item.checkOut ? item.checkOut.substring(0, 8) : '';
  document.getElementById('edit-att-location').value = item.location || 'สำนักงานใหญ่';
  document.getElementById('edit-att-status').value = item.status || 'ON_TIME';
  document.getElementById('edit-att-note').value = item.note || '';

  // Populate GPS Coordinates (Check-In GPS & Check-Out GPS)
  let inLat = item.checkInGPS && item.checkInGPS.lat ? item.checkInGPS.lat : (item.gps && item.gps.lat ? item.gps.lat : '');
  let inLng = item.checkInGPS && item.checkInGPS.lng ? item.checkInGPS.lng : (item.gps && item.gps.lng ? item.gps.lng : '');
  let outLat = item.checkOutGPS && item.checkOutGPS.lat ? item.checkOutGPS.lat : '';
  let outLng = item.checkOutGPS && item.checkOutGPS.lng ? item.checkOutGPS.lng : '';

  // If inLat is default Bangkok (13.7563) or blank, suggest employee branch GPS
  if ((!inLat || inLat === '13.7563') && (!inLng || inLng === '100.5018')) {
    const branch = detectBranchGPS(item);
    if (branch) {
      inLat = branch.lat;
      inLng = branch.lng;
    }
  }

  // If employee has clocked out but outLat is missing, default to inLat
  if (item.checkOut && !outLat) {
    outLat = inLat;
    outLng = inLng;
  }

  const inLatInput = document.getElementById('edit-att-in-lat');
  const inLngInput = document.getElementById('edit-att-in-lng');
  const outLatInput = document.getElementById('edit-att-out-lat');
  const outLngInput = document.getElementById('edit-att-out-lng');
  const latInput = document.getElementById('edit-att-lat');
  const lngInput = document.getElementById('edit-att-lng');

  if (inLatInput) inLatInput.value = inLat || '';
  if (inLngInput) inLngInput.value = inLng || '';
  if (outLatInput) outLatInput.value = outLat || '';
  if (outLngInput) outLngInput.value = outLng || '';
  if (latInput) latInput.value = inLat || outLat || '';
  if (lngInput) lngInput.value = inLng || outLng || '';

  modal.classList.remove('hidden');
};

// Sync attendance edit directly to Google Sheets with automatic fallback for older GAS versions
async function syncEditAttendanceToGoogleSheet(item) {
  const url = getActiveGSheetUrl();
  if (!url) return;

  const inGpsPayload = item.checkInGPS || (item.gps ? { lat: item.gps.lat, lng: item.gps.lng } : null);
  const outGpsPayload = item.checkOutGPS || null;

  const recordPayload = {
    id: item.id,
    empId: item.empId,
    empName: item.empName,
    dept: item.dept,
    date: item.date,
    checkIn: item.checkIn || '',
    checkOut: item.checkOut || '',
    location: item.location || 'สำนักงานใหญ่',
    status: item.status || 'ON_TIME',
    note: item.note || '',
    photo: item.photo || '',
    gps: inGpsPayload || outGpsPayload || null,
    checkInGPS: inGpsPayload,
    checkOutGPS: outGpsPayload
  };

  try {
    // 1. Try modern editAttendance action
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'editAttendance',
        record: recordPayload
      })
    });
    const resJson = await res.json().catch(() => null);

    if (resJson && resJson.status === 'success') {
      console.log('Google Sheets: Updated attendance via editAttendance action');
      return true;
    }

    // If older Apps Script version is deployed (returns 'Unknown action')
    if (resJson && resJson.message === 'Unknown action') {
      console.warn('Google Sheets: editAttendance action not recognized. Running delete + clockIn fallback...');
      // Fallback Step A: Delete old row
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'deleteAttendance',
          id: item.id,
          empId: item.empId,
          date: item.date
        })
      });
      // Fallback Step B: Insert updated row with new times
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'clockIn',
          record: recordPayload
        })
      });
      console.log('Google Sheets: Attendance updated via delete + clockIn fallback');
      return true;
    }
  } catch (err) {
    console.warn('Google Sheets sync notice:', err);
    // Dual fallback via postToGoogleSheet (no-cors) to ensure update reaches Google Sheet
    postToGoogleSheet({
      action: 'editAttendance',
      record: recordPayload
    });
    postToGoogleSheet({
      action: 'deleteAttendance',
      id: item.id,
      empId: item.empId,
      date: item.date
    });
    setTimeout(() => {
      postToGoogleSheet({
        action: 'clockIn',
        record: recordPayload
      });
    }, 1000);
  }
  return true;
}

async function handleSaveEditAttendance(e) {
  e.preventDefault();
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลได้', 'warning');
    return;
  }

  const id = document.getElementById('edit-att-id').value;
  const item = state.attendances.find(a => a.id === id);
  if (!item) return;

  const newDate = document.getElementById('edit-att-date').value;
  const newIn = document.getElementById('edit-att-clock-in').value.trim();
  const newOut = document.getElementById('edit-att-clock-out').value.trim();
  const newLoc = document.getElementById('edit-att-location').value;
  const newStatus = document.getElementById('edit-att-status').value;
  const newNote = document.getElementById('edit-att-note').value.trim();
  
  const inLatVal = document.getElementById('edit-att-in-lat')?.value.trim() || document.getElementById('edit-att-lat')?.value.trim();
  const inLngVal = document.getElementById('edit-att-in-lng')?.value.trim() || document.getElementById('edit-att-lng')?.value.trim();
  const outLatVal = document.getElementById('edit-att-out-lat')?.value.trim();
  const outLngVal = document.getElementById('edit-att-out-lng')?.value.trim();

  item.date = newDate;
  item.checkIn = newIn ? (newIn.length === 5 ? `${newIn}:00` : newIn) : null;
  item.checkOut = newOut ? (newOut.length === 5 ? `${newOut}:00` : newOut) : null;
  item.location = newLoc;
  item.status = newStatus;
  item.note = newNote;

  // พิกัดเวลาเข้า-ออก ไม่สามารถแก้ไขได้: ล็อกยึดตามพิกัดที่มีการบันทึกครั้งแรกเท่านั้น
  const origInGPS = item.checkInGPS || (item.gps ? { lat: item.gps.lat, lng: item.gps.lng, accuracy: item.gps.accuracy || 10 } : null);
  const origOutGPS = item.checkOutGPS || null;
  item.checkInGPS = origInGPS;
  item.checkOutGPS = origOutGPS;
  item.gps = origInGPS || origOutGPS;

  saveLocalData();
  refreshAllUI();
  document.getElementById('modal-edit-attendance')?.classList.add('hidden');
  showToast('กำลังบันทึก...', `กำลังซิงค์เวลาและพิกัดใหม่ของ ${item.empName} ไปยัง Google Sheets`, 'warning');

  if (getActiveGSheetUrl()) {
    await syncEditAttendanceToGoogleSheet(item);
    setTimeout(async () => {
      await fetchGoogleSheetData(true);
    }, 2000);
  }

  if (isCloudConnected && firebaseDb) {
    firebaseDb.ref('attendances/' + item.id).set(item).catch(err => {
      console.warn('Firebase edit error:', err);
    });
  }

  showToast('แก้ไขข้อมูลสำเร็จ!', `อัปเดตเวลาเข้า-ออกของ ${item.empName} และซิงค์ลง Google Sheets เรียบร้อย`, 'success');
}

// Change employee work schedule (Admin Only)
window.promptChangeEmployeeSchedule = function(empId) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่กำหนดเวลาทำงานได้', 'warning');
    return;
  }

  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  const modal = document.getElementById('modal-employee-schedule');
  const empIdInput = document.getElementById('schedule-emp-id');
  const empNameEl = document.getElementById('schedule-emp-name');
  const startTimeInput = document.getElementById('schedule-start-time');
  const endTimeInput = document.getElementById('schedule-end-time');

  if (empIdInput) empIdInput.value = emp.id;
  if (empNameEl) empNameEl.textContent = `${emp.name} (${emp.id} • ${emp.dept})`;
  if (startTimeInput) startTimeInput.value = emp.workStart || state.settings.startTime || '08:30';
  if (endTimeInput) endTimeInput.value = emp.workEnd || state.settings.endTime || '17:30';

  if (modal) modal.classList.remove('hidden');
};

function handleSaveEmployeeSchedule(e) {
  e.preventDefault();
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่กำหนดเวลาทำงานได้', 'warning');
    return;
  }

  const empId = document.getElementById('schedule-emp-id')?.value;
  const startTime = document.getElementById('schedule-start-time')?.value || '08:30';
  const endTime = document.getElementById('schedule-end-time')?.value || '17:30';

  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  emp.workStart = startTime;
  emp.workEnd = endTime;

  saveLocalData();
  renderEmployeeRoster();
  updateSelectedEmployeeCard();

  document.getElementById('modal-employee-schedule')?.classList.add('hidden');
  showToast('บันทึกเวลาทำงานแล้ว!', `กำหนดเวลาของ ${emp.name} เป็น ${startTime} - ${endTime} น. (ซิงค์ลงชีทแล้ว)`, 'success');

  // Sync to Google Sheets
  if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
    postToGoogleSheet({
      action: 'updateEmployeeSchedule',
      empId: emp.id,
      workStart: startTime,
      workEnd: endTime
    });
  } else if (isCloudConnected && firebaseDb) {
    firebaseDb.ref('employees/' + emp.id).update({
      workStart: startTime,
      workEnd: endTime
    });
  }
}

// Prompt to change employee password (Admin Only)
window.promptChangeEmployeePassword = function(empId) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่เปลี่ยนรหัสผ่านได้', 'warning');
    return;
  }

  const emp = state.employees.find(e => e.id === empId);
  const userAcc = state.users.find(u => u.empId === empId || (u.username && u.username.toLowerCase() === empId.toLowerCase()));
  if (!emp || !userAcc) return;

  const newPwd = prompt(`ตั้งรหัสผ่านใหม่สำหรับคุณ ${emp.name} (${emp.id}):`, userAcc.password || '1234');
  if (newPwd !== null && newPwd.trim() !== '') {
    userAcc.password = newPwd.trim();
    saveUsersData();
    renderEmployeeRoster();

    // Sync to Google Sheets if connected
    if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
      postToGoogleSheet({
        action: 'updateEmployeePassword',
        empId: emp.id,
        password: newPwd.trim()
      });
    }

    showToast('เปลี่ยนรหัสผ่านสำเร็จ!', `รหัสผ่านใหม่ของ ${emp.name} คือ "${newPwd.trim()}" (ซิงค์ลง Google Sheets แล้ว)`, 'success');
  }
};

// Delete attendance record (Admin Only)
window.deleteAttendanceRecord = function(id) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลได้', 'warning');
    return;
  }
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการบันทึกเวลานี้?')) return;
  removeAttendanceRecord(id);
  showToast('ลบสำเร็จ', 'ลบรายการบันทึกเวลาและซิงค์ลง Google Sheets เรียบร้อยแล้ว', 'success');
  refreshAllUI();
};

// Delete employee (Admin Only)
window.deleteEmployee = function(id) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    showToast('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบพนักงานได้', 'warning');
    return;
  }
  if (state.employees.length <= 1) {
    alert('ต้องมีพนักงานในระบบอย่างน้อย 1 ท่านครับ');
    return;
  }
  if (!confirm('คุณต้องการลบพนักงานท่านนี้ใช่หรือไม่? ประวัติการเข้างานจะยังคงอยู่')) return;
  state.employees = state.employees.filter(e => e.id !== id);
  state.users = state.users.filter(u => u.empId !== id && u.id !== id);
  saveUsersData();

  if (state.selectedEmpId === id) {
    state.selectedEmpId = state.employees[0].id;
  }
  saveLocalData();
  if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
    postToGoogleSheet({ action: 'deleteEmployee', id });
  } else if (isCloudConnected && firebaseDb) {
    firebaseDb.ref('employees/' + id).remove();
  }
  renderEmployeeDropdown();
  renderEmployeeRoster();
  refreshAllUI();
  showToast('ลบพนักงานสำเร็จ', 'ลบออกจากแท็บ "รายชื่อพนักงาน" ใน Google Sheets เรียบร้อยแล้ว', 'success');
};

function refreshAllUI() {
  renderFilterDropdowns();
  updateSelectedEmployeeCard();
  updateKPICards();
  renderAttendanceTable();
  updateCharts();
}

// --- CSV Export with GPS & UTF-8 BOM ---
function exportToCSV() {
  let records = state.attendances;
  if (state.currentUser && state.currentUser.role === 'user') {
    records = records.filter(a => a.empId === state.currentUser.empId);
  }

  if (records.length === 0) {
    showToast('ไม่มีข้อมูล', 'ไม่มีประวัติการบันทึกเวลาให้ส่งออก', 'warning');
    return;
  }

  const headers = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'แผนก', 'วันที่', 'เวลาเข้า', 'เวลาออก', 'สถานที่', 'ละติจูด (Lat)', 'ลองจิจูด (Lng)', 'ลิงก์ Google Maps', 'สถานะ', 'หมายเหตุ'];
  
  const rows = records.map(a => {
    let statusTh = 'ตรงเวลา';
    if (a.status === 'LATE') statusTh = 'มาสาย';
    if (a.status === 'LEAVE') statusTh = 'ลางาน';

    const lat = a.gps ? a.gps.lat : '-';
    const lng = a.gps ? a.gps.lng : '-';
    const mapsLink = a.gps ? `https://www.google.com/maps?q=${lat},${lng}` : '-';

    return [
      `"${a.empId}"`,
      `"${a.empName}"`,
      `"${a.dept}"`,
      `"${a.date}"`,
      `"${a.checkIn || '-'}"`,
      `"${a.checkOut || '-'}"`,
      `"${a.location || '-'}"`,
      `"${lat}"`,
      `"${lng}"`,
      `"${mapsLink}"`,
      `"${statusTh}"`,
      `"${(a.note || '').replace(/"/g, '""')}"`
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `รายงานบันทึกเวลา_พร้อมพิกัด_${getTodayDateString()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('ส่งออกสำเร็จ!', 'ดาวน์โหลดไฟล์ Excel (CSV) พร้อมพิกัด GPS เรียบร้อย', 'success');
}

// Clean Orphaned Attendances (Remove records for deleted employees)
function cleanOrphanedAttendances() {
  const validEmpIds = new Set(state.employees.map(e => e.id));
  const beforeCount = state.attendances.length;
  state.attendances = state.attendances.filter(a => validEmpIds.has(a.empId));
  saveLocalData();
  if (isCloudConnected && firebaseDb) {
    const cleanMap = {};
    state.attendances.forEach(a => {
      cleanMap[a.id] = a;
    });
    firebaseDb.ref('attendances').set(cleanMap).catch(err => {
      console.warn('Failed to clean attendances in cloud:', err);
    });
  }
  refreshAllUI();
}

// --- Modal Utilities ---
function setupModals() {
  const modalRoster = document.getElementById('modal-employee-roster');
  const modalEmp = document.getElementById('modal-employees');
  const modalSet = document.getElementById('modal-settings');
  const modalManual = document.getElementById('modal-manual-entry');
  const modalViewer = document.getElementById('modal-photo-viewer');
  const modalCloud = document.getElementById('modal-cloud-sync');
  const modalEditAtt = document.getElementById('modal-edit-attendance');
  const modalSchedule = document.getElementById('modal-employee-schedule');

  // Open Schedule & Employee Roster Modal (หน้าต่างกำหนดเวลาทำงานและรายชื่อพนักงาน)
  const openRosterModal = () => {
    renderEmployeeRoster();
    if (modalRoster) modalRoster.classList.remove('hidden');
    lucide.createIcons();
  };

  const openAddEmployeeModal = () => {
    const qStart = document.getElementById('quick-setting-start-time');
    const qEnd = document.getElementById('quick-setting-end-time');
    if (qStart) qStart.value = state.settings.startTime || '08:30';
    if (qEnd) qEnd.value = state.settings.endTime || '17:30';
    if (modalRoster) modalRoster.classList.add('hidden');
    if (modalEmp) modalEmp.classList.remove('hidden');
    lucide.createIcons();
  };

  // Cloud Modal Openers
  const openCloudModal = () => {
    // Populate Google Sheet URL
    const gsheetInput = document.getElementById('input-gsheet-url');
    if (gsheetInput) {
      gsheetInput.value = getActiveGSheetUrl() || '';
    }

    // Populate current Firebase config if any
    const saved = localStorage.getItem(STORAGE_CLOUD_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const dbUrlInput = document.getElementById('input-cloud-dburl');
        if (dbUrlInput) dbUrlInput.value = parsed.databaseURL || '';
        const apiKeyInput = document.getElementById('input-cloud-apikey');
        if (apiKeyInput) apiKeyInput.value = parsed.apiKey || '';
        const projInput = document.getElementById('input-cloud-projectid');
        if (projInput) projInput.value = parsed.projectId || '';
      } catch (e) { }
    } else if (window.DEFAULT_FIREBASE_CONFIG) {
      const dbUrlInput = document.getElementById('input-cloud-dburl');
      if (dbUrlInput) dbUrlInput.value = window.DEFAULT_FIREBASE_CONFIG.databaseURL || '';
    }
    modalCloud.classList.remove('hidden');
  };

  document.getElementById('btn-cloud-status')?.addEventListener('click', openCloudModal);
  document.getElementById('btn-open-cloud-modal')?.addEventListener('click', openCloudModal);
  document.getElementById('btn-mobile-open-cloud')?.addEventListener('click', openCloudModal);

  // Buttons that open the Employee Schedule & Roster Modal (ตรงที่วง)
  document.getElementById('btn-open-schedule')?.addEventListener('click', openRosterModal);
  document.getElementById('btn-open-employees')?.addEventListener('click', openRosterModal);
  document.getElementById('kpi-card-employees')?.addEventListener('click', () => {
    if (state.currentUser && state.currentUser.role === 'admin') {
      openRosterModal();
    }
  });

  // Switch between Roster & Add Employee modals
  document.getElementById('btn-roster-open-add-emp')?.addEventListener('click', openAddEmployeeModal);
  document.getElementById('btn-emp-open-roster')?.addEventListener('click', () => {
    if (modalEmp) modalEmp.classList.add('hidden');
    openRosterModal();
  });
  document.getElementById('btn-roster-open-settings')?.addEventListener('click', () => {
    if (modalRoster) modalRoster.classList.add('hidden');
    document.getElementById('btn-open-settings')?.click();
  });

  // Search input in employee roster modal
  const rosterSearchInput = document.getElementById('input-search-roster');
  if (rosterSearchInput) {
    rosterSearchInput.addEventListener('input', (e) => {
      renderEmployeeRoster(e.target.value.trim());
    });
  }

  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    document.getElementById('setting-start-time').value = state.settings.startTime;
    document.getElementById('setting-end-time').value = state.settings.endTime;
    document.getElementById('setting-grace-minutes').value = state.settings.graceMinutes;
    modalSet.classList.remove('hidden');
  });

  document.getElementById('btn-open-manual-entry')?.addEventListener('click', () => {
    document.getElementById('manual-date').value = getTodayDateString();
    document.getElementById('manual-clock-in').value = '08:25';
    document.getElementById('manual-clock-out').value = '17:35';
    if (currentGPS) {
      document.getElementById('manual-lat').value = currentGPS.lat;
      document.getElementById('manual-lng').value = currentGPS.lng;
    }
    modalManual.classList.remove('hidden');
  });

  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentModal = btn.closest('.fixed.inset-0');
      if (parentModal) {
        parentModal.classList.add('hidden');
      } else {
        if (modalRoster) modalRoster.classList.add('hidden');
        modalEmp.classList.add('hidden');
        modalSet.classList.add('hidden');
        modalManual.classList.add('hidden');
        modalViewer.classList.add('hidden');
        modalCloud.classList.add('hidden');
        if (modalEditAtt) modalEditAtt.classList.add('hidden');
        if (modalSchedule) modalSchedule.classList.add('hidden');
      }
    });
  });

  [modalRoster, modalEmp, modalSet, modalManual, modalViewer, modalCloud, modalEditAtt, modalSchedule].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // Save Google Sheets Configuration
  document.getElementById('btn-save-gsheet-config')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('input-gsheet-url');
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
      alert('กรุณากรอก Google Apps Script Web App URL ครับ');
      return;
    }
    if (!url.startsWith('https://script.google.com/macros/s/')) {
      if (!confirm('URL ดูเหมือนจะไม่ใช่ Google Apps Script Web App URL ที่ถูกต้อง (URL ควรขึ้นต้นด้วย https://script.google.com/macros/s/...)\n\nต้องการบันทึกและลองเชื่อมต่อหรือไม่?')) {
        return;
      }
    }

    localStorage.setItem(STORAGE_GSHEET_KEY, url);
    modalCloud.classList.add('hidden');
    showToast('กำลังเชื่อมต่อ Google Sheets...', 'ระบบกำลังดึงข้อมูลพนักงานและการบันทึกเวลา', 'warning');
    await initDatabaseSync();
    showToast('เชื่อมต่อ Google Sheets สำเร็จ!', 'ข้อมูลพร้อมซิงค์ข้ามทุกอุปกรณ์เรียบร้อยแล้ว', 'success');
  });

  // Upload Local Data to Google Sheets
  document.getElementById('btn-upload-local-to-sheet')?.addEventListener('click', () => {
    if (!confirm('ต้องการส่งรายชื่อพนักงานและประวัติการลงเวลาทั้งหมดที่มีในเครื่องนี้ขึ้นไปเก็บใน Google Sheets ใช่หรือไม่?')) return;
    uploadLocalDataToGoogleSheet();
  });

  // Save Cloud Configuration (Firebase)
  document.getElementById('btn-save-cloud-config')?.addEventListener('click', () => {
    let configObj = null;
    const jsonVal = document.getElementById('input-cloud-json')?.value.trim();
    if (jsonVal) {
      try {
        configObj = JSON.parse(jsonVal);
      } catch (e) {
        alert('รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งครับ');
        return;
      }
    } else {
      const dbUrl = document.getElementById('input-cloud-dburl')?.value.trim();
      const apiKey = document.getElementById('input-cloud-apikey')?.value.trim();
      const projectId = document.getElementById('input-cloud-projectid')?.value.trim();

      if (!dbUrl) {
        alert('กรุณาระบุ Database URL ของ Firebase ครับ');
        return;
      }

      configObj = {
        apiKey: apiKey || 'AIzaSyDemoKey',
        databaseURL: dbUrl,
        projectId: projectId || 'timetrack-cloud'
      };
    }

    localStorage.setItem(STORAGE_CLOUD_KEY, JSON.stringify(configObj));
    initDatabaseSync();
    modalCloud.classList.add('hidden');
    showToast('เชื่อมต่อคลาวด์แล้ว!', 'ระบบจะซิงค์ข้อมูลกับมือถือและคอมพิวเตอร์เครื่องอื่นแบบเรียลไทม์', 'success');
  });

  // Disconnect Cloud / Google Sheets
  document.getElementById('btn-disconnect-cloud')?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_CLOUD_KEY);
    localStorage.removeItem(STORAGE_GSHEET_KEY);
    if (gsheetPollTimer) {
      clearInterval(gsheetPollTimer);
      gsheetPollTimer = null;
    }
    activeBackend = 'local';
    isCloudConnected = false;
    updateDatabaseStatusUI('local', 'โหมดในเครื่อง (ออฟไลน์)');
    modalCloud.classList.add('hidden');
    showToast('ตัดการเชื่อมต่อคลาวด์', 'กลับมาใช้ข้อมูลในเครื่อง LocalStorage', 'warning');
  });

  // Copy Mobile Share Link with auto cloud config / gsheet URL
  document.getElementById('btn-copy-mobile-link')?.addEventListener('click', () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const gsheetUrl = getActiveGSheetUrl();

    let shareUrl = '';
    let shareDesc = '';

    if (gsheetUrl) {
      shareUrl = `${origin}${pathname}#gsheetUrl=${encodeURIComponent(gsheetUrl)}`;
      shareDesc = 'Google Sheets กลาง';
    } else {
      let configObj = null;
      const saved = localStorage.getItem(STORAGE_CLOUD_KEY);
      if (saved) {
        try { configObj = JSON.parse(saved); } catch (e) {}
      }
      if ((!configObj || !configObj.databaseURL) && window.DEFAULT_FIREBASE_CONFIG && window.DEFAULT_FIREBASE_CONFIG.databaseURL) {
        configObj = window.DEFAULT_FIREBASE_CONFIG;
      }

      if (configObj && configObj.databaseURL) {
        const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(configObj)))));
        shareUrl = `${origin}${pathname}#cloudConfig=${encoded}`;
        shareDesc = 'Firebase Cloud';
      }
    }

    if (!shareUrl) {
      alert('กรุณาบันทึกและเชื่อมต่อ Google Sheets หรือ Firebase บนเครื่องนี้ก่อนคัดลอกลิงก์ครับ');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('คัดลอกลิงก์แล้ว!', 'ส่งลิงก์นี้เข้า LINE เพื่อเปิดบนมือถือ จะซิงค์ข้อมูลทันที', 'success');
        alert(`คัดลอกลิงก์สำเร็จ!\n\nส่งลิงก์นี้ไปเปิดบนมือถือหรือเครื่องอื่นๆ:\n\n${shareUrl}\n\nเมื่อเปิดบนมือถือจะเชื่อมต่อฐานข้อมูล (${shareDesc}) เดียวกันทันที โดยไม่ต้องตั้งค่าในมือถือครับ`);
      }).catch(() => {
        prompt('คัดลอกลิงก์นี้ไปเปิดบนมือถือ:', shareUrl);
      });
    } else {
      prompt('คัดลอกลิงก์นี้ไปเปิดบนมือถือ:', shareUrl);
    }
  });

  // Clean Orphaned Attendance Data
  document.getElementById('btn-clean-orphaned-data')?.addEventListener('click', () => {
    if (!confirm('ต้องการล้างประวัติการลงเวลาที่ไม่ตรงกับรายชื่อพนักงานปัจจุบันใช่หรือไม่?')) return;
    cleanOrphanedAttendances();
    showToast('ทำความสะอาดข้อมูลแล้ว', 'ลบประวัติตกค้างที่ไม่มีในรายชื่อพนักงานเรียบร้อย', 'success');
  });

  // Form: Add Employee
  document.getElementById('form-add-employee')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const idInput = document.getElementById('new-emp-id');
    const nameInput = document.getElementById('new-emp-name');
    const deptInput = document.getElementById('new-emp-dept');
    const pwdInput = document.getElementById('new-emp-password');

    const id = idInput.value.trim().toUpperCase();
    const name = nameInput.value.trim();
    const dept = deptInput.value.trim();
    const password = pwdInput ? (pwdInput.value.trim() || '1234') : '1234';
    const workStart = document.getElementById('new-emp-start')?.value || state.settings.startTime || '08:30';
    const workEnd = document.getElementById('new-emp-end')?.value || state.settings.endTime || '17:30';

    if (state.employees.some(emp => emp.id === id)) {
      alert('รหัสพนักงานนี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น');
      return;
    }

    const newEmp = {
      id,
      name,
      dept,
      color: 'bg-sky-600',
      username: id,
      password,
      workStart,
      workEnd
    };
    state.employees.push(newEmp);
    saveLocalData();

    // Create user account for the new employee
    state.users.push({
      id,
      username: id,
      role: 'user',
      name,
      empId: id,
      dept,
      password
    });
    saveUsersData();

    if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
      postToGoogleSheet({ action: 'addEmployee', employee: newEmp });
      setTimeout(() => {
        postToGoogleSheet({
          action: 'syncEmployees',
          employees: state.employees.map(emp => {
            const u = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
            return {
              ...emp,
              password: u ? u.password : (emp.password || '1234')
            };
          })
        });
      }, 400);
    } else if (isCloudConnected && firebaseDb) {
      firebaseDb.ref('employees/' + id).set(newEmp);
    }

    idInput.value = '';
    nameInput.value = '';
    deptInput.value = '';
    if (pwdInput) pwdInput.value = '';
    const startInp = document.getElementById('new-emp-start');
    const endInp = document.getElementById('new-emp-end');
    if (startInp) startInp.value = state.settings.startTime || '08:30';
    if (endInp) endInp.value = state.settings.endTime || '17:30';

    renderEmployeeDropdown();
    renderEmployeeRoster();
    updateKPICards();
    updateCharts();
    const modalEmp = document.getElementById('modal-employees');
    const modalRoster = document.getElementById('modal-employee-roster');
    if (modalEmp) modalEmp.classList.add('hidden');
    if (modalRoster) modalRoster.classList.remove('hidden');
    showToast('เพิ่มพนักงานสำเร็จ!', `เพิ่มคุณ ${name} เวลาทำงาน ${workStart} - ${workEnd} น. (ซิงค์ลง Google Sheets เรียบร้อย)`, 'success');
  });

  // Button: Sync Roster to Google Sheet Immediately
  document.getElementById('btn-sync-roster-to-sheet')?.addEventListener('click', () => {
    const url = getActiveGSheetUrl();
    if (!url) {
      alert('ยังไม่ได้เชื่อมต่อ Google Sheets กรุณาตรวจสอบการตั้งค่าเชื่อมต่อชีตครับ');
      return;
    }
    showToast('กำลังซิงค์...', 'กำลังส่งรายชื่อพนักงานทั้งหมดขึ้น Google Sheets', 'warning');
    const empPayload = state.employees.map(emp => {
      const u = state.users.find(u => u.empId === emp.id || (u.username && u.username.toLowerCase() === emp.id.toLowerCase()));
      return {
        ...emp,
        password: u ? u.password : (emp.password || '1234')
      };
    });
    postToGoogleSheet({ action: 'syncEmployees', employees: empPayload });
    postToGoogleSheet({ action: 'syncAll', employees: empPayload, attendances: state.attendances });
    setTimeout(async () => {
      await fetchGoogleSheetData(true);
      showToast('ซิงค์สำเร็จ!', `ส่งข้อมูลพนักงานทั้ง ${state.employees.length} คนขึ้น Google Sheets เรียบร้อย`, 'success');
    }, 1500);
  });

  // Form: Edit Employee Work Schedule Modal
  document.getElementById('form-edit-employee-schedule')?.addEventListener('submit', handleSaveEmployeeSchedule);

  // Button: Save Quick System Work Hours
  document.getElementById('btn-save-quick-work-hours')?.addEventListener('click', () => {
    const sTime = document.getElementById('quick-setting-start-time')?.value || '08:30';
    const eTime = document.getElementById('quick-setting-end-time')?.value || '17:30';

    state.settings.startTime = sTime;
    state.settings.endTime = eTime;

    const setStart = document.getElementById('setting-start-time');
    const setEnd = document.getElementById('setting-end-time');
    if (setStart) setStart.value = sTime;
    if (setEnd) setEnd.value = eTime;

    saveLocalData();
    if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
      postToGoogleSheet({ action: 'saveSettings', settings: state.settings });
    } else if (isCloudConnected && firebaseDb) {
      firebaseDb.ref('settings').set(state.settings);
    }

    updateSettingLabels();
    renderEmployeeRoster();
    showToast('บันทึกเวลามาตรฐานแล้ว', `เวลาเข้างานปกติ ${sTime} น. / เลิกงาน ${eTime} น. (ซิงค์ลงชีทแล้ว)`, 'success');
  });

  // Admin Change Own Password Button
  document.getElementById('btn-save-admin-pwd')?.addEventListener('click', () => {
    const input = document.getElementById('input-new-admin-pwd');
    const newPwd = (input?.value || '').trim();
    if (!newPwd) {
      alert('กรุณากรอกรหัสผ่านใหม่ของ Admin');
      return;
    }
    let admin = state.users.find(u => u.username && u.username.toLowerCase() === 'chana.p') || state.users.find(u => u.role === 'admin');
    if (admin) {
      admin.password = newPwd;
      saveUsersData();
      if (input) input.value = '';
      showToast('เปลี่ยนรหัสผ่านสำเร็จ!', 'รหัสผ่านใหม่ของ Admin (chana.p) บันทึกเรียบร้อยแล้ว', 'success');
    }
  });

  // Save Settings
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    state.settings.startTime = document.getElementById('setting-start-time').value || '08:30';
    state.settings.endTime = document.getElementById('setting-end-time').value || '17:30';
    state.settings.graceMinutes = parseInt(document.getElementById('setting-grace-minutes').value, 10) || 0;

    saveLocalData();
    if (activeBackend === 'gsheet' || getActiveGSheetUrl()) {
      postToGoogleSheet({ action: 'saveSettings', settings: state.settings });
    } else if (isCloudConnected && firebaseDb) {
      firebaseDb.ref('settings').set(state.settings);
    }

    updateSettingLabels();
    modalSet.classList.add('hidden');
    showToast('บันทึกการตั้งค่าแล้ว', 'เวลาเข้างานอัปเดตเรียบร้อย', 'success');
  });

  // Reset Demo Data
  document.getElementById('btn-reset-demo-data')?.addEventListener('click', () => {
    if (!confirm('ต้องการล้างข้อมูลทั้งหมดแล้วกู้คืนชุดตัวอย่างเริ่มต้นใช่หรือไม่?')) return;
    localStorage.removeItem(STORAGE_EMP_KEY);
    localStorage.removeItem(STORAGE_ATT_KEY);
    localStorage.removeItem(STORAGE_SET_KEY);
    localStorage.removeItem(STORAGE_USERS_KEY);
    localStorage.removeItem(STORAGE_SESSION_KEY);
    sessionStorage.removeItem(STORAGE_SESSION_KEY);
    location.reload();
  });

  // Form: Manual Entry
  document.getElementById('form-manual-entry')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const empId = document.getElementById('manual-emp-select').value;
    const date = document.getElementById('manual-date').value;
    const location = document.getElementById('manual-location').value;
    const checkIn = document.getElementById('manual-clock-in').value;
    const checkOut = document.getElementById('manual-clock-out').value;
    const lat = document.getElementById('manual-lat').value.trim() || '13.7563';
    const lng = document.getElementById('manual-lng').value.trim() || '100.5018';
    const statusChoice = document.getElementById('manual-status').value;
    const note = document.getElementById('manual-note').value.trim();

    const emp = state.employees.find(emp => emp.id === empId);
    if (!emp) return;

    let computedStatus = statusChoice;
    if (statusChoice === 'AUTO') {
      const [h, m] = checkIn.split(':').map(Number);
      const [sh, sm] = state.settings.startTime.split(':').map(Number);
      computedStatus = (h * 60 + m) > (sh * 60 + sm + state.settings.graceMinutes) ? 'LATE' : 'ON_TIME';
    }

    const record = {
      id: 'ATT-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      empId: emp.id,
      empName: emp.name,
      dept: emp.dept,
      date: date,
      checkIn: checkIn ? `${checkIn}:00` : null,
      checkOut: checkOut ? `${checkOut}:00` : null,
      location: location,
      status: computedStatus,
      photo: generateSampleAvatar(emp.name),
      gps: { lat, lng, accuracy: 10 },
      note: note ? `${note} (บันทึกย้อนหลัง)` : 'บันทึกย้อนหลัง'
    };

    saveAttendanceRecord(record);
    modalManual.classList.add('hidden');
    document.getElementById('form-manual-entry').reset();
    showToast('บันทึกย้อนหลังสำเร็จ!', `บันทึกข้อมูลของ ${emp.name} เรียบร้อย`, 'success');
    refreshAllUI();
  });

  // Form: Edit Attendance Record (Admin Only)
  document.getElementById('form-edit-attendance')?.addEventListener('submit', handleSaveEditAttendance);

  // Edit Modal GPS Preset Buttons Helper
  function applyEditModalPreset(branch) {
    const inLat = document.getElementById('edit-att-in-lat');
    const inLng = document.getElementById('edit-att-in-lng');
    const outLat = document.getElementById('edit-att-out-lat');
    const outLng = document.getElementById('edit-att-out-lng');
    const lat = document.getElementById('edit-att-lat');
    const lng = document.getElementById('edit-att-lng');

    if (inLat) inLat.value = branch.lat;
    if (inLng) inLng.value = branch.lng;
    if (outLat) outLat.value = branch.lat;
    if (outLng) outLng.value = branch.lng;
    if (lat) lat.value = branch.lat;
    if (lng) lng.value = branch.lng;
    showToast('เลือกพิกัดแล้ว', `📍 ${branch.name} (${branch.lat}, ${branch.lng})`, 'success');
  }

  document.getElementById('btn-preset-rangsit')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.RANGSIT));
  document.getElementById('btn-preset-sainoi')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.SAINOI));
  document.getElementById('btn-preset-charan')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.CHARAN));
  document.getElementById('btn-preset-rama2')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.RAMA2));
  document.getElementById('btn-preset-lamlukka')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.LAMLUKKA));
  document.getElementById('btn-preset-hq')?.addEventListener('click', () => applyEditModalPreset(BRANCH_LOCATIONS.HQ));

  // Copy In GPS to Out GPS
  document.getElementById('btn-copy-in-to-out-gps')?.addEventListener('click', () => {
    const inLat = document.getElementById('edit-att-in-lat')?.value.trim() || document.getElementById('edit-att-lat')?.value.trim();
    const inLng = document.getElementById('edit-att-in-lng')?.value.trim() || document.getElementById('edit-att-lng')?.value.trim();
    const outLat = document.getElementById('edit-att-out-lat');
    const outLng = document.getElementById('edit-att-out-lng');
    if (inLat && inLng) {
      if (outLat) outLat.value = inLat;
      if (outLng) outLng.value = inLng;
      showToast('คัดลอกพิกัดแล้ว', `คัดลอกพิกัดเวลาเข้างาน (${inLat}, ${inLng}) ไปยังพิกัดเวลาออกงานแล้ว`, 'success');
    } else {
      showToast('ไม่มีพิกัดเข้างาน', 'กรุณาระบุพิกัดเข้างานก่อนกดคัดลอก', 'warning');
    }
  });

  document.getElementById('btn-edit-get-current-gps')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      showToast('กำลังดึง GPS...', 'กำลังขอพิกัดปัจจุบันจากอุปกรณ์...', 'warning');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latVal = pos.coords.latitude.toFixed(5);
          const lngVal = pos.coords.longitude.toFixed(5);
          const inLat = document.getElementById('edit-att-in-lat');
          const inLng = document.getElementById('edit-att-in-lng');
          const outLat = document.getElementById('edit-att-out-lat');
          const outLng = document.getElementById('edit-att-out-lng');
          const lat = document.getElementById('edit-att-lat');
          const lng = document.getElementById('edit-att-lng');
          if (inLat) inLat.value = latVal;
          if (inLng) inLng.value = lngVal;
          if (outLat && !outLat.value) outLat.value = latVal;
          if (outLng && !outLng.value) outLng.value = lngVal;
          if (lat) lat.value = latVal;
          if (lng) lng.value = lngVal;
          showToast('ดึงพิกัดสำเร็จ', `📍 พิกัดปัจจุบัน: ${latVal}, ${lngVal}`, 'success');
        },
        (err) => {
          alert('ไม่สามารถดึง GPS จากอุปกรณ์ได้: ' + err.message + '\nสามารถกดปุ่มเลือกพิกัดสาขาเพื่อใส่พิกัดได้ครับ');
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  });

  // Form: Login
  document.getElementById('form-login')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username')?.value;
    const p = document.getElementById('login-password')?.value;
    const res = login(u, p);
    if (res.success) {
      showToast('เข้าสู่ระบบสำเร็จ!', `ยินดีต้อนรับ ${res.user.name}`, 'success');
    } else {
      const errAlert = document.getElementById('login-error-alert');
      const errMsg = document.getElementById('login-error-message');
      if (errAlert) errAlert.classList.remove('hidden');
      if (errMsg) errMsg.textContent = res.message;
      playSound('warning');
    }
  });

  // Logout Buttons (Desktop & Mobile)
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-mobile-logout')?.addEventListener('click', logout);

  // Toggle Password Visibility
  document.getElementById('btn-toggle-password')?.addEventListener('click', () => {
    const pInput = document.getElementById('login-password');
    const icon = document.getElementById('icon-toggle-password');
    if (!pInput) return;
    if (pInput.type === 'password') {
      pInput.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      pInput.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  });
}

function updateSettingLabels() {
  const lbl1 = document.getElementById('setting-work-start-label');
  const lbl2 = document.getElementById('hint-work-start');
  if (lbl1) lbl1.textContent = state.settings.startTime;
  if (lbl2) lbl2.textContent = state.settings.startTime;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadLocalData();
  loadUsersData();
  startLiveClock();
  updateSettingLabels();
  renderEmployeeDropdown();
  setupModals();
  initCharts();
  fetchGPSLocation();
  setupCameraFileInput();

  // Initialize Real-time Cloud / Google Sheets Synchronization
  initDatabaseSync();

  // Check login session
  const hasSession = loadSession();
  if (hasSession) {
    applyRolePermissions();
  } else {
    showLoginModal();
    updateKPICards();
    renderAttendanceTable();
  }

  // Employee Select Event
  document.getElementById('select-employee')?.addEventListener('change', (e) => {
    state.selectedEmpId = e.target.value;
    updateSelectedEmployeeCard();
  });

  // Camera Buttons
  document.getElementById('btn-start-camera')?.addEventListener('click', () => startCamera('user'));
  document.getElementById('btn-switch-camera')?.addEventListener('click', switchCamera);
  document.getElementById('btn-snap-photo')?.addEventListener('click', capturePhoto);
  document.getElementById('btn-clear-photo')?.addEventListener('click', clearCapturedPhoto);

  // GPS Live Sync & Manual Adjust Buttons
  const triggerSyncCurrentGPS = async () => {
    const btn = document.getElementById('btn-sync-current-gps') || document.getElementById('btn-refresh-gps');
    const icon = document.getElementById('icon-sync-current-gps');
    const label = document.getElementById('text-sync-current-gps');
    if (icon) icon.classList.add('animate-spin');
    if (label) label.textContent = 'กำลังค้นหาพิกัด...';
    if (btn) btn.disabled = true;

    showToast('กำลังค้นหาพิกัด...', 'กำลังเชื่อมต่อสัญญาณดาวเทียม GPS และเครือข่ายสด...', 'warning');

    try {
      const fresh = await acquireFreshGPS();
      if (fresh && fresh.lat && fresh.lng) {
        updateGPSUI(fresh.lat, fresh.lng, fresh.accuracy, false);
        showToast('ซิงค์พิกัดปัจจุบันสำเร็จ!', `📍 พิกัด: ${fresh.lat}, ${fresh.lng} (±${fresh.accuracy || 15}ม.)`, 'success');
        if (typeof playSound === 'function') playSound('success');
      } else {
        fetchGPSLocation();
        showToast('อัปเดตพิกัดแล้ว', 'รีเฟรชสัญญาณพิกัดปัจจุบันเรียบร้อย', 'info');
      }
    } catch (err) {
      console.warn('Manual sync GPS error:', err);
      fetchGPSLocation();
      showToast('รีเฟรชสัญญาณแล้ว', 'ระบบได้ทำการค้นหาพิกัดดาวเทียมใหม่ให้แล้ว', 'info');
    } finally {
      setTimeout(() => {
        if (icon) icon.classList.remove('animate-spin');
        if (label) label.textContent = 'ซิงค์พิกัดปัจจุบัน';
        if (btn) btn.disabled = false;
        if (window.lucide) lucide.createIcons();
      }, 500);
    }
  };

  document.getElementById('btn-sync-current-gps')?.addEventListener('click', triggerSyncCurrentGPS);
  document.getElementById('btn-refresh-gps')?.addEventListener('click', triggerSyncCurrentGPS);
  document.getElementById('btn-adjust-gps')?.addEventListener('click', openAdjustGPSDialog);

  // --- Hold-to-Confirm (3 Seconds) Button System ---
  function setupHoldToConfirmButton({
    btnId,
    progressId,
    barId,
    hintId,
    titleId,
    defaultTitle,
    defaultHint,
    actionType,
    confirmDuration = 3000,
    onConfirm
  }) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const progress = document.getElementById(progressId);
    const bar = document.getElementById(barId);
    const hint = document.getElementById(hintId);
    const title = document.getElementById(titleId);

    let holdTimer = null;
    let holdInterval = null;
    let startTime = 0;
    let isHolding = false;
    let completed = false;

    function resetState() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
      isHolding = false;
      if (progress) progress.style.width = '0%';
      if (bar) bar.style.width = '0%';
      if (hint) hint.textContent = defaultHint;
      if (title) title.textContent = defaultTitle;
      btn.classList.remove('scale-[0.97]', 'ring-4', 'ring-white/40', 'brightness-110');
    }

    function startHold(e) {
      // Only left mouse button or touch
      if (e.type === 'mousedown' && e.button !== 0) return;
      if (btn.disabled) return;
      if (isHolding) return;

      completed = false;
      isHolding = true;
      startTime = Date.now();

      btn.classList.add('scale-[0.97]', 'ring-4', 'ring-white/40', 'brightness-110');
      if (navigator.vibrate) {
        try { navigator.vibrate(30); } catch (vErr) {}
      }

      const updateProgress = () => {
        if (!isHolding) return;
        const elapsed = Date.now() - startTime;
        const percent = Math.min(100, (elapsed / confirmDuration) * 100);
        const remainingMs = Math.max(0, confirmDuration - elapsed);
        const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));

        if (progress) progress.style.width = `${percent}%`;
        if (bar) bar.style.width = `${percent}%`;
        if (hint) hint.textContent = `กดค้างอีก ${remainingSec} วินาที...`;
        if (title) title.textContent = `กำลังยืนยัน... (${remainingSec})`;
      };

      updateProgress();
      holdInterval = setInterval(updateProgress, 40);

      holdTimer = setTimeout(() => {
        clearInterval(holdInterval);
        holdInterval = null;
        completed = true;

        if (progress) progress.style.width = '100%';
        if (bar) bar.style.width = '100%';
        if (hint) hint.textContent = 'บันทึกสำเร็จ!';
        if (title) title.textContent = 'กำลังประมวลผล...';

        if (navigator.vibrate) {
          try { navigator.vibrate([60, 40, 80]); } catch (vErr) {}
        }

        setTimeout(() => {
          resetState();
          try {
            onConfirm();
          } catch (err) {
            console.error('Error in onConfirm:', err);
          }
        }, 150);
      }, confirmDuration);
    }

    function cancelHold(e) {
      if (!isHolding) return;
      const elapsed = Date.now() - startTime;
      if (!completed && elapsed < confirmDuration) {
        resetState();
        if (elapsed > 250 && elapsed < confirmDuration - 100) {
          showToast('ปล่อยมือก่อนกำหนด', 'กรุณากดปุ่มค้างไว้ครบ 3 วินาทีเพื่อยืนยันการลงเวลา', 'warning');
        }
      }
    }

    // Intercept normal click
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!completed && (!startTime || (Date.now() - startTime < confirmDuration))) {
        showToast('ต้องกดค้าง 3 วินาที', 'ระบบป้องกันการเผลอกดโดน กรุณากดปุ่มค้างไว้ 3 วินาทีเพื่อบันทึก', 'warning');
      }
    });

    // Mouse listeners
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('mouseup', cancelHold);
    btn.addEventListener('mouseleave', cancelHold);

    // Touch listeners
    btn.addEventListener('touchstart', (e) => {
      startHold(e);
    }, { passive: true });
    btn.addEventListener('touchend', cancelHold);
    btn.addEventListener('touchcancel', cancelHold);

    // Prevent context menu
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Setup 3-Second Hold to Confirm for Clock In and Clock Out
  setupHoldToConfirmButton({
    btnId: 'btn-clock-in',
    progressId: 'hold-progress-in',
    barId: 'hold-bar-in',
    hintId: 'clock-in-hint',
    titleId: 'clock-in-title',
    defaultTitle: 'บันทึกเข้างาน',
    defaultHint: 'กดค้าง 3 วิ เพื่อบันทึก',
    actionType: 'in',
    confirmDuration: 3000,
    onConfirm: handleClockIn
  });

  setupHoldToConfirmButton({
    btnId: 'btn-clock-out',
    progressId: 'hold-progress-out',
    barId: 'hold-bar-out',
    hintId: 'clock-out-hint',
    titleId: 'clock-out-title',
    defaultTitle: 'บันทึกออกงาน',
    defaultHint: 'กดค้าง 3 วิ เพื่อบันทึก',
    actionType: 'out',
    confirmDuration: 3000,
    onConfirm: handleClockOut
  });

  // Filter Listeners
  document.getElementById('filter-search')?.addEventListener('input', renderAttendanceTable);
  document.getElementById('filter-employee')?.addEventListener('change', renderAttendanceTable);
  document.getElementById('filter-department')?.addEventListener('change', renderAttendanceTable);
  document.getElementById('filter-date')?.addEventListener('change', renderAttendanceTable);
  document.getElementById('filter-status')?.addEventListener('change', renderAttendanceTable);

  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    const s = document.getElementById('filter-search');
    const emp = document.getElementById('filter-employee');
    const dept = document.getElementById('filter-department');
    const d = document.getElementById('filter-date');
    const st = document.getElementById('filter-status');
    if (s) s.value = '';
    if (emp) emp.value = 'ALL';
    if (dept) dept.value = 'ALL';
    if (d) d.value = '';
    if (st) st.value = 'ALL';
    renderAttendanceTable();
  });

  // Export CSV
  document.getElementById('btn-export-csv')?.addEventListener('click', exportToCSV);

  lucide.createIcons();
});
