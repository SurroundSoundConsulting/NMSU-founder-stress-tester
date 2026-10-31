// Read-only Drive/Docs adapter. Source files never hold processing state.
function week2GoogleGet(url) {
  var response = UrlFetchApp.fetch(url, {
    method: 'get', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}
  });
  if (response.getResponseCode() !== 200) throw new Error('Google input HTTP ' + response.getResponseCode());
  try { return JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Invalid Google input JSON'); }
}

function week2Hash(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function week2Config(options) {
  options = options || {};
  var props = PropertiesService.getScriptProperties();
  var config = {
    folderId: options.folderId || props.getProperty('WEEK2_INBOX_FOLDER_ID'),
    spreadsheetId: options.spreadsheetId || props.getProperty('WEEK2_SPREADSHEET_ID'),
    maxSources: options.maxSources === undefined ? 5 : options.maxSources,
    budgetMs: options.budgetMs === undefined ? 180000 : options.budgetMs,
    sourceIds: options.sourceIds || [], createdAfter: options.createdAfter || ''
  };
  if (!/^[\w-]+$/.test(config.folderId || '') || !/^[\w-]+$/.test(config.spreadsheetId || '')) throw new Error('Set explicit WEEK2_INBOX_FOLDER_ID and WEEK2_SPREADSHEET_ID');
  if (config.spreadsheetId === props.getProperty('SPREADSHEET_ID') || config.spreadsheetId === props.getProperty('SANDBOX_SPREADSHEET_ID')) throw new Error('Week 2 requires a destination separate from both Week 1 sheets');
  if (!Number.isInteger(config.maxSources) || config.maxSources < 1 || config.maxSources > 20 || !Number.isInteger(config.budgetMs) || config.budgetMs < 1000 || config.budgetMs > 240000) throw new Error('Invalid batch limits');
  if (!Array.isArray(config.sourceIds) || config.sourceIds.some(function(id) { return typeof id !== 'string' || !/^[\w-]+$/.test(id); })) throw new Error('Invalid selected source IDs');
  if (config.createdAfter && !validDate(config.createdAfter)) throw new Error('Invalid backfill creation date');
  return config;
}

function week2Discover(config) {
  var folder = week2GoogleGet('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(config.folderId) + '?fields=id,mimeType&supportsAllDrives=true');
  if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Input must be a Drive folder');
  var files = [], token = '', seen = {};
  do {
    var query = "'" + config.folderId + "' in parents and trashed = false";
    if (config.createdAfter) query += " and createdTime >= '" + config.createdAfter + "T00:00:00Z'";
    var page = week2GoogleGet('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&pageSize=100&fields=nextPageToken,incompleteSearch,files(id,name,mimeType,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    if (!Array.isArray(page.files) || page.incompleteSearch) throw new Error('Incomplete Drive discovery');
    page.files.forEach(function(file) { if (!seen[file.id]) { files.push(file); seen[file.id] = true; } });
    token = page.nextPageToken || '';
    if (files.length > 1000 || (token && seen['page:' + token])) throw new Error('Discovery limit reached; narrow the input folder or backfill window');
    if (token) seen['page:' + token] = true;
  } while (token);
  if (config.sourceIds.length) {
    config.sourceIds.forEach(function(id) { if (!seen[id]) throw new Error('Selected source is not in the input folder'); });
    files = files.filter(function(f) { return config.sourceIds.indexOf(f.id) >= 0; });
  }
  return files.sort(function(a,b) { return String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || a.id.localeCompare(b.id); });
}

function week2ReadSource(file) {
  if (file.mimeType !== 'application/vnd.google-apps.document') throw new Error('Unsupported input: use a native Google Doc');
  var doc = week2GoogleGet('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(file.id) + '?includeTabsContent=true&suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS');
  var bodies = [];
  function visit(tabs) {
    (tabs || []).forEach(function(tab) {
      if (tab.documentTab && tab.documentTab.body) bodies.push(tab.documentTab.body);
      visit(tab.childTabs);
    });
  }
  visit(doc.tabs);
  if (!bodies.length && doc.body) bodies.push(doc.body);
  if (bodies.length !== 1) throw new Error('Use exactly one document tab per transcript');
  function textOf(elements) {
    return (elements || []).map(function(e) {
      if (e.paragraph) return (e.paragraph.elements || []).map(function(p) { return p.textRun ? p.textRun.content : ''; }).join('');
      if (e.table) return e.table.tableRows.map(function(r) { return r.tableCells.map(function(c) { return textOf(c.content); }).join('\n'); }).join('\n');
      return '';
    }).join('');
  }
  var text = textOf(bodies[0].content).replace(/\r\n?/g,'\n').trim();
  if (text.length > 50000) throw new Error('Transcript exceeds the classroom input limit');
  var lines = text.split('\n'), dates = lines.filter(function(l) { return /^Meeting date:/.test(l); });
  var marker = lines.indexOf('Transcript');
  if (!lines[0] || dates.length !== 1 || !validDate(dates[0].slice(13).trim()) || marker < 1 || !lines.slice(marker+1).join('\n').trim()) throw new Error('Require a title, Meeting date: YYYY-MM-DD, and a nonempty Transcript section');
  var source = {id: 'DRIVE-' + file.id, title: lines[0], date: dates[0].slice(13).trim(), text: lines.slice(marker+1).join('\n').trim(), url: 'https://docs.google.com/document/d/' + file.id + '/edit'};
  source.fingerprint = week2Hash(JSON.stringify([source.title,source.date,source.text]));
  return source;
}
