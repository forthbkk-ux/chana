/**
 * =========================================================================
 * TimeTrack Pro - Google Sheets Backend API (Google Apps Script)
 * =========================================================================
 * โค้ดนี้ใช้สำหรับวางใน Google Sheets (Extensions -> Apps Script)
 * เพื่อแปลง Google Sheet ของคุณให้เป็นฐานข้อมูลกลาง (API) ฟรี 100%
 * รองรับการซิงค์ข้อมูลเรียลไทม์ระหว่างมือถือ ไอแพด และคอมพิวเตอร์
 * =========================================================================
 */

// ชื่อแผ่นงาน (Tabs)
const SHEET_ATTENDANCE = 'บันทึกเวลา';
const SHEET_EMPLOYEES = 'รายชื่อพนักงาน';
const SHEET_SETTINGS = 'ตั้งค่าระบบ';

/**
 * ทำความสะอาด ID (ตัดอักขระพิเศษ สระวรรณยุกต์ไทยนำหน้า เคาะวรรค)
 */
function cleanId(val) {
  return String(val || '')
    .replace(/^['*^\s\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E]+/, '')
    .trim()
    .toLowerCase();
}

/**
 * เมนูพิเศษบนแถบเมนูด้านบนของ Google Sheet
 * เมื่อเปิดไฟล์ Google Sheet จะมีเมนู "⚡ TimeTrack" ให้กดอัปเดตรหัสผ่านได้ทันที
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('⚡ TimeTrack (v2.2)')
      .addItem('🔑 แสดง/เติมรหัสผ่านในช่อง password (คอลัมน์ D)', 'fillPasswordsInSheet')
      .addItem('🕒 จัดระเบียบและตั้งค่าตารางบันทึกเวลา', 'formatAttendanceSheet')
      .addToUi();
  } catch (e) {}
}

/**
 * จัดระเบียบและตั้งรูปแบบช่องเวลา (คอลัมน์ F, G) ให้เป็นข้อความเพื่อไม่ให้เวลาเพี้ยน
 */
function formatAttendanceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
  if (!attSheet) return;
  const lastRow = attSheet.getLastRow();
  if (lastRow > 1) {
    attSheet.getRange(2, 6, lastRow - 1, 2).setNumberFormat('@');
    const idRange = attSheet.getRange(2, 3, lastRow - 1, 1);
    const idVals = idRange.getValues();
    let changed = false;
    for (let r = 0; r < idVals.length; r++) {
      const orig = String(idVals[r][0] || '');
      const cleaned = orig.replace(/^['*^\s\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E]+/, '').trim();
      if (orig !== cleaned && cleaned !== '') {
        idVals[r][0] = cleaned;
        changed = true;
      }
    }
    if (changed) {
      idRange.setValues(idVals);
    }
  }
  try {
    SpreadsheetApp.getUi().alert('✅ จัดระเบียบตารางและรูปแบบเวลาเรียบร้อยแล้ว');
  } catch (e) {}
}

/**
 * กดรันฟังก์ชันนี้เพื่อเติมรหัสผ่านลงช่อง password (คอลัมน์ D) ที่ยังว่างอยู่ทันที
 */
function fillPasswordsInSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initSheetsIfNotExist(ss);
  const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!empSheet) return;

  const lastRow = empSheet.getLastRow();
  const lastCol = Math.max(empSheet.getLastColumn(), 4);
  const headerVals = empSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let pwdCol = 4;
  for (let c = 0; c < headerVals.length; c++) {
    const h = String(headerVals[c] || '').trim().toLowerCase();
    if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
      pwdCol = c + 1;
      break;
    }
  }

  let count = 0;
  if (lastRow > 1) {
    const range = empSheet.getRange(2, pwdCol, lastRow - 1, 1);
    const vals = range.getValues();
    for (let i = 0; i < vals.length; i++) {
      if (!vals[i][0] || String(vals[i][0]).trim() === '') {
        vals[i][0] = '1234';
        count++;
      }
    }
    range.setValues(vals);
  }

  try {
    SpreadsheetApp.getUi().alert(`✅ เติมรหัสผ่านลงในช่อง password (คอลัมน์ D) เรียบร้อยแล้ว (${count} รายการ)`);
  } catch (e) {}
}

