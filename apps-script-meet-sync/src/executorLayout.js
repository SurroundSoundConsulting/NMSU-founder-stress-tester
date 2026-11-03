function exVerifyDisplayOnly(sheet) {
  var name = sheet.getName();
  if (
    JSON.stringify(sheet.getRange(1, 1, 1, 16).getValues()[0]) !==
    JSON.stringify(HEADERS)
  )
    throw new Error("display_headers_require_inspection");
  var result = exGoogle(
    "get",
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      exBook().getId() +
      "?ranges=" +
      encodeURIComponent("'" + name.replace(/'/g, "''") + "'") +
      "&includeGridData=true&fields=sheets(data(startRow,startColumn,rowData(values(userEnteredValue,note))))",
  );
  var anchors = 0;
  (((result.sheets || [])[0] && result.sheets[0].data) || []).forEach(
    function (grid) {
      (grid.rowData || []).forEach(function (row, i) {
        (row.values || []).forEach(function (cell, j) {
          if (cell.note) throw new Error("display_has_human_notes");
          var value = cell.userEnteredValue;
          if (!value) return;
          var r = (grid.startRow || 0) + i,
            c = (grid.startColumn || 0) + j;
          if (r === 0 && c < 16 && value.stringValue === HEADERS[c]) return;
          if (
            r === 1 &&
            c === 0 &&
            typeof value.formulaValue === "string" &&
            value.formulaValue.indexOf("=IFERROR(") === 0
          ) {
            anchors++;
            return;
          }
          throw new Error("display_has_human_data");
        });
      });
    },
  );
  if (anchors !== 1) throw new Error("display_formula_not_verified");
  return true;
}
function setupExecutorLayout() {
  var book = exBook(),
    task = sheetByName(book, "Master Action Board"),
    reviews = sheetByName(book, "Merge Reviews");
  if (!task || !reviews) throw new Error("ingestion_storage_missing");
  var unsafe = Object.values(week2Records(book, "Source Journal")).some(
    function (j) {
      return j.phase !== "complete";
    },
  );
  if (unsafe) throw new Error("ingestion_reconciliation_required");
  var displays = W2_VIEWS.concat(["Executor View", "Execution View"])
    .map(function (name) {
      return book.getSheetByName(name);
    })
    .filter(Boolean);
  displays.forEach(exVerifyDisplayOnly);
  var removed = displays.map(function (s) {
    return s.getName();
  });
  if (task.getName() !== "Tasks") task.setName("Tasks");
  if (reviews.getName() !== "Reviews") reviews.setName("Reviews");
  displays.forEach(function (sheet) {
    book.deleteSheet(sheet);
  });
  if (!task.getFilter())
    task.getRange(1, 1, task.getMaxRows(), 16).createFilter();
  ["Tasks", "Reviews", "Drafts"].forEach(function (name) {
    book.getSheetByName(name).showSheet();
  });
  book.getSheets().forEach(function (sheet) {
    if (!["Tasks", "Reviews", "Drafts"].includes(sheet.getName()))
      sheet.hideSheet();
  });
  return {
    visible: ["Tasks", "Reviews", "Drafts"],
    removed_formula_only_displays: removed,
  };
}
function showExecutorSettings() {
  ["Executor Requests", "Executor Context"].forEach(function (name) {
    exBook().getSheetByName(name).showSheet();
  });
  return {
    status: "Settings visible; disable request before preparing changes",
  };
}
function hideExecutorSettings() {
  return setupExecutorLayout();
}
function executorSnapshot() {
  var book = exBook(),
    out = {
      ingestion: week2Capture(book),
      executor: {},
      sheets: book.getSheets().map(function (s) {
        return {
          name: s.getName(),
          id: s.getSheetId(),
          hidden: s.isSheetHidden(),
        };
      }),
      model_requests: Number(
        PropertiesService.getScriptProperties().getProperty(
          "EXECUTOR_MODEL_REQUESTS",
        ) || 0,
      ),
    };
  ["Executor Requests", "Executor Context", "Drafts"].forEach(function (name) {
    var s = book.getSheetByName(name),
      width =
        name === "Drafts"
          ? EX_DRAFT_HEADERS.length
          : name === "Executor Requests"
            ? EX_REQUEST_HEADERS.length
            : EX_CONTEXT_HEADERS.length;
    out.executor[name] = {
      values: s.getRange(1, 1, s.getLastRow(), width).getValues(),
      formulas: s.getRange(1, 1, s.getLastRow(), width).getFormulas(),
    };
  });
  EX_JSON_TABLES.filter(function (n) {
    return n !== "Executor Runtime";
  }).forEach(function (n) {
    out.executor[n] = exRecords(n);
  });
  return out;
}
