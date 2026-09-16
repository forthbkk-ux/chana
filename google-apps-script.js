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
 * ระบุพิกัด GPS อัตโนมัติตามสาขาของพนักงาน หากพิกัดเดิมติดอยู่ที่กรุงเทพฯ กลาง (13.7563) หรือว่างเปล่า
 */
function resolveBranchLocation(empId, empName, dept, currentLat, currentLng) {
  const cLat = String(currentLat || '').trim();
  const cLng = String(currentLng || '').trim();

  // ตรวจสอบว่าพิกัดปัจจุบันเป็นพิกัดจริงที่เชื่อถือได้ (ไม่ใช่พิกัดดีฟอลต์กรุงเทพ 13.7563 และไม่ใช่ค่าว่าง)
  const isDefaultBangkok = (cLat === '13.7563' || cLat === '13.75630' || (cLat.startsWith('13.7563') && cLng.startsWith('100.5018')));
  const isCoordinatesSet = cLat && cLng && cLat !== '0' && cLng !== '0';

  if (isCoordinatesSet && !isDefaultBangkok) {
    return { lat: cLat, lng: cLng, branch: '' };
  }

  // รวมข้อความเพื่อวิเคราะห์สาขา
  const combined = `${empId || ''} ${empName || ''} ${dept || ''}`.toLowerCase();

  if (combined.includes('รังสิต') || combined.includes('rangsit')) {
    return { lat: '13.9890', lng: '100.6177', branch: 'สาขารังสิต' };
  }
  if (combined.includes('ไทรน้อย') || combined.includes('sainoi') || combined.includes('sai noi')) {
    return { lat: '13.9715', lng: '100.3261', branch: 'สาขาไทรน้อย' };
  }
  if (combined.includes('จรัญ') || combined.includes('charan')) {
    return { lat: '13.7650', lng: '100.4850', branch: 'สาขาจรัญสนิทวงศ์' };
  }
  if (combined.includes('พระราม') || combined.includes('rama') || cleanId(empId) === 'b001') {
    return { lat: '13.6644', lng: '100.4421', branch: 'สาขาพระราม 2 (DOPA)' };
  }
  if (combined.includes('ลำลูกกา') || combined.includes('ปักษีเลิศ') || combined.includes('lamlukka')) {
    return { lat: '13.9736', lng: '100.6582', branch: 'สาขาลำลูกกา (ปักษีเลิศ)' };
  }

  return {
    lat: cLat || '13.7563',
    lng: cLng || '100.5018',
    branch: 'สำนักงานใหญ่'
  };
}

/**
 * ตรวจสอบและระบุตำแหน่งคอลัมน์ทั้งหมดของตารางบันทึกเวลา (รองรับทั้งแบบเดิม 14 คอลัมน์ และแบบใหม่ที่มีพิกัดออกงาน 17 คอลัมน์)
 */
function getAttendanceColumnMapping(attSheet) {
  const lastCol = Math.max(attSheet.getLastColumn(), 14);
  const headerVals = attSheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const cols = {
    idCol: 1,
    dateCol: 2,
    empIdCol: 3,
    empNameCol: 4,
    deptCol: 5,
    checkInCol: 6,
    checkOutCol: 7,
    locCol: 8,
    inLatCol: 9,
    inLngCol: 10,
    inMapCol: 11,
    outLatCol: -1,
    outLngCol: -1,
    outMapCol: -1,
    statusCol: 12,
    photoCol: 13,
    noteCol: 14
  };

  for (let c = 0; c < headerVals.length; c++) {
    const h = String(headerVals[c] || '').trim().toLowerCase();
    const colNum = c + 1;
    if (h.includes('รหัสบันทึก') || h === 'id') cols.idCol = colNum;
    else if (h.includes('วันที่') || h === 'date') cols.dateCol = colNum;
    else if (h.includes('รหัสพนักงาน') || h === 'empid') cols.empIdCol = colNum;
    else if (h.includes('ชื่อ') || h === 'name' || h === 'empname') cols.empNameCol = colNum;
    else if (h.includes('แผนก') || h === 'dept') cols.deptCol = colNum;
    else if ((h.includes('เวลาเข้า') || h === 'checkin' || h === 'in') && !h.includes('ออก')) cols.checkInCol = colNum;
    else if (h.includes('เวลาออก') || h === 'checkout' || h === 'out') cols.checkOutCol = colNum;
    else if (h.includes('สถานที่') || h === 'location') cols.locCol = colNum;
    else if (h.includes('ละติจูดออก') || h === 'outlat' || h.includes('latout') || h.includes('ละติจูดเวลาออก')) cols.outLatCol = colNum;
    else if (h.includes('ลองจิจูดออก') || h === 'outlng' || h.includes('lngout') || h.includes('ลองจิจูดเวลาออก')) cols.outLngCol = colNum;
    else if (h.includes('แผนที่ออก') || h.includes('mapout') || h.includes('outmap') || h.includes('แผนที่เวลาออก')) cols.outMapCol = colNum;
    else if (h.includes('ละติจูด') || h === 'lat') cols.inLatCol = colNum;
    else if (h.includes('ลองจิจูด') || h === 'lng') cols.inLngCol = colNum;
    else if (h.includes('ลิงก์แผนที่') || h.includes('แผนที่') || h === 'map') cols.inMapCol = colNum;
    else if (h.includes('สถานะ') || h === 'status') cols.statusCol = colNum;
    else if (h.includes('รูป') || h === 'photo') cols.photoCol = colNum;
    else if (h.includes('หมายเหตุ') || h === 'note') cols.noteCol = colNum;
  }

  return cols;
}