/**
 * ฟังก์ชันเริ่มต้นสร้างตารางอัตโนมัติ (จะรันครั้งแรกเมื่อมีคนเรียกใช้งาน)
 */
function initSheetsIfNotExist(ss) {
  // 1. ตารางบันทึกเวลา
  let attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
  if (!attSheet) {
    attSheet = ss.insertSheet(SHEET_ATTENDANCE);
    const headers = [
      'รหัสบันทึก', 'วันที่', 'รหัสพนักงาน', 'ชื่อ-นามสกุล', 'แผนก',
      'เวลาเข้า', 'เวลาออก', 'สถานที่', 'ละติจูด', 'ลองจิจูด',
      'ลิงก์แผนที่', 'สถานะ', 'รูปถ่าย', 'หมายเหตุ'
    ];
    attSheet.appendRow(headers);
    attSheet.getRange('A1:N1').setFontWeight('bold').setBackground('#e0f2fe').setFontColor('#0369a1');
    attSheet.setFrozenRows(1);
  }

  // 2. ตารางรายชื่อพนักงาน
  let empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!empSheet) {
    empSheet = ss.insertSheet(SHEET_EMPLOYEES);
    const headers = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'แผนก', 'password'];
    empSheet.appendRow(headers);
    empSheet.getRange('A1:D1').setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
    empSheet.setFrozenRows(1);

    // ใส่ข้อมูลพนักงานเริ่มต้น
    empSheet.appendRow(['EMP-001', 'สมชาย สายลุย', 'ฝ่ายพัฒนาธุรกิจ', '1234']);
    empSheet.appendRow(['EMP-002', 'กัญญาภัทร ใจมั่น', 'ฝ่ายบุคคล (HR)', '1234']);
  } else {
    // ตรวจสอบและตั้งชื่อหัวคอลัมน์ D เป็น password ให้อัตโนมัติหากยังไม่มี
    const lastCol = Math.max(empSheet.getLastColumn(), 4);
    const headerVals = empSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    let pwdColIndex = 4; // ค่าเริ่มต้นคอลัมน์ D (1-based)
    let hasPwdHeader = false;

    for (let c = 0; c < headerVals.length; c++) {
      const h = String(headerVals[c] || '').trim().toLowerCase();
      if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
        pwdColIndex = c + 1;
        hasPwdHeader = true;
        break;
      }
    }

    if (!hasPwdHeader) {
      empSheet.getRange(1, 4).setValue('password');
      empSheet.getRange(1, 4).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
      pwdColIndex = 4;
    }

    // เติมรหัสผ่านเริ่มต้น 1234 ให้แถวพนักงานเดิมที่ยังไม่มีรหัสผ่านในคอลัมน์ password
    const lastRow = empSheet.getLastRow();
    if (lastRow > 1) {
      const pRange = empSheet.getRange(2, pwdColIndex, lastRow - 1, 1);
      const pVals = pRange.getValues();
      let changed = false;
      for (let r = 0; r < pVals.length; r++) {
        if (!pVals[r][0] || String(pVals[r][0]).trim() === '') {
          pVals[r][0] = '1234';
          changed = true;
        }
      }
      if (changed) {
        pRange.setValues(pVals);
      }
    }
  }

  // 3. ตารางตั้งค่าระบบ
  let setSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!setSheet) {
    setSheet = ss.insertSheet(SHEET_SETTINGS);
    setSheet.appendRow(['Key', 'Value']);
    setSheet.getRange('A1:B1').setFontWeight('bold').setBackground('#f1f5f9');
    setSheet.appendRow(['startTime', '08:30']);
    setSheet.appendRow(['endTime', '17:30']);
    setSheet.appendRow(['graceMinutes', '0']);
    setSheet.setFrozenRows(1);
  }

  // ลบ Sheet1 เริ่มต้นทิ้งถ้ามี
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่นงาน1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }
}

