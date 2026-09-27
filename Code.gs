const SHEET_NAME = "Transactions";
const DEBTS_SHEET = "Debts";
const ADMIN_EMAIL = "john2001ray@gmail.com";
const GITHUB_OWNER = "Jong543";
const GITHUB_REPO = "Financial-Tracker";

const GEMINI_MODEL = "gemini-3.8-flash";

function getDatabaseSpreadsheet() {
  const id = getSecret("DATABASE_SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("DATABASE_SPREADSHEET_ID is missing in Script Properties.");
}

function getSecret(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

function doGet() {
  return HtmlService.createTemplateFromFile("Page")
    .evaluate()
    .setTitle("Finance Tracker Dashboard with AI & GitHub Sync")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getUserRole() {
  try {
    const email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
    const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return { email: email, isAdmin: isAdmin };
  } catch (e) {
    return { email: "guest", isAdmin: false };
  }
}

function askGeminiAI(userPrompt, financialContext) {
  const key = getSecret("GEMINI_API_KEY");

  if (!key) {
    return "Error: GEMINI_API_KEY is missing in Script Properties.";
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent";

  const safeContext = {
    transactions: financialContext && Array.isArray(financialContext.transactions) ? financialContext.transactions : [],
    debts: financialContext && Array.isArray(financialContext.debts) ? financialContext.debts : []
  };

  const payload = {
    systemInstruction: {
      parts: [{
        text: "You are a personal finance AI assistant. Answer using only the financial data provided. Do not invent financial records."
      }]
    },
    contents: [{
      role: "user",
      parts: [{
        text: "CURRENT FINANCIAL DATA:\n" + JSON.stringify(safeContext) + "\n\nUSER QUESTION:\n" + String(userPrompt || "")
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-goog-api-key": key
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const json = JSON.parse(response.getContentText());

    if (json.error) {
      return "Gemini API Error (" + statusCode + "): " + (json.error.message || "Unknown error");
    }

    if (!json.candidates || !json.candidates.length) {
      return "Walang response na natanggap mula sa Gemini.";
    }

    const parts = json.candidates[0].content && json.candidates[0].content.parts;

    if (!parts) {
      return "Gemini returned an empty response.";
    }

    const text = parts
      .filter(part => part && typeof part.text === "string")
      .map(part => part.text)
      .join("\n")
      .trim();

    return text || "Gemini returned no text response.";

  } catch (e) {
    return "Script Error: " + e.toString();
  }
}

function askChatGPT(userPrompt, financialContext) {
  return askGeminiAI(userPrompt, financialContext);
}

function testGeminiConnection() {
  return askGeminiAI("Reply with exactly: Gemini connection successful.", { transactions: [], debts: [] });
}

function checkGeminiKey() {
  const key = getSecret("GEMINI_API_KEY");
  if (!key) return "❌ GEMINI_API_KEY NOT FOUND";
  return "✅ GEMINI_API_KEY FOUND (" + key.length + " characters)";
}

function backupCodeToGitHub(targetBranch, fileName) {
  const token = getSecret("GITHUB_TOKEN");
  const branch = targetBranch || "testing";
  const path = fileName || "Code.gs";
  const content = getFileContentForBackup(path);
  const url = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path + "?ref=" + branch;
  const headers = {
    "Authorization": "token " + token,
    "User-Agent": "AppsScript-Backup",
    "Accept": "application/vnd.github.v3+json"
  };
  let sha = "";
  try {
    const getRes = UrlFetchApp.fetch(url, { method: "get", headers: headers, muteHttpExceptions: true });
    if (getRes.getResponseCode() === 200) {
      sha = JSON.parse(getRes.getContentText()).sha || "";
    }
  } catch (e) {}
  const updateUrl = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + path;
  const payload = {
    message: "Auto-sync " + path,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) payload.sha = sha;
  const res = UrlFetchApp.fetch(updateUrl, {
    method: "put",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return {
    success: res.getResponseCode() === 200 || res.getResponseCode() === 201,
    message: res.getContentText()
  };
}