/**
 * เพิ่มคอลัมน์พิกัดเวลาออกงาน (ละติจูดออก, ลองจิจูดออก, ลิงก์แผนที่ออก) ใน Google Sheets ทันที
 */
function setupClockOutGpsColumnsInSheet(targetSheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = targetSheet || ss.getSheetByName(SHEET_ATTENDANCE);
  if (!sheet) return;

  const cols = getAttendanceColumnMapping(sheet);

  // ถ้ายังไม่มีคอลัมน์พิกัดออกงาน ให้แทรก 3 คอลัมน์ใหม่ถัดจากลิงก์แผนที่เข้า
  if (cols.outLatCol === -1 || cols.outLngCol === -1) {
    const insertAfterCol = cols.inMapCol > 0 ? cols.inMapCol : 11;
    sheet.insertColumnsAfter(insertAfterCol, 3);
    sheet.getRange(1, insertAfterCol + 1).setValue('ละติจูดออก');
    sheet.getRange(1, insertAfterCol + 2).setValue('ลองจิจูดออก');
    sheet.getRange(1, insertAfterCol + 3).setValue('ลิงก์แผนที่ออก');

    sheet.getRange(1, insertAfterCol + 1, 1, 3)
      .setFontWeight('bold')
      .setBackground('#ffe4e6')
      .setFontColor('#9f1239');
  }

  // ปรับปรุงหัวตารางให้เป็นระเบียบ
  const updatedCols = getAttendanceColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  let updatedCount = 0;

  if (lastRow > 1) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const checkOutVal = data[i][updatedCols.checkOutCol - 1];
      const empId = data[i][updatedCols.empIdCol - 1];
      const empName = data[i][updatedCols.empNameCol - 1];
      const dept = data[i][updatedCols.deptCol - 1];
      let inLat = String(data[i][updatedCols.inLatCol - 1] || '').trim();
      let inLng = String(data[i][updatedCols.inLngCol - 1] || '').trim();
      let outLat = updatedCols.outLatCol > 0 ? String(data[i][updatedCols.outLatCol - 1] || '').trim() : '';
      let outLng = updatedCols.outLngCol > 0 ? String(data[i][updatedCols.outLngCol - 1] || '').trim() : '';

      // อัปเดตพิกัดเข้างานถ้าติด 13.7563
      const resolvedIn = resolveBranchLocation(empId, empName, dept, inLat, inLng);
      if (resolvedIn.lat !== inLat || resolvedIn.lng !== inLng) {
        sheet.getRange(i + 1, updatedCols.inLatCol).setValue(resolvedIn.lat);
        sheet.getRange(i + 1, updatedCols.inLngCol).setValue(resolvedIn.lng);
        if (updatedCols.inMapCol > 0) {
          sheet.getRange(i + 1, updatedCols.inMapCol).setValue(`https://www.google.com/maps?q=${resolvedIn.lat},${resolvedIn.lng}`);
        }
      }

      // ถ้ามีเวลาออกงาน แต่ยังไม่มีพิกัดออกงาน ให้ระบุพิกัดสาขาถ้ามี
      if (checkOutVal && (!outLat || outLat === '13.7563' || outLat === '')) {
        const resolvedOut = resolveBranchLocation(empId, empName, dept, outLat, outLng);
        if (resolvedOut.lat && resolvedOut.lat !== '13.7563') {
          if (updatedCols.outLatCol > 0 && updatedCols.outLngCol > 0) {
            sheet.getRange(i + 1, updatedCols.outLatCol).setValue(resolvedOut.lat);
            sheet.getRange(i + 1, updatedCols.outLngCol).setValue(resolvedOut.lng);
            if (updatedCols.outMapCol > 0) {
              sheet.getRange(i + 1, updatedCols.outMapCol).setValue(`https://www.google.com/maps?q=${resolvedOut.lat},${resolvedOut.lng}`);
            }
            updatedCount++;
          }
        }
      }
    }
  }

  try {
    SpreadsheetApp.getUi().alert(`✅ เพิ่มคอลัมน์พิกัดเวลาออกงาน (ละติจูดออก, ลองจิจูดออก, ลิงก์แผนที่ออก) และอัปเดตข้อมูลเรียบร้อยแล้ว (${updatedCount} รายการ)`);
  } catch (e) {}
}

/**
 * เมนูพิเศษบนแถบเมนูด้านบนของ Google Sheet
 * เมื่อเปิดไฟล์ Google Sheet จะมีเมนู "⚡ TimeTrack" ให้กดอัปเดตรหัสผ่านได้ทันที
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('⚡ TimeTrack (v2.5)')
      .addItem('📍 เพิ่มคอลัมน์พิกัดเวลาออกงาน (ละติจูดออก, ลองจิจูดออก)', 'setupClockOutGpsColumnsInSheet')
      .addItem('📍 ตรวจสอบและอัปเดตพิกัดสาขาในตารางบันทึกเวลา', 'fixBranchCoordinatesInSheet')
      .addItem('🔑 แสดง/เติมรหัสผ่านในช่อง password (คอลัมน์ D)', 'fillPasswordsInSheet')
      .addItem('⏰ เติมเวลาเข้า-ออกงานมาตรฐาน (คอลัมน์ E, F)', 'fillWorkHoursInSheet')
      .addItem('🕒 จัดระเบียบและตั้งค่าตารางบันทึกเวลา', 'formatAttendanceSheet')
      .addToUi();
  } catch (e) {}
}

/**
 * สแกนตารางบันทึกเวลาและอัปเดตพิกัด GPS ของพนักงานตามสาขา (รังสิต, ไทรน้อย, จรัญ, พระราม 2, ลำลูกกา)
 * สำหรับแถวที่พิกัดติดอยู่ที่ 13.7563 หรือว่างเปล่า
 */
function fixBranchCoordinatesInSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
  if (!attSheet) return;
  setupClockOutGpsColumnsInSheet(attSheet);
}

/**
 * เติมเวลาเข้างาน-ออกงานมาตรฐาน (คอลัมน์ E, F) ให้พนักงานที่ยังไม่มีข้อมูล
 */
function fillWorkHoursInSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initSheetsIfNotExist(ss);
  const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!empSheet) return;

  const lastRow = empSheet.getLastRow();
  const lastCol = Math.max(empSheet.getLastColumn(), 6);
  const headerVals = empSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let startCol = 5, endCol = 6;
  for (let c = 0; c < headerVals.length; c++) {
    const h = String(headerVals[c] || '').trim().toLowerCase();
    if (h.includes('เวลาเข้า') || h === 'workstart' || h === 'start') startCol = c + 1;
    else if (h.includes('เวลาออก') || h.includes('เวลาเลิก') || h === 'workend' || h === 'end') endCol = c + 1;
  }

  let count = 0;
  if (lastRow > 1) {
    const sRange = empSheet.getRange(2, startCol, lastRow - 1, 1);
    const sVals = sRange.getValues();
    const eRange = empSheet.getRange(2, endCol, lastRow - 1, 1);
    const eVals = eRange.getValues();
    let changed = false;
    for (let i = 0; i < sVals.length; i++) {
      if (!sVals[i][0] || String(sVals[i][0]).trim() === '') {
        sVals[i][0] = '08:30';
        changed = true;
        count++;
      }
      if (!eVals[i][0] || String(eVals[i][0]).trim() === '') {
        eVals[i][0] = '17:30';
        changed = true;
      }
    }
    if (changed) {
      sRange.setNumberFormat('@').setValues(sVals);
      eRange.setNumberFormat('@').setValues(eVals);
    }
  }

  try {
    SpreadsheetApp.getUi().alert(`✅ เติมเวลาทำงานมาตรฐาน (08:30 - 17:30) ในช่องเวลาเข้า-ออกงาน เรียบร้อยแล้ว (${count} รายการ)`);
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
      'เวลาเข้า', 'เวลาออก', 'สถานที่',
      'ละติจูด', 'ลองจิจูด', 'ลิงก์แผนที่',
      'ละติจูดออก', 'ลองจิจูดออก', 'ลิงก์แผนที่ออก',
      'สถานะ', 'รูปถ่าย', 'หมายเหตุ'
    ];
    attSheet.appendRow(headers);
    attSheet.getRange('A1:K1').setFontWeight('bold').setBackground('#e0f2fe').setFontColor('#0369a1');
    attSheet.getRange('L1:N1').setFontWeight('bold').setBackground('#ffe4e6').setFontColor('#9f1239');
    attSheet.getRange('O1:Q1').setFontWeight('bold').setBackground('#e0f2fe').setFontColor('#0369a1');
    attSheet.setFrozenRows(1);
  } else {
    const cols = getAttendanceColumnMapping(attSheet);
    if (cols.outLatCol === -1) {
      setupClockOutGpsColumnsInSheet(attSheet);
    }
  }

  // 2. ตารางรายชื่อพนักงาน
  let empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!empSheet) {
    empSheet = ss.insertSheet(SHEET_EMPLOYEES);
    const headers = ['รหัสพนักงาน', 'ชื่อ-นามสกุล', 'แผนก', 'password', 'เวลาเข้างาน', 'เวลาออกงาน'];
    empSheet.appendRow(headers);
    empSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
    empSheet.setFrozenRows(1);

    // ใส่ข้อมูลพนักงานเริ่มต้น
    empSheet.appendRow(['EMP-001', 'สมชาย สายลุย', 'ฝ่ายพัฒนาธุรกิจ', '1234', '08:30', '17:30']);
    empSheet.appendRow(['EMP-002', 'กัญญาภัทร ใจมั่น', 'ฝ่ายบุคคล (HR)', '1234', '08:30', '17:30']);
  } else {
    // ตรวจสอบและตั้งชื่อหัวคอลัมน์ password, เวลาเข้างาน, เวลาออกงาน หากยังไม่มี
    const lastCol = Math.max(empSheet.getLastColumn(), 6);
    const headerVals = empSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    let pwdColIndex = 4; // ค่าเริ่มต้นคอลัมน์ D (1-based)
    let startColIndex = 5; // ค่าเริ่มต้นคอลัมน์ E (1-based)
    let endColIndex = 6;   // ค่าเริ่มต้นคอลัมน์ F (1-based)
    let hasPwdHeader = false;
    let hasStartHeader = false;
    let hasEndHeader = false;

    for (let c = 0; c < headerVals.length; c++) {
      const h = String(headerVals[c] || '').trim().toLowerCase();
      if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
        pwdColIndex = c + 1;
        hasPwdHeader = true;
      } else if (h.includes('เวลาเข้า') || h === 'workstart' || h === 'start') {
        startColIndex = c + 1;
        hasStartHeader = true;
      } else if (h.includes('เวลาออก') || h.includes('เวลาเลิก') || h === 'workend' || h === 'end') {
        endColIndex = c + 1;
        hasEndHeader = true;
      }
    }

    if (!hasPwdHeader) {
      empSheet.getRange(1, 4).setValue('password');
      empSheet.getRange(1, 4).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
      pwdColIndex = 4;
    }
    if (!hasStartHeader) {
      empSheet.getRange(1, 5).setValue('เวลาเข้างาน');
      empSheet.getRange(1, 5).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
      startColIndex = 5;
    }
    if (!hasEndHeader) {
      empSheet.getRange(1, 6).setValue('เวลาออกงาน');
      empSheet.getRange(1, 6).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
      endColIndex = 6;
    }

    // เติมรหัสผ่านเริ่มต้น 1234 และเวลาทำงานเริ่มต้นให้แถวพนักงานเดิมที่ยังไม่มีข้อมูล
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

      // ตรวจสอบและเติมเวลาเข้างาน/ออกงานเริ่มต้น (08:30 / 17:30)
      const sRange = empSheet.getRange(2, startColIndex, lastRow - 1, 1);
      const sVals = sRange.getValues();
      let sChanged = false;
      for (let r = 0; r < sVals.length; r++) {
        if (!sVals[r][0] || String(sVals[r][0]).trim() === '') {
          sVals[r][0] = '08:30';
          sChanged = true;
        }
      }
      if (sChanged) {
        sRange.setNumberFormat('@').setValues(sVals);
      }

      const eRange = empSheet.getRange(2, endColIndex, lastRow - 1, 1);
      const eVals = eRange.getValues();
      let eChanged = false;
      for (let r = 0; r < eVals.length; r++) {
        if (!eVals[r][0] || String(eVals[r][0]).trim() === '') {
          eVals[r][0] = '17:30';
          eChanged = true;
        }
      }
      if (eChanged) {
        eRange.setNumberFormat('@').setValues(eVals);
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
    let idCol = 0, nameCol = 1, deptCol = 2, pwdCol = 3, startCol = 4, endCol = 5;
    if (empData.length > 0) {
      const headers = empData[0];
      for (let c = 0; c < headers.length; c++) {
        const h = String(headers[c] || '').trim().toLowerCase();
        if (h.includes('รหัสพนักงาน') || h === 'empid' || h === 'id') idCol = c;
        else if (h.includes('ชื่อ') || h === 'name') nameCol = c;
        else if (h.includes('แผนก') || h === 'dept' || h === 'department') deptCol = c;
        else if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) pwdCol = c;
        else if (h.includes('เวลาเข้า') || h === 'workstart' || h === 'start') startCol = c;
        else if (h.includes('เวลาออก') || h.includes('เวลาเลิก') || h === 'workend' || h === 'end') endCol = c;
      }
      if (pwdCol < 0) pwdCol = 3;
      if (startCol < 0) startCol = 4;
      if (endCol < 0) endCol = 5;
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

        let empStart = (startCol >= 0 && empData[i][startCol] !== undefined && String(empData[i][startCol]).trim() !== '')
          ? empData[i][startCol]
          : '08:30';
        if (empStart instanceof Date) {
          empStart = Utilities.formatDate(empStart, 'Asia/Bangkok', 'HH:mm');
        } else {
          empStart = String(empStart).trim();
          const matchS = empStart.match(/(\d{1,2}):(\d{2})/);
          if (matchS) empStart = `${matchS[1].padStart(2, '0')}:${matchS[2]}`;
          else empStart = '08:30';
        }

        let empEnd = (endCol >= 0 && empData[i][endCol] !== undefined && String(empData[i][endCol]).trim() !== '')
          ? empData[i][endCol]
          : '17:30';
        if (empEnd instanceof Date) {
          empEnd = Utilities.formatDate(empEnd, 'Asia/Bangkok', 'HH:mm');
        } else {
          empEnd = String(empEnd).trim();
          const matchE = empEnd.match(/(\d{1,2}):(\d{2})/);
          if (matchE) empEnd = `${matchE[1].padStart(2, '0')}:${matchE[2]}`;
          else empEnd = '17:30';
        }

        employees.push({
          id: empId,
          name: empName,
          dept: empDept,
          username: empId, // รหัสพนักงานใช้เป็น User
          password: empPass,
          workStart: empStart,
          workEnd: empEnd
        });
      }
    }

    // 2. ดึงข้อมูลบันทึกเวลา
    const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
    const attData = attSheet.getDataRange().getValues();
    const cols = getAttendanceColumnMapping(attSheet);
    const attendances = [];
    for (let i = 1; i < attData.length; i++) {
      if (attData[i][cols.idCol - 1]) {
        let dateVal = attData[i][cols.dateCol - 1];
        if (dateVal instanceof Date) {
          const y = dateVal.getFullYear();
          const m = String(dateVal.getMonth() + 1).padStart(2, '0');
          const d = String(dateVal.getDate()).padStart(2, '0');
          dateVal = `${y}-${m}-${d}`;
        }
        
        let checkInVal = attData[i][cols.checkInCol - 1];
        if (checkInVal instanceof Date) {
          checkInVal = Utilities.formatDate(checkInVal, 'Asia/Bangkok', 'HH:mm:ss');
        }

        let checkOutVal = attData[i][cols.checkOutCol - 1];
        if (checkOutVal instanceof Date) {
          checkOutVal = Utilities.formatDate(checkOutVal, 'Asia/Bangkok', 'HH:mm:ss');
        }

        const rowEmpId = String(attData[i][cols.empIdCol - 1] || '').trim().toLowerCase();
        if (rowEmpId === 'chana.p' || rowEmpId === 'admin') {
          continue;
        }

        const rowEmpName = String(attData[i][cols.empNameCol - 1] || '').trim();
        const rowDept = String(attData[i][cols.deptCol - 1] || '').trim();

        let rowLat = cols.inLatCol > 0 ? String(attData[i][cols.inLatCol - 1] || '').trim() : '';
        let rowLng = cols.inLngCol > 0 ? String(attData[i][cols.inLngCol - 1] || '').trim() : '';
        let rowOutLat = cols.outLatCol > 0 ? String(attData[i][cols.outLatCol - 1] || '').trim() : '';
        let rowOutLng = cols.outLngCol > 0 ? String(attData[i][cols.outLngCol - 1] || '').trim() : '';

        // ระบุพิกัดสาขาเข้างานถ้ายังเป็นดีฟอลต์ 13.7563
        const resolvedIn = resolveBranchLocation(rowEmpId, rowEmpName, rowDept, rowLat, rowLng);
        rowLat = resolvedIn.lat;
        rowLng = resolvedIn.lng;

        // ดึงพิกัดออกงานเฉพาะเมื่อมีการบันทึกพิกัดออกงานจริง
        let outGPS = null;
        if (rowOutLat && rowOutLng && rowOutLat !== '13.7563') {
          outGPS = { lat: rowOutLat, lng: rowOutLng };
        } else if (cols.outLatCol > 0 && rowOutLat && rowOutLng) {
          outGPS = { lat: rowOutLat, lng: rowOutLng };
        }

        const inGPS = (rowLat && rowLng) ? { lat: rowLat, lng: rowLng } : null;

        const statusVal = cols.statusCol > 0 ? String(attData[i][cols.statusCol - 1] || 'ON_TIME') : 'ON_TIME';
        const photoVal = cols.photoCol > 0 ? String(attData[i][cols.photoCol - 1] || '') : '';
        const noteVal = cols.noteCol > 0 ? String(attData[i][cols.noteCol - 1] || '') : '';

        attendances.push({
          id: String(attData[i][cols.idCol - 1]),
          date: String(dateVal || ''),
          empId: String(attData[i][cols.empIdCol - 1] || ''),
          empName: rowEmpName,
          dept: rowDept,
          checkIn: checkInVal ? String(checkInVal) : null,
          checkOut: checkOutVal ? String(checkOutVal) : null,
          location: String(attData[i][cols.locCol - 1] || 'สำนักงานใหญ่'),
          gps: inGPS || outGPS || { lat: '13.7563', lng: '100.5018' },
          checkInGPS: inGPS,
          checkOutGPS: outGPS,
          status: statusVal,
          photo: photoVal,
          note: noteVal
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
      const record = data.record || {};
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const cols = getAttendanceColumnMapping(attSheet);
      let inLat = (record.checkInGPS && record.checkInGPS.lat) ? String(record.checkInGPS.lat) : (record.gps && record.gps.lat ? String(record.gps.lat) : '');
      let inLng = (record.checkInGPS && record.checkInGPS.lng) ? String(record.checkInGPS.lng) : (record.gps && record.gps.lng ? String(record.gps.lng) : '');
      const resolved = resolveBranchLocation(record.empId, record.empName, record.dept, inLat, inLng);
      inLat = resolved.lat;
      inLng = resolved.lng;
      const mapsLink = (inLat && inLng) ? `https://www.google.com/maps?q=${inLat},${inLng}` : '';

      let photoStr = String(record.photo || '');
      if (photoStr.length > 45000) {
        photoStr = photoStr.substring(0, 45000);
      }

      let outLat = (record.checkOutGPS && record.checkOutGPS.lat) ? String(record.checkOutGPS.lat) : '';
      let outLng = (record.checkOutGPS && record.checkOutGPS.lng) ? String(record.checkOutGPS.lng) : '';
      let outMapsLink = (outLat && outLng) ? `https://www.google.com/maps?q=${outLat},${outLng}` : '';

      if (cols.outLatCol > 0) {
        attSheet.appendRow([
          record.id || ('ATT-' + Date.now()),
          record.date || '',
          record.empId || '',
          record.empName || '',
          record.dept || '',
          record.checkIn || '',
          record.checkOut || '',
          record.location || resolved.branch || 'สำนักงานใหญ่',
          inLat,
          inLng,
          mapsLink,
          outLat,
          outLng,
          outMapsLink,
          record.status || 'ON_TIME',
          photoStr,
          record.note || ''
        ]);
      } else {
        attSheet.appendRow([
          record.id || ('ATT-' + Date.now()),
          record.date || '',
          record.empId || '',
          record.empName || '',
          record.dept || '',
          record.checkIn || '',
          record.checkOut || '',
          record.location || resolved.branch || 'สำนักงานใหญ่',
          inLat,
          inLng,
          mapsLink,
          record.status || 'ON_TIME',
          photoStr,
          record.note || ''
        ]);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'clockIn' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. บันทึกออกงาน (Clock Out)
    if (action === 'clockOut') {
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const cols = getAttendanceColumnMapping(attSheet);
      const rows = attSheet.getDataRange().getValues();
      let updated = false;

      // ค้นหาแถวของพนักงานในวันนี้ (เริ่มค้นจากแถวล่าสุดย้อนขึ้นมา)
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowDate = rows[i][cols.dateCol - 1];
        let dateStr = rowDate;
        if (rowDate instanceof Date) {
          const y = rowDate.getFullYear();
          const m = String(rowDate.getMonth() + 1).padStart(2, '0');
          const d = String(rowDate.getDate()).padStart(2, '0');
          dateStr = `${y}-${m}-${d}`;
        }

        const rowEmpId = cleanId(rows[i][cols.empIdCol - 1]);
        const targetEmpId = cleanId(data.empId);

        if (rowEmpId === targetEmpId && dateStr === data.date) {
          // อัปเดตเวลาออก
          attSheet.getRange(i + 1, cols.checkOutCol).setNumberFormat('@').setValue(data.checkOut);
          if (data.photo && cols.photoCol > 0) {
            let pStr = String(data.photo);
            if (pStr.length > 45000) pStr = pStr.substring(0, 45000);
            attSheet.getRange(i + 1, cols.photoCol).setValue(pStr);
          }

          const outGpsObj = data.checkOutGPS || data.gps;
          let outLat = outGpsObj && outGpsObj.lat ? String(outGpsObj.lat) : '';
          let outLng = outGpsObj && outGpsObj.lng ? String(outGpsObj.lng) : '';
          const resolved = resolveBranchLocation(data.empId, rows[i][cols.empNameCol - 1], rows[i][cols.deptCol - 1], outLat, outLng);
          outLat = resolved.lat;
          outLng = resolved.lng;

          // บันทึกพิกัดออกงานลงในคอลัมน์ออกงานโดยเฉพาะ (ไม่ทับพิกัดเข้างาน)
          if (cols.outLatCol > 0 && cols.outLngCol > 0) {
            attSheet.getRange(i + 1, cols.outLatCol).setValue(outLat);
            attSheet.getRange(i + 1, cols.outLngCol).setValue(outLng);
            if (cols.outMapCol > 0) {
              attSheet.getRange(i + 1, cols.outMapCol).setValue(`https://www.google.com/maps?q=${outLat},${outLng}`);
            }
          } else if (!rows[i][cols.inLatCol - 1] && outLat && outLng) {
            // กรณีเป็นตารางเดิม 14 คอลัมน์ และยังไม่มีพิกัดเข้างาน จึงเติมพิกัดให้
            attSheet.getRange(i + 1, cols.inLatCol).setValue(outLat);
            attSheet.getRange(i + 1, cols.inLngCol).setValue(outLng);
            if (cols.inMapCol > 0) {
              attSheet.getRange(i + 1, cols.inMapCol).setValue(`https://www.google.com/maps?q=${outLat},${outLng}`);
            }
          }
          updated = true;
          break;
        }
      }

      // ถ้าไม่พบรายการเข้างาน ให้สร้างแถวใหม่สำหรับการออกงาน
      if (!updated) {
        const outGpsObj = data.checkOutGPS || data.gps;
        let outLat = outGpsObj && outGpsObj.lat ? String(outGpsObj.lat) : '';
        let outLng = outGpsObj && outGpsObj.lng ? String(outGpsObj.lng) : '';
        const resolved = resolveBranchLocation(data.empId, data.empName, data.dept, outLat, outLng);
        outLat = resolved.lat;
        outLng = resolved.lng;
        const outMapsLink = (outLat && outLng) ? `https://www.google.com/maps?q=${outLat},${outLng}` : '';
        let photoStr = String(data.photo || '');
        if (photoStr.length > 45000) photoStr = photoStr.substring(0, 45000);

        if (cols.outLatCol > 0) {
          attSheet.appendRow([
            data.id || ('ATT-' + Date.now()),
            data.date,
            data.empId,
            data.empName || '',
            data.dept || '',
            '', // ไม่มีเวลาเข้า
            data.checkOut,
            data.location || resolved.branch || 'สำนักงานใหญ่',
            '', '', '', // ไม่มีพิกัดเข้า
            outLat,
            outLng,
            outMapsLink,
            'ON_TIME',
            photoStr,
            data.note || 'ไม่ได้ตอกเข้า'
          ]);
        } else {
          attSheet.appendRow([
            data.id || ('ATT-' + Date.now()),
            data.date,
            data.empId,
            data.empName || '',
            data.dept || '',
            '', // ไม่มีเวลาเข้า
            data.checkOut,
            data.location || resolved.branch || 'สำนักงานใหญ่',
            outLat,
            outLng,
            outMapsLink,
            'ON_TIME',
            photoStr,
            data.note || 'ไม่ได้ตอกเข้า'
          ]);
        }
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'clockOut' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. เพิ่มพนักงานใหม่ (Add Employee)
    if (action === 'addEmployee') {
      const emp = data.employee || {};
      const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
      const password = String(emp.password || '1234').trim();
      const workStart = String(emp.workStart || '08:30').trim();
      const workEnd = String(emp.workEnd || '17:30').trim();
      empSheet.appendRow([emp.id, emp.name, emp.dept, password, workStart, workEnd]);
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

      const targetId = cleanId(empId);
      for (let i = 1; i < rows.length; i++) {
        const rowId = cleanId(rows[i][0]);
        if (rowId === targetId) {
          empSheet.getRange(i + 1, pwdCol).setValue(newPassword);
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'updateEmployeePassword' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3.2 กำหนดเวลาเข้า-ออกงานพนักงาน (Update Employee Work Schedule)
    if (action === 'updateEmployeeSchedule') {
      const empId = cleanId(data.empId);
      const workStart = String(data.workStart || '08:30').trim();
      const workEnd = String(data.workEnd || '17:30').trim();
      const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
      const rows = empSheet.getDataRange().getValues();

      let startCol = 5; // Column E (1-based)
      let endCol = 6;   // Column F (1-based)
      if (rows.length > 0) {
        for (let c = 0; c < rows[0].length; c++) {
          const h = String(rows[0][c] || '').trim().toLowerCase();
          if (h.includes('เวลาเข้า') || h === 'workstart' || h === 'start') startCol = c + 1;
          else if (h.includes('เวลาออก') || h.includes('เวลาเลิก') || h === 'workend' || h === 'end') endCol = c + 1;
        }
      }

      let updated = false;
      for (let i = 1; i < rows.length; i++) {
        const rowId = cleanId(rows[i][0]);
        if (rowId === empId) {
          empSheet.getRange(i + 1, startCol).setNumberFormat('@').setValue(workStart);
          empSheet.getRange(i + 1, endCol).setNumberFormat('@').setValue(workEnd);
          updated = true;
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'updateEmployeeSchedule', updated }))
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
      const empId = cleanId(data.empId);
      const dateStr = String(data.date || '').trim();
      const attSheet = ss.getSheetByName(SHEET_ATTENDANCE);
      const cols = getAttendanceColumnMapping(attSheet);
      const rows = attSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowId = String(rows[i][cols.idCol - 1] || '').trim();
        const rowEmpId = cleanId(rows[i][cols.empIdCol - 1]);
        let rowDate = rows[i][cols.dateCol - 1];
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
      const cols = getAttendanceColumnMapping(attSheet);
      const rows = attSheet.getDataRange().getValues();
      const targetId = cleanId(record.id);
      const targetEmpId = cleanId(record.empId);
      const targetDate = String(record.date || '').trim();
      let updated = false;

      for (let i = 1; i < rows.length; i++) {
        const rowId = cleanId(rows[i][cols.idCol - 1]);
        const rowEmpId = cleanId(rows[i][cols.empIdCol - 1]);
        let rowDate = rows[i][cols.dateCol - 1];
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
          if (record.date && cols.dateCol > 0) attSheet.getRange(i + 1, cols.dateCol).setValue(record.date);
          if (record.checkIn !== undefined && cols.checkInCol > 0) {
            attSheet.getRange(i + 1, cols.checkInCol).setNumberFormat('@').setValue(record.checkIn || '');
          }
          if (record.checkOut !== undefined && cols.checkOutCol > 0) {
            attSheet.getRange(i + 1, cols.checkOutCol).setNumberFormat('@').setValue(record.checkOut || '');
          }
          if (record.location && cols.locCol > 0) attSheet.getRange(i + 1, cols.locCol).setValue(record.location);

          // อัปเดตพิกัดเข้างาน
          const inGps = record.checkInGPS || record.gps;
          if (inGps && inGps.lat && inGps.lng && cols.inLatCol > 0 && cols.inLngCol > 0) {
            const resolvedIn = resolveBranchLocation(record.empId || rows[i][cols.empIdCol - 1], record.empName || rows[i][cols.empNameCol - 1], record.dept || rows[i][cols.deptCol - 1], inGps.lat, inGps.lng);
            attSheet.getRange(i + 1, cols.inLatCol).setValue(resolvedIn.lat);
            attSheet.getRange(i + 1, cols.inLngCol).setValue(resolvedIn.lng);
            if (cols.inMapCol > 0) {
              attSheet.getRange(i + 1, cols.inMapCol).setValue(`https://www.google.com/maps?q=${resolvedIn.lat},${resolvedIn.lng}`);
            }
          }

          // อัปเดตพิกัดออกงาน
          const outGps = record.checkOutGPS;
          if (outGps && outGps.lat && outGps.lng && cols.outLatCol > 0 && cols.outLngCol > 0) {
            const resolvedOut = resolveBranchLocation(record.empId || rows[i][cols.empIdCol - 1], record.empName || rows[i][cols.empNameCol - 1], record.dept || rows[i][cols.deptCol - 1], outGps.lat, outGps.lng);
            attSheet.getRange(i + 1, cols.outLatCol).setValue(resolvedOut.lat);
            attSheet.getRange(i + 1, cols.outLngCol).setValue(resolvedOut.lng);
            if (cols.outMapCol > 0) {
              attSheet.getRange(i + 1, cols.outMapCol).setValue(`https://www.google.com/maps?q=${resolvedOut.lat},${resolvedOut.lng}`);
            }
          }

          if (record.status && cols.statusCol > 0) attSheet.getRange(i + 1, cols.statusCol).setValue(record.status);
          if (record.note !== undefined && cols.noteCol > 0) attSheet.getRange(i + 1, cols.noteCol).setValue(record.note || '');
          updated = true;
          break;
        }
      }

      // ถ้าไม่พบแถวเดิม ให้สร้างใหม่ทันที ไม่ให้ข้อมูลสูญหาย
      if (!updated && (record.empId || targetEmpId)) {
        let inLat = (record.checkInGPS && record.checkInGPS.lat) ? String(record.checkInGPS.lat) : (record.gps && record.gps.lat ? String(record.gps.lat) : '');
        let inLng = (record.checkInGPS && record.checkInGPS.lng) ? String(record.checkInGPS.lng) : (record.gps && record.gps.lng ? String(record.gps.lng) : '');
        const resolvedIn = resolveBranchLocation(record.empId, record.empName, record.dept, inLat, inLng);
        inLat = resolvedIn.lat;
        inLng = resolvedIn.lng;
        const inMapsLink = (inLat && inLng) ? `https://www.google.com/maps?q=${inLat},${inLng}` : '';

        let outLat = (record.checkOutGPS && record.checkOutGPS.lat) ? String(record.checkOutGPS.lat) : '';
        let outLng = (record.checkOutGPS && record.checkOutGPS.lng) ? String(record.checkOutGPS.lng) : '';
        const resolvedOut = resolveBranchLocation(record.empId, record.empName, record.dept, outLat, outLng);
        outLat = resolvedOut.lat;
        outLng = resolvedOut.lng;
        const outMapsLink = (outLat && outLng) ? `https://www.google.com/maps?q=${outLat},${outLng}` : '';

        let photoStr = String(record.photo || '');
        if (photoStr.length > 45000) photoStr = photoStr.substring(0, 45000);

        if (cols.outLatCol > 0) {
          attSheet.appendRow([
            record.id || ('ATT-' + Date.now()),
            record.date || '',
            record.empId || '',
            record.empName || '',
            record.dept || '',
            record.checkIn || '',
            record.checkOut || '',
            record.location || resolvedIn.branch || 'สำนักงานใหญ่',
            inLat,
            inLng,
            inMapsLink,
            outLat,
            outLng,
            outMapsLink,
            record.status || 'ON_TIME',
            photoStr,
            record.note || ''
          ]);
        } else {
          attSheet.appendRow([
            record.id || ('ATT-' + Date.now()),
            record.date || '',
            record.empId || '',
            record.empName || '',
            record.dept || '',
            record.checkIn || '',
            record.checkOut || '',
            record.location || resolvedIn.branch || 'สำนักงานใหญ่',
            inLat || outLat,
            inLng || outLng,
            inMapsLink || outMapsLink,
            record.status || 'ON_TIME',
            photoStr,
            record.note || ''
          ]);
        }
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

        // ตรวจสอบและใส่หัวคอลัมน์ password, เวลาเข้างาน, เวลาออกงาน หากยังไม่มี
        let pwdCol = 4; // Column D (1-based)
        let startCol = 5; // Column E (1-based)
        let endCol = 6;   // Column F (1-based)
        if (existingRows.length > 0) {
          let foundPwd = false, foundStart = false, foundEnd = false;
          for (let c = 0; c < existingRows[0].length; c++) {
            const h = String(existingRows[0][c] || '').trim().toLowerCase();
            if (h === 'password' || h === 'pass' || h.includes('รหัสผ่าน')) {
              pwdCol = c + 1;
              foundPwd = true;
            } else if (h.includes('เวลาเข้า') || h === 'workstart' || h === 'start') {
              startCol = c + 1;
              foundStart = true;
            } else if (h.includes('เวลาออก') || h.includes('เวลาเลิก') || h === 'workend' || h === 'end') {
              endCol = c + 1;
              foundEnd = true;
            }
          }
          if (!foundPwd) {
            empSheet.getRange(1, 4).setValue('password');
            empSheet.getRange(1, 4).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
            pwdCol = 4;
          }
          if (!foundStart) {
            empSheet.getRange(1, 5).setValue('เวลาเข้างาน');
            empSheet.getRange(1, 5).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
            startCol = 5;
          }
          if (!foundEnd) {
            empSheet.getRange(1, 6).setValue('เวลาออกงาน');
            empSheet.getRange(1, 6).setFontWeight('bold').setBackground('#e0e7ff').setFontColor('#3730a3');
            endCol = 6;
          }
        }

        const existingIdRowMap = new Map();
        for (let i = 1; i < existingRows.length; i++) {
          if (existingRows[i][0] !== undefined && existingRows[i][0] !== '') {
            const rawId = cleanId(existingRows[i][0]);
            existingIdRowMap.set(rawId, i + 1);
          }
        }
        data.employees.forEach(emp => {
          if (emp && emp.id) {
            const rawEmpId = cleanId(emp.id);
            const password = String(emp.password || '1234').trim();
            const workStart = String(emp.workStart || '08:30').trim();
            const workEnd = String(emp.workEnd || '17:30').trim();

            if (existingIdRowMap.has(rawEmpId)) {
              const rowIndex = existingIdRowMap.get(rawEmpId);
              empSheet.getRange(rowIndex, pwdCol).setValue(password);
              if (emp.workStart) empSheet.getRange(rowIndex, startCol).setNumberFormat('@').setValue(workStart);
              if (emp.workEnd) empSheet.getRange(rowIndex, endCol).setNumberFormat('@').setValue(workEnd);
            } else {
              empSheet.appendRow([emp.id, emp.name, emp.dept, password, workStart, workEnd]);
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