/**
 * GET Request: ส่งข้อมูลทั้งหมดกลับไปแสดงผลบนหน้าเว็บแดชบอร์ด
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    initSheetsIfNotExist(ss);

    // 1. ดึงข้อมูลพนักงาน (รวม password จากคอลัมน์ D)
    const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
    const empData = empSheet.getDataRange().getValues();
    const employees = [];

    // ตรวจสอบตำแหน่งคอลัมน์อัตโนมัติ
    let idCol = 0, nameCol = 1, deptCol = 2, pwdCol = 3;
    if (empData.length > 0) {
      const headers = empData[0];
      for (let c = 0; c < headers.length; c++) {
        const h = String(headers[c] || '').trim().toLowerCase();
        if (h.includes('รหัสพนักงาน') || h === 'empid' || h === 'id') idCol = c;
        else if (h.includes('ชื่อ') || h === 'name') nameCol = c;
        else if (h.includes('แผนก') || h === 'dept' || h === 'department') deptCol = c;
        else if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) pwdCol = c;
      }
      if (pwdCol < 0) pwdCol = 3;
    }

    for (let i = 1; i < empData.length; i++) {
      if (empData[i][idCol]) {
        const empId = String(empData[i][idCol]).trim();
        const empName = String(empData[i][nameCol] || '').trim();
        const empDept = String(empData[i][deptCol] || '').trim();

        // Skip Admin accounts - Admin does not record attendance
        if (empId.toLowerCase() === 'chana.p' || empId.toLowerCase() === 'admin' || empName.toLowerCase().includes('ผู้ดูแลระบบ')) {
          continue;
        }

        const empPass = (pwdCol >= 0 && empData[i][pwdCol] !== undefined && String(empData[i][pwdCol]).trim() !== '')
          ? String(empData[i][pwdCol]).trim()
          : '1234';

        employees.push({
          id: empId,
          name: empName,
          dept: empDept,
          username: empId, // รหัสพนักงานใช้เป็น User
          password: empPass
        });
      }
    }

    // 2. ดึงข้อมูลบันทึกเวลา
    const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
    const attData = attSheet.getDataRange().getValues();
    const attendances = [];
    for (let i = 1; i < attData.length; i++) {
      if (attData[i][0]) {
        let dateVal = attData[i][1];
        if (dateVal instanceof Date) {
          const y = dateVal.getFullYear();
          const m = String(dateVal.getMonth() + 1).padStart(2, '0');
          const d = String(dateVal.getDate()).padStart(2, '0');
          dateVal = `${y}-${m}-${d}`;
        }
        
        let checkInVal = attData[i][5];
        if (checkInVal instanceof Date) {
          checkInVal = Utilities.formatDate(checkInVal, 'Asia/Bangkok', 'HH:mm:ss');
        }

        let checkOutVal = attData[i][6];
        if (checkOutVal instanceof Date) {
          checkOutVal = Utilities.formatDate(checkOutVal, 'Asia/Bangkok', 'HH:mm:ss');
        }

        const rowEmpId = String(attData[i][2] || '').trim().toLowerCase();
        if (rowEmpId === 'chana.p' || rowEmpId === 'admin') {
          continue;
        }

        const rowEmpName = String(attData[i][3] || '').trim();
        const rowDept = String(attData[i][4] || '').trim();
        let rowLat = String(attData[i][8] || '').trim();
        let rowLng = String(attData[i][9] || '').trim();
        const isRama2 = (rowEmpId === 'b001') || rowEmpName.includes('พระราม') || rowDept.includes('พระราม');
        if (isRama2 && (rowLat === '13.7563' || !rowLat)) {
          rowLat = '13.6644';
          rowLng = '100.4421';
        }

        attendances.push({
          id: String(attData[i][0]),
          date: String(dateVal || ''),
          empId: String(attData[i][2] || ''),
          empName: rowEmpName,
          dept: rowDept,
          checkIn: checkInVal ? String(checkInVal) : null,
          checkOut: checkOutVal ? String(checkOutVal) : null,
          location: String(attData[i][7] || 'สำนักงานใหญ่'),
          gps: {
            lat: rowLat,
            lng: rowLng
          },
          status: String(attData[i][11] || 'ON_TIME'),
          photo: String(attData[i][12] || ''),
          note: String(attData[i][13] || '')
        });
      }
    }

    // 3. ดึงข้อมูลตั้งค่า
    const setSheet = ss.getSheetByName(SHEET_SETTINGS);
    const setData = setSheet.getDataRange().getValues();
    const settings = { startTime: '08:30', endTime: '17:30', graceMinutes: 0 };
    for (let i = 1; i < setData.length; i++) {
      const k = String(setData[i][0]).trim();
      let v = setData[i][1];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
      } else {
        v = String(v || '').trim();
      }
      if (k === 'startTime' && v) settings.startTime = v;
      if (k === 'endTime' && v) settings.endTime = v;
      if (k === 'graceMinutes') settings.graceMinutes = parseInt(v, 10) || 0;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      employees: employees,
      attendances: attendances,
      settings: settings
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST Request: รับคำสั่งจากหน้าเว็บเพื่อบันทึกเข้างาน เลิกงาน หรือเพิ่มพนักงาน
 */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    initSheetsIfNotExist(ss);

    let data = null;
    if (e.postData && e.postData.contents) {
      let raw = e.postData.contents;
      if (typeof raw === 'string') {
        raw = raw.replace(/^\uFEFF/, '').trim();
      }
      try {
        data = JSON.parse(raw);
      } catch (jsonErr) {
        data = e.parameter || {};
      }
    } else {
      data = e.parameter || {};
    }

    const action = data.action;

    // 1. บันทึกเข้างาน (Clock In)
    if (action === 'clockIn') {
      const record = data.record;
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const mapsLink = (record.gps && record.gps.lat) ? `https://www.google.com/maps?q=${record.gps.lat},${record.gps.lng}` : '';

      let photoStr = String(record.photo || '');
      if (photoStr.length > 45000) {
        photoStr = photoStr.substring(0, 45000);
      }

      attSheet.appendRow([
        record.id,
        record.date,
        record.empId,
        record.empName,
        record.dept,
        record.checkIn || '',
        record.checkOut || '',
        record.location || 'สำนักงานใหญ่',
        record.gps ? record.gps.lat : '',
        record.gps ? record.gps.lng : '',
        mapsLink,
        record.status || 'ON_TIME',
        photoStr,
        record.note || ''
      ]);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'clockIn' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. บันทึกออกงาน (Clock Out)
    if (action === 'clockOut') {
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const rows = attSheet.getDataRange().getValues();
      let updated = false;

      // ค้นหาแถวของพนักงานในวันนี้ (เริ่มค้นจากแถวล่าสุดย้อนขึ้นมา)
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowDate = rows[i][1];
        let dateStr = rowDate;
        if (rowDate instanceof Date) {
          const y = rowDate.getFullYear();
          const m = String(rowDate.getMonth() + 1).padStart(2, '0');
          const d = String(rowDate.getDate()).padStart(2, '0');
          dateStr = `${y}-${m}-${d}`;
        }

        if (String(rows[i][2]) === String(data.empId) && dateStr === data.date) {
          // อัปเดตคอลัมน์ G (เวลาออก) -> index 7 (1-based)
          attSheet.getRange(i + 1, 7).setValue(data.checkOut);
          if (data.photo) attSheet.getRange(i + 1, 13).setValue(data.photo);
          let outLat = data.gps && data.gps.lat ? String(data.gps.lat) : '';
          let outLng = data.gps && data.gps.lng ? String(data.gps.lng) : '';
          const isRama2Emp = (String(data.empId).toLowerCase() === 'b001') || String(rows[i][3] || '').includes('พระราม') || String(rows[i][4] || '').includes('พระราม');
          if (isRama2Emp && (outLat === '13.7563' || !outLat)) {
            outLat = '13.6644';
            outLng = '100.4421';
          }
          if (outLat && outLng) {
            attSheet.getRange(i + 1, 9).setValue(outLat);
            attSheet.getRange(i + 1, 10).setValue(outLng);
            attSheet.getRange(i + 1, 11).setValue(`https://www.google.com/maps?q=${outLat},${outLng}`);
          }
          updated = true;
          break;
        }
      }

      // ถ้าไม่พบรายการเข้างาน ให้สร้างแถวใหม่สำหรับการออกงาน
      if (!updated) {
        const record = data.record || {};
        let outLat = data.gps && data.gps.lat ? String(data.gps.lat) : '';
        let outLng = data.gps && data.gps.lng ? String(data.gps.lng) : '';
        const isRama2Emp = (String(data.empId).toLowerCase() === 'b001') || String(data.empName || '').includes('พระราม') || String(data.dept || '').includes('พระราม');
        if (isRama2Emp && (outLat === '13.7563' || !outLat)) {
          outLat = '13.6644';
          outLng = '100.4421';
        }
        const mapsLink = (outLat && outLng) ? `https://www.google.com/maps?q=${outLat},${outLng}` : '';
        attSheet.appendRow([
          data.id || ('ATT-' + Date.now()),
          data.date,
          data.empId,
          data.empName || '',
          data.dept || '',
          '', // ไม่มีเวลาเข้า
          data.checkOut,
          data.location || 'สำนักงานใหญ่',
          outLat,
          outLng,
          mapsLink,
          'ON_TIME',
          data.photo || '',
          data.note || 'ไม่ได้ตอกเข้า'
        ]);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'clockOut' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. เพิ่มพนักงานใหม่ (Add Employee)
    if (action === 'addEmployee') {
      const emp = data.employee;
      const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
      const password = String(emp.password || '1234').trim();
      empSheet.appendRow([emp.id, emp.name, emp.dept, password]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'addEmployee' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3.1 เปลี่ยนรหัสผ่านพนักงาน (Update Employee Password)
    if (action === 'updateEmployeePassword') {
      const empId = String(data.empId || '').trim();
      const newPassword = String(data.password || '1234').trim();
      const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
      const rows = empSheet.getDataRange().getValues();

      let pwdCol = 4; // Column D (1-based)
      if (rows.length > 0) {
        for (let c = 0; c < rows[0].length; c++) {
          const h = String(rows[0][c] || '').trim().toLowerCase();
          if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
            pwdCol = c + 1;
            break;
          }
        }
      }

      const targetId = String(empId).replace(/^'/, '').trim().toLowerCase();
      for (let i = 1; i < rows.length; i++) {
        const rowId = String(rows[i][0] || '').replace(/^'/, '').trim().toLowerCase();
        if (rowId === targetId) {
          empSheet.getRange(i + 1, pwdCol).setValue(newPassword);
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'updateEmployeePassword' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 4. ลบพนักงาน (Delete Employee)
    if (action === 'deleteEmployee') {
      const empId = data.id;
      const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
      const rows = empSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][0]).trim() === String(empId).trim()) {
          empSheet.deleteRow(i + 1);
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'deleteEmployee' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 5. ลบรายการบันทึกเวลา (Delete Attendance Record)
    if (action === 'deleteAttendance') {
      const attId = String(data.id || '').trim();
      const empId = String(data.empId || '').replace(/^'/, '').trim().toLowerCase();
      const dateStr = String(data.date || '').trim();
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const rows = attSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowId = String(rows[i][0] || '').trim();
        const rowEmpId = String(rows[i][2] || '').replace(/^'/, '').trim().toLowerCase();
        let rowDate = rows[i][1];
        if (rowDate instanceof Date) {
          const y = rowDate.getFullYear();
          const m = String(rowDate.getMonth() + 1).padStart(2, '0');
          const d = String(rowDate.getDate()).padStart(2, '0');
          rowDate = `${y}-${m}-${d}`;
        }
        if ((attId && rowId === attId) || (empId && dateStr && rowEmpId === empId && String(rowDate).trim() === dateStr)) {
          attSheet.deleteRow(i + 1);
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'deleteAttendance' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 5.1 แก้ไขรายการบันทึกเวลา (Edit Attendance Record - Admin Only)
    if (action === 'editAttendance') {
      const record = data.record || {};
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const rows = attSheet.getDataRange().getValues();
      const targetId = cleanId(record.id);
      const targetEmpId = cleanId(record.empId);
      const targetDate = String(record.date || '').trim();
      let updated = false;

      for (let i = 1; i < rows.length; i++) {
        const rowId = cleanId(rows[i][0]);
        const rowEmpId = cleanId(rows[i][2]);
        let rowDate = rows[i][1];
        if (rowDate instanceof Date) {
          const y = rowDate.getFullYear();
          const m = String(rowDate.getMonth() + 1).padStart(2, '0');
          const d = String(rowDate.getDate()).padStart(2, '0');
          rowDate = `${y}-${m}-${d}`;
        }
        const rowDateStr = String(rowDate || '').trim();

        const matchId = (targetId && rowId === targetId);
        const matchEmpDate = (targetEmpId && targetDate && rowEmpId === targetEmpId && rowDateStr === targetDate);

        if (matchId || matchEmpDate) {
          if (record.date) attSheet.getRange(i + 1, 2).setValue(record.date);
          if (record.checkIn !== undefined) {
            attSheet.getRange(i + 1, 6).setNumberFormat('@').setValue(record.checkIn || '');
          }
          if (record.checkOut !== undefined) {
            attSheet.getRange(i + 1, 7).setNumberFormat('@').setValue(record.checkOut || '');
          }
          if (record.location) attSheet.getRange(i + 1, 8).setValue(record.location);
          if (record.gps && record.gps.lat && record.gps.lng) {
            attSheet.getRange(i + 1, 9).setValue(record.gps.lat);
            attSheet.getRange(i + 1, 10).setValue(record.gps.lng);
            attSheet.getRange(i + 1, 11).setValue(`https://www.google.com/maps?q=${record.gps.lat},${record.gps.lng}`);
          }
          if (record.status) attSheet.getRange(i + 1, 12).setValue(record.status);
          if (record.note !== undefined) attSheet.getRange(i + 1, 14).setValue(record.note || '');
          updated = true;
          break;
        }
      }

      // ถ้าไม่พบแถวเดิม ให้สร้างใหม่ทันที ไม่ให้ข้อมูลสูญหาย
      if (!updated && (record.empId || targetEmpId)) {
        const mapsLink = (record.gps && record.gps.lat) ? `https://www.google.com/maps?q=${record.gps.lat},${record.gps.lng}` : '';
        let photoStr = String(record.photo || '');
        if (photoStr.length > 45000) photoStr = photoStr.substring(0, 45000);
        attSheet.appendRow([
          record.id || ('ATT-' + Date.now()),
          record.date || '',
          record.empId || '',
          record.empName || '',
          record.dept || '',
          record.checkIn || '',
          record.checkOut || '',
          record.location || 'สำนักงานใหญ่',
          record.gps ? record.gps.lat : '',
          record.gps ? record.gps.lng : '',
          mapsLink,
          record.status || 'ON_TIME',
          photoStr,
          record.note || ''
        ]);
        updated = true;
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'editAttendance', updated }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 6. บันทึกการตั้งค่า (Save Settings)
    if (action === 'saveSettings') {
      const settings = data.settings;
      const setSheet = ss.getSheetByName(SHEET_SETTINGS);
      setSheet.clear();
      setSheet.appendRow(['Key', 'Value']);
      setSheet.getRange('A1:B1').setFontWeight('bold').setBackground('#f1f5f9');
      setSheet.appendRow(['startTime', settings.startTime || '08:30']);
      setSheet.appendRow(['endTime', settings.endTime || '17:30']);
      setSheet.appendRow(['graceMinutes', settings.graceMinutes || 0]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'saveSettings' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 7. ซิงค์ข้อมูลทั้งหมดจากเครื่องขึ้นชีท (Bulk Sync)
    if (action === 'syncAll') {
      if (Array.isArray(data.employees) && data.employees.length > 0) {
        const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
        const existingRows = empSheet.getDataRange().getValues();

        // ตรวจสอบและใส่หัวคอลัมน์ D เป็น password หากยังไม่มี
        let pwdCol = 4; // Column D (1-based)
        if (existingRows.length > 0) {
          let found = false;
          for (let c = 0; c < existingRows[0].length; c++) {
            const h = String(existingRows[0][c] || '').trim().toLowerCase();
            if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
              pwdCol = c + 1;
              found = true;
              break;
            }
          }
          if (!found) {
            empSheet.getRange(1, 4).setValue('password');
            empSheet.getRange(1, 4).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
            pwdCol = 4;
          }
        }

        const existingIdRowMap = new Map();
        for (let i = 1; i < existingRows.length; i++) {
          if (existingRows[i][0] !== undefined && existingRows[i][0] !== '') {
            const rawId = String(existingRows[i][0]).replace(/^'/, '').trim().toLowerCase();
            existingIdRowMap.set(rawId, i + 1);
          }
        }
        data.employees.forEach(emp => {
          if (emp && emp.id) {
            const rawEmpId = String(emp.id).replace(/^'/, '').trim().toLowerCase();
            const password = String(emp.password || '1234').trim();
            if (existingIdRowMap.has(rawEmpId)) {
              const rowIndex = existingIdRowMap.get(rawEmpId);
              // อัปเดตรหัสผ่านลงคอลัมน์ password
              empSheet.getRange(rowIndex, pwdCol).setValue(password);
            } else {
              empSheet.appendRow([emp.id, emp.name, emp.dept, password]);
            }
          }
        });
      }
      if (Array.isArray(data.attendances) && data.attendances.length > 0) {
        const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
        const existingRows = attSheet.getDataRange().getValues();
        const existingIdRowMap = new Map();
        for (let i = 1; i < existingRows.length; i++) {
          if (existingRows[i][0]) {
            existingIdRowMap.set(String(existingRows[i][0]).trim(), i + 1);
          }
        }
        data.attendances.forEach(rec => {
          if (rec && rec.id) {
            const recId = String(rec.id).trim();
            if (existingIdRowMap.has(recId)) {
              // อัปเดตรายการเดิมที่มีการแก้ไขเวลา
              const rowIndex = existingIdRowMap.get(recId);
              if (rec.date) attSheet.getRange(rowIndex, 2).setValue(rec.date);
              if (rec.checkIn !== undefined) attSheet.getRange(rowIndex, 6).setNumberFormat('@').setValue(rec.checkIn || '');
              if (rec.checkOut !== undefined) attSheet.getRange(rowIndex, 7).setNumberFormat('@').setValue(rec.checkOut || '');
              if (rec.location) attSheet.getRange(rowIndex, 8).setValue(rec.location);
              if (rec.status) attSheet.getRange(rowIndex, 12).setValue(rec.status);
              if (rec.note !== undefined) attSheet.getRange(rowIndex, 14).setValue(rec.note || '');
            } else {
              // เพิ่มรายการใหม่
              let photoStr = String(rec.photo || '');
              if (photoStr.length > 45000) photoStr = photoStr.substring(0, 45000);
              const mapsLink = (rec.gps && rec.gps.lat) ? `https://www.google.com/maps?q=${rec.gps.lat},${rec.gps.lng}` : '';
              attSheet.appendRow([
                rec.id, rec.date, rec.empId, rec.empName, rec.dept,
                rec.checkIn || '', rec.checkOut || '', rec.location || 'สำนักงานใหญ่',
                rec.gps ? rec.gps.lat : '', rec.gps ? rec.gps.lng : '', mapsLink,
                rec.status || 'ON_TIME', photoStr, rec.note || ''
              ]);
            }
          }
        });
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'syncAll' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
