/**
 * 7Habits Daily - Google Apps Script Backend
 * 
 * 設定手順:
 * 1. Google Spreadsheetを作成
 * 2. 拡張機能 > Apps Script を開く
 * 3. このコードを貼り付け
 * 4. デプロイ > 新しいデプロイ > ウェブアプリ
 * 5. アクセス: 全員（匿名ユーザーを含む）
 * 6. デプロイしてURLをコピー
 * 7. index.htmlのSCRIPT_URLに設定
 */

const APP_VERSION = 'v1.0';

// ============ MAIN HANDLERS ============

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    switch (data.action) {
      case 'register':
        return registerUser(ss, data);
      case 'checkin':
        return handleCheckin(ss, data);
      case 'saveDeclaration':
        return handleSaveDeclaration(ss, data);
      case 'saveChallenge':
        return handleSaveChallenge(ss, data);
      case 'saveFavorite':
        return handleSaveFavorite(ss, data);
      default:
        return createResponse({ error: 'Unknown action' });
    }
    
  } catch (error) {
    return createResponse({ error: error.message });
  }
}

function doGet(e) {
  try {
    const action = e?.parameter?.action || 'version';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    switch (action) {
      case 'version':
        return createResponse({
          version: APP_VERSION,
          name: '7Habits Daily Backend',
          deployedAt: new Date().toISOString()
        });
      case 'login':
        return loginUser(ss, e.parameter);
      case 'sync':
        return syncUserData(ss, e.parameter);
      case 'getTeamStats':
        return getTeamStats(ss);
      case 'getLeaderboard':
        return getLeaderboard(ss);
      default:
        return createResponse({ version: APP_VERSION });
    }
    
  } catch (error) {
    return createResponse({ error: error.message });
  }
}

// ============ USER MANAGEMENT ============

function registerUser(ss, data) {
  const sheet = getOrCreateSheet(ss, '7Habits_Users', [
    'Name', 'Email', 'PIN_Hash', 'Created_At', 'Last_Login', 
    'Total_Checkins', 'Current_Streak', 'Best_Streak', 'Declaration', 'Declaration_Date'
  ]);
  
  const email = data.email?.toLowerCase().trim();
  const name = data.name?.trim();
  const pin = data.pin;
  
  if (!email || !name || !pin) {
    return createResponse({ error: 'メール、名前、PINが必要です' });
  }
  
  // Check if user exists
  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][1]?.toLowerCase() === email) {
      return createResponse({ error: 'このメールアドレスは既に登録されています' });
    }
  }
  
  // Create new user
  const pinHash = hashPin(pin);
  const now = new Date().toISOString();
  
  sheet.appendRow([
    name, email, pinHash, now, now, 0, 0, 0, '', ''
  ]);
  
  SpreadsheetApp.flush();
  
  return createResponse({
    success: true,
    user: {
      name: name,
      email: email,
      totalCheckins: 0,
      currentStreak: 0,
      bestStreak: 0,
      declaration: '',
      declarationDate: ''
    }
  });
}

function loginUser(ss, params) {
  const sheet = ss.getSheetByName('7Habits_Users');
  if (!sheet) {
    return createResponse({ error: 'ユーザーが見つかりません' });
  }
  
  const email = params.email?.toLowerCase().trim();
  const pin = params.pin;
  
  if (!email || !pin) {
    return createResponse({ error: 'メールとPINを入力してください' });
  }
  
  const pinHash = hashPin(pin);
  const allData = sheet.getDataRange().getValues();
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][1]?.toLowerCase() === email && allData[i][2] === pinHash) {
      // Update last login
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      SpreadsheetApp.flush();
      
      return createResponse({
        success: true,
        user: {
          name: allData[i][0],
          email: allData[i][1],
          totalCheckins: allData[i][5] || 0,
          currentStreak: allData[i][6] || 0,
          bestStreak: allData[i][7] || 0,
          declaration: allData[i][8] || '',
          declarationDate: allData[i][9] || ''
        }
      });
    }
  }
  
  return createResponse({ error: 'メールまたはPINが正しくありません' });
}

