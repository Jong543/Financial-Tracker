const SHEET_NAME = "Transactions";
const DEBTS_SHEET = "Debts";
const ADMIN_EMAIL = "john2001ray@gmail.com";

const GITHUB_OWNER = "Jong543";
const GITHUB_REPO = "Financial-Tracker";

function getSecret(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

function doGet() {
  return HtmlService.createTemplateFromFile('Page')
    .evaluate()
    .setTitle('Finance Tracker Dashboard with AI & GitHub Sync')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getUserRole() {
  try {
    const email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    const isAdmin = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    return { email: email, isAdmin: isAdmin };
  } catch (e) {
    return { email: "guest", isAdmin: false };
  }
}

function getSheetData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("FinanceTracker_DB");
  
  const txSheet = getOrCreateSheet(ss, SHEET_NAME, ["ID", "Date", "Description", "Type", "Category", "Amount"]);
  const txRows = txSheet.getDataRange().getValues();
  const transactions = txRows.length <= 1 ? [] : txRows.slice(1).map(row => ({
    id: row[0], date: row[1], description: row[2], type: row[3], category: row[4], amount: row[5]
  }));

  const debtSheet = getOrCreateSheet(ss, DEBTS_SHEET, ["ID", "Creditor", "InitialAmount", "RemainingAmount", "TargetDate"]);
  const debtRows = debtSheet.getDataRange().getValues();
  const debts = debtRows.length <= 1 ? [] : debtRows.slice(1).map(row => ({
    id: row[0], creditor: row[1], initialAmount: row[2], remainingAmount: row[3], targetDate: row[4]
  }));

  return { transactions, debts, user: getUserRole() };
}

function addTransaction(tx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAME, ["ID", "Date", "Description", "Type", "Category", "Amount"]);
  const id = "TX_" + new Date().getTime();
  sheet.appendRow([id, tx.date, tx.description, tx.type, tx.category, Number(tx.amount)]);
  return { success: true, id: id };
}

function deleteTransaction(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return { success: false };
  
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == id) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}

function addDebt(debt) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, DEBTS_SHEET, ["ID", "Creditor", "InitialAmount", "RemainingAmount", "TargetDate"]);
  const id = "DBT_" + new Date().getTime();
  sheet.appendRow([id, debt.creditor, Number(debt.amount), Number(debt.amount), debt.targetDate || ""]);
  return { success: true };
}

function updateDebtRemaining(id, newRemaining) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DEBTS_SHEET);
  if (!sheet) return { success: false };
  
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == id) {
      sheet.getRange(i + 1, 4).setValue(Number(newRemaining));
      return { success: true };
    }
  }
  return { success: false };
}

function askGeminiAI(userPrompt, financialContext) {
  const geminiApiKey = getSecret("GEMINI_API_KEY");
  if (!geminiApiKey) return "Error: GEMINI_API_KEY missing.";

  const models = ["gemini-1.5-flash-latest", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
  const systemInstruction = "Ikaw ay isang matalinong personal finance AI assistant na tumutulong kay John Ray Chua Ong.";
  const payload = { contents: [{ parts: [{ text: `${systemInstruction}\n\nCurrent Financial Data:\n${JSON.stringify(financialContext)}\n\nUser Question: ${userPrompt}` }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  let lastError = "";

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    try {
      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const result = JSON.parse(response.getContentText());
      if (statusCode === 200 && result.candidates && result.candidates[0] && result.candidates[0].content) {
        return result.candidates[0].content.parts[0].text;
      } else if (statusCode === 404) {
        lastError = `Model ${model} returned 404`;
        continue;
      } else if (result.error) {
        return `Gemini API Error (${statusCode}): ${result.error.message}`;
      }
    } catch (e) {
      lastError = e.message;
    }
  }
  return `Gemini AI Error: Hindi mahanap ang aktibong model (${lastError}).`;
}

function backupCodeToGitHub(targetBranch, fileName) {
  const role = getUserRole();
  if (!role.isAdmin) return { success: false, message: "Unauthorized." };

  const githubToken = getSecret("GITHUB_TOKEN");
  if (!githubToken) return { success: false, message: "Error: GITHUB_TOKEN missing." };

  const branch = targetBranch || "testing"; 
  const path = fileName || "Code.gs";
  const fileContent = getFileContentForBackup(path);

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${branch}`;
  const headers = { 
    "Authorization": "token " + githubToken, 
    "User-Agent": "AppsScript-Backup",
    "Accept": "application/vnd.github.v3+json"
  };

  let sha = "";
  try {
    const getRes = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
    if (getRes.getResponseCode() === 200) {
      sha = JSON.parse(getRes.getContentText()).sha;
    }
  } catch (e) {}

  const updateUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const payload = {
    message: `Auto-sync full ${path} to [${branch}] branch at ` + new Date().toISOString(),
    content: Utilities.base64Encode(fileContent, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) payload.sha = sha;

  const putOptions = {
    method: 'put',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(updateUrl, putOptions);
  return { success: response.getResponseCode() === 200 || response.getResponseCode() === 201, message: response.getContentText() };
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4F46E5").setFontColor("#FFFFFF");
  }
  return sheet;
}