function syncUserData(ss, params) {
  const sheet = ss.getSheetByName('7Habits_Users');
  if (!sheet) {
    return createResponse({ error: 'データが見つかりません' });
  }
  
  const email = params.email?.toLowerCase().trim();
  const allData = sheet.getDataRange().getValues();
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][1]?.toLowerCase() === email) {
      // Get challenge data
      const challengeSheet = ss.getSheetByName('7Habits_Challenges');
      let challengeData = null;
      
      if (challengeSheet) {
        const cData = challengeSheet.getDataRange().getValues();
        for (let j = 1; j < cData.length; j++) {
          if (cData[j][0] === email) {
            try {
              challengeData = JSON.parse(cData[j][1]);
            } catch(e) {}
            break;
          }
        }
      }
      
      return createResponse({
        success: true,
        user: {
          name: allData[i][0],
          email: allData[i][1],
          totalCheckins: allData[i][5] || 0,
          currentStreak: allData[i][6] || 0,
          bestStreak: allData[i][7] || 0,
          declaration: allData[i][8] || '',
          declarationDate: allData[i][9] || ''
        },
        challenge: challengeData
      });
    }
  }
  
  return createResponse({ error: 'ユーザーが見つかりません' });
}

// ============ DAILY CHECKIN ============

function handleCheckin(ss, data) {
  const email = data.email?.toLowerCase().trim();
  const checkinData = data.checkin; // { physical, spiritual, intellectual, social }
  const date = data.date; // YYYY-MM-DD
  
  if (!email || !date) {
    return createResponse({ error: 'データが不足しています' });
  }
  
  // Log checkin
  const logSheet = getOrCreateSheet(ss, '7Habits_Checkins', [
    'Email', 'Date', 'Physical', 'Spiritual', 'Intellectual', 'Social', 'Timestamp'
  ]);
  
  // Check if already checked in today
  const logData = logSheet.getDataRange().getValues();
  for (let i = 1; i < logData.length; i++) {
    if (logData[i][0] === email && logData[i][1] === date) {
      return createResponse({ error: '今日は既にチェックイン済みです' });
    }
  }
  
  logSheet.appendRow([
    email,
    date,
    checkinData.physical ? 1 : 0,
    checkinData.spiritual ? 1 : 0,
    checkinData.intellectual ? 1 : 0,
    checkinData.social ? 1 : 0,
    new Date().toISOString()
  ]);
  
  // Update user stats
  const userSheet = ss.getSheetByName('7Habits_Users');
  if (userSheet) {
    const userData = userSheet.getDataRange().getValues();
    for (let i = 1; i < userData.length; i++) {
      if (userData[i][1]?.toLowerCase() === email) {
        const rowIndex = i + 1;
        const totalCheckins = (userData[i][5] || 0) + 1;
        const currentStreak = calculateStreak(logSheet, email, date);
        const bestStreak = Math.max(userData[i][7] || 0, currentStreak);
        
        userSheet.getRange(rowIndex, 6).setValue(totalCheckins);
        userSheet.getRange(rowIndex, 7).setValue(currentStreak);
        userSheet.getRange(rowIndex, 8).setValue(bestStreak);
        
        SpreadsheetApp.flush();
        
        return createResponse({
          success: true,
          totalCheckins: totalCheckins,
          currentStreak: currentStreak,
          bestStreak: bestStreak
        });
      }
    }
  }
  
  return createResponse({ success: true });
}

function calculateStreak(logSheet, email, currentDate) {
  const data = logSheet.getDataRange().getValues().slice(1);
  
  // Get all dates for this user
  const userDates = data
    .filter(row => row[0] === email)
    .map(row => row[1])
    .sort()
    .reverse();
  
  if (userDates.length === 0) return 1;
  
  let streak = 1;
  const current = new Date(currentDate);
  
  for (let i = 0; i < userDates.length - 1; i++) {
    const thisDate = new Date(userDates[i]);
    const nextDate = new Date(userDates[i + 1]);
    
    const diff = (thisDate - nextDate) / (1000 * 60 * 60 * 24);
    
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }
  
  return streak;
}

// ============ DECLARATION ============

function handleSaveDeclaration(ss, data) {
  const email = data.email?.toLowerCase().trim();
  const declaration = data.declaration;
  
  if (!email) {
    return createResponse({ error: 'メールが必要です' });
  }
  
  const sheet = ss.getSheetByName('7Habits_Users');
  if (!sheet) {
    return createResponse({ error: 'ユーザーが見つかりません' });
  }
  
  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][1]?.toLowerCase() === email) {
      sheet.getRange(i + 1, 9).setValue(declaration);
      sheet.getRange(i + 1, 10).setValue(new Date().toISOString().split('T')[0]);
      SpreadsheetApp.flush();
      
      return createResponse({ success: true });
    }
  }
  
  return createResponse({ error: 'ユーザーが見つかりません' });
}

// ============ 30 DAY CHALLENGE ============

function handleSaveChallenge(ss, data) {
  const email = data.email?.toLowerCase().trim();
  const challengeData = data.challenge;
  
  if (!email || !challengeData) {
    return createResponse({ error: 'データが不足しています' });
  }
  
  const sheet = getOrCreateSheet(ss, '7Habits_Challenges', [
    'Email', 'Challenge_Data', 'Updated_At'
  ]);
  
  const allData = sheet.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === email) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(challengeData));
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow([email, JSON.stringify(challengeData), new Date().toISOString()]);
  }
  
  SpreadsheetApp.flush();
  return createResponse({ success: true });
}

// ============ FAVORITES ============

function handleSaveFavorite(ss, data) {
  const email = data.email?.toLowerCase().trim();
  const cardId = data.cardId;
  const isFavorite = data.isFavorite;
  
  if (!email || cardId === undefined) {
    return createResponse({ error: 'データが不足しています' });
  }
  
  const sheet = getOrCreateSheet(ss, '7Habits_Favorites', [
    'Email', 'Card_ID', 'Added_At'
  ]);
  
  const allData = sheet.getDataRange().getValues();
  
  if (isFavorite) {
    // Add favorite
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === email && allData[i][1] == cardId) {
        // Already exists
        return createResponse({ success: true });
      }
    }
    sheet.appendRow([email, cardId, new Date().toISOString()]);
  } else {
    // Remove favorite
    for (let i = allData.length - 1; i >= 1; i--) {
      if (allData[i][0] === email && allData[i][1] == cardId) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
  }
  
  SpreadsheetApp.flush();
  return createResponse({ success: true });
}

// ============ TEAM STATS ============

function getTeamStats(ss) {
  const userSheet = ss.getSheetByName('7Habits_Users');
  const checkinSheet = ss.getSheetByName('7Habits_Checkins');
  
  let totalMembers = 0;
  let totalCheckins = 0;
  let activeToday = 0;
  
  const today = new Date().toISOString().split('T')[0];
  
  if (userSheet) {
    const data = userSheet.getDataRange().getValues().slice(1);
    totalMembers = data.length;
    data.forEach(row => {
      totalCheckins += row[5] || 0;
    });
  }
  
  if (checkinSheet) {
    const data = checkinSheet.getDataRange().getValues().slice(1);
    const todayEmails = new Set();
    data.forEach(row => {
      if (row[1] === today) {
        todayEmails.add(row[0]);
      }
    });
    activeToday = todayEmails.size;
  }
  
  return createResponse({
    totalMembers: totalMembers,
    totalCheckins: totalCheckins,
    activeToday: activeToday
  });
}

function getLeaderboard(ss) {
  const userSheet = ss.getSheetByName('7Habits_Users');
  if (!userSheet) {
    return createResponse({ leaderboard: [] });
  }
  
  const data = userSheet.getDataRange().getValues().slice(1);
  const leaderboard = data
    .filter(row => row[0]) // Has name
    .map(row => ({
      name: row[0],
      totalCheckins: row[5] || 0,
      currentStreak: row[6] || 0,
      bestStreak: row[7] || 0
    }))
    .sort((a, b) => b.totalCheckins - a.totalCheckins)
    .slice(0, 10);
  
  return createResponse({ leaderboard: leaderboard });
}

// ============ UTILITIES ============

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function hashPin(pin) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin + 'SALT_7HABITS');
  return Utilities.base64Encode(hash);
}

function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
