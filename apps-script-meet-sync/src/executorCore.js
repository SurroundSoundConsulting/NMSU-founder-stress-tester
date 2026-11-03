// Executor storage is deliberately separate from the A–P ingestion contract.
var EX_LIMITS = {
  sources: 6,
  context_chars: 40000,
  source_chars: 12000,
  attempts: 3,
  runtime_ms: 240000,
  record_chars: 45000,
};
var EX_REQUEST_HEADERS = [
  "request_id",
  "task_id",
  "enabled",
  "allowed_owner",
  "draft_type",
  "version",
  "reviewer",
  "context_set_id",
  "project",
  "output_folder_id",
  "source_folder_id",
  "completion_folder_id",
  "completion_checked_by",
  "completion_checked_at",
  "completion_note",
  "predecessor",
  "reason",
  "approved_by",
  "approved_at",
  "required_transcript_ids",
];
var EX_CONTEXT_HEADERS = [
  "context_set_id",
  "source_key",
  "role",
  "file_id",
  "folder_id",
  "project",
  "approved",
  "expected_hash",
  "approved_by",
  "approved_at",
];
var EX_DRAFT_HEADERS = [
  "request_id",
  "task_id",
  "Status",
  "Next step",
  "Document",
  "reviewer",
  "version",
];
var EX_JSON_TABLES = [
  "Executor State",
  "Executor Evidence",
  "Executor Journal",
  "Executor Runtime",
  "Executor Files",
  "Executor Decisions",
];
function exBook() {
  var id = PropertiesService.getScriptProperties().getProperty(
    "EXECUTOR_SPREADSHEET_ID",
  );
  if (!id || id !== getBoardBook().getId())
    throw new Error("executor_destination_not_configured");
  return getBoardBook(id);
}
function exRecords(name) {
  var out = {};
  dataRows(ensureTab(exBook(), name, ["key", "json"]), 2).forEach(function (r) {
    if (r[0]) {
      if (out[r[0]]) throw new Error("duplicate_executor_key");
      out[r[0]] = JSON.parse(r[1]);
    }
  });
  return out;
}
function exPut(name, key, value) {
  var text = JSON.stringify(value);
  if (text.length > EX_LIMITS.record_chars)
    throw new Error("executor_record_limit");
  var sheet = ensureTab(exBook(), name, ["key", "json"]),
    rows = dataRows(sheet, 2),
    at = rows.findIndex(function (r) {
      return r[0] === key;
    });
  var range = sheet.getRange(at < 0 ? sheet.getLastRow() + 1 : at + 2, 1, 1, 2);
  if (range.getFormulas()[0].some(Boolean))
    throw new Error("executor_storage_human_formula");
  range.setNumberFormat("@");
  range.setValues([[key, text]]);
  SpreadsheetApp.flush();
}
function exObjects(name, headers) {
  var sheet = ensureTab(exBook(), name, headers),
    rows = dataRows(sheet, headers.length),
    formulas = rows.length
      ? sheet.getRange(2, 1, rows.length, headers.length).getFormulas()
      : [];
  return rows.map(function (row, i) {
    if (formulas[i].some(Boolean)) throw new Error("executor_settings_formula");
    var out = {};
    headers.forEach(function (k, j) {
      out[k] = w2Scalar(row[j]);
    });
    out._row = i + 2;
    return out;
  });
}
function exSaveObject(name, headers, value, row) {
  var sheet = ensureTab(exBook(), name, headers);
  sheet
    .getRange(row || sheet.getLastRow() + 1, 1, 1, headers.length)
    .setNumberFormat("@");
  sheet
    .getRange(row || sheet.getLastRow() + 1, 1, 1, headers.length)
    .setValues([
      headers.map(function (k) {
        return safeCell(value[k] == null ? "" : value[k]);
      }),
    ]);
}
function exRequest() {
  var rows = exObjects("Executor Requests", EX_REQUEST_HEADERS),
    selected = PropertiesService.getScriptProperties().getProperty(
      "EXECUTOR_SELECTED_REQUEST_ID",
    );
  if (!selected && rows.length === 1) return rows[0];
  var matches = rows.filter(function (r) {
    return r.request_id === selected;
  });
  if (matches.length !== 1)
    throw new Error("select_exactly_one_executor_request");
  return matches[0];
}
function exReply(code, detail) {
  var messages = {
    task_eligible: [
      "Task eligible",
      "Prepare and approve supporting sources before running.",
    ],
    configuration: [
      "Check output configuration",
      "Restore the private app-created output and completion folders before drafting.",
    ],
    disabled: [
      "Execution disabled",
      "Enable this request after source approval.",
    ],
    missing_scope: [
      "Needs approved scope",
      "Add the required approved scope in Executor Context, prepare it, then review and approve it.",
    ],
    source_approval: [
      "Needs source approval",
      "Open the source, review its current version and explicitly approve it.",
    ],
    blocked: [
      "Waiting for a prerequisite",
      "Check the blocker and prerequisite tasks in Tasks.",
    ],
    review: ["Needs a human decision", "Review the relevant item in Reviews."],
    possibly_done: [
      "Possibly already done",
      "Inspect the completion evidence before requesting a draft.",
    ],
    ready: [
      "Ready for review",
      "Open the draft and check every claim against its sources.",
    ],
    stale: [
      "Inputs changed; draft preserved",
      "Review the saved draft and changed inputs; request a new version explicitly if needed.",
    ],
    reconcile: [
      "Check saved work before continuing",
      "Inspect the recorded publication phase and actual Doc before explicit recovery.",
    ],
    deferred: [
      "Work deferred",
      "Inspect the stated limit before trying a smaller request.",
    ],
    rejected: [
      "Draft proposal rejected",
      "Inspect the recorded grounding or validation issue before another attempt.",
    ],
  };
  var m = messages[code] || [
    "Needs attention",
    "Inspect the recorded reason before retrying.",
  ];
  return Object.assign(
    { code: code, status: m[0], next_step: m[1] },
    detail || {},
  );
}
function exSelection(request) {
  var state = week2State(exBook()),
    matches = state.rows.filter(function (r) {
      return r[0] === request.task_id;
    });
  if (matches.length !== 1)
    return exReply("blocked", {
      reason: "task_missing_or_duplicate",
      task_id: request.task_id,
    });
  var task = matches[0],
    deps = String(task[8] || "")
      .split(/,\s*/)
      .filter(Boolean),
    related = [task[0]].concat(deps);
  if (task[3] === "done")
    return exReply("possibly_done", { reason: "task_done", task_id: task[0] });
  if (
    task[2] !== request.allowed_owner ||
    task[3] !== "open" ||
    task[7] ||
    deps.some(function (id) {
      var rows = state.rows.filter(function (r) {
        return r[0] === id;
      });
      return rows.length !== 1 || rows[0][3] !== "done";
    }) ||
    related.some(function (id) {
      return state.blockedTaskIds.includes(id);
    })
  )
    return exReply("blocked", {
      reason: "owner_status_blocker_or_prerequisite",
      task_id: task[0],
    });
  var base = state.baselines[task[0]];
  if (
    !base ||
    base.identity.project.toLowerCase() !==
      String(request.project).toLowerCase()
  )
    return exReply("blocked", { reason: "project_mismatch", task_id: task[0] });
  var reviews = Object.values(week2Records(exBook(), "Merge Reviews")).filter(
    function (r) {
      return (
        r.state === "pending" &&
        (related.includes(r.task_id) ||
          (r.candidate_ids || []).some(function (id) {
            return related.includes(id);
          }) ||
          (r.type === "changed_source" &&
            related.some(function (id) {
              var row = state.rows.find(function (t) {
                return t[0] === id;
              });
              return row && row[11] === r.source_id;
            })))
      );
    },
  );
  if (reviews.length)
    return exReply("review", {
      reason: "relevant_pending_review",
      task_id: task[0],
      review_keys: reviews.map(function (r) {
        return r.key;
      }),
    });
  return exReply("task_eligible", {
    task_id: task[0],
    task: task,
    formulas: state.formulas[task[0]],
    dependencies: deps.map(function (id) {
      return state.rows.find(function (r) {
        return r[0] === id;
      });
    }),
  });
}
function setupExecutor() {
  var book = exBook();
  ensureTab(book, "Executor Requests", EX_REQUEST_HEADERS);
  ensureTab(book, "Executor Context", EX_CONTEXT_HEADERS);
  ensureTab(book, "Drafts", EX_DRAFT_HEADERS);
  EX_JSON_TABLES.forEach(function (name) {
    ensureTab(book, name, ["key", "json"]);
  });
  var props = PropertiesService.getScriptProperties(),
    taskId = props.getProperty("EXECUTOR_TASK_ID");
  if (!taskId) throw new Error("configure_executor_task_id");
  var requests = exObjects("Executor Requests", EX_REQUEST_HEADERS);
  if (!requests.length) {
    exSaveObject("Executor Requests", EX_REQUEST_HEADERS, {
      request_id: "arroyo-agenda-v1",
      task_id: taskId,
      enabled: "no",
      allowed_owner: "Jordan",
      draft_type: "pilot_demo_agenda",
      version: "1",
      reviewer: props.getProperty("EXECUTOR_REVIEWER") || "Facilitator",
      context_set_id: "arroyo-v1",
      project: "Arroyo pilot",
      source_folder_id: "1L1KvGz5A1dRbjvOeVC_nO9s8JtITaiVD",
      reason: "Executor lab: draft only",
      approved_by: "Facilitator approved the build plan",
      approved_at: new Date().toISOString(),
      required_transcript_ids: WEEK2_IDS.slice(0, 3).join(","),
    });
  }
  var selectedRequest = exRequest(),
    decisionKey = "request:" + selectedRequest.request_id;
  if (!exRecords("Executor Decisions")[decisionKey]) {
    if (
      selectedRequest.request_id !== "arroyo-agenda-v1" ||
      String(selectedRequest.version) !== "1" ||
      selectedRequest.context_set_id !== "arroyo-v1" ||
      selectedRequest.task_id !== taskId ||
      selectedRequest.draft_type !== "pilot_demo_agenda" ||
      selectedRequest.allowed_owner !== "Jordan" ||
      selectedRequest.project !== "Arroyo pilot" ||
      selectedRequest.predecessor ||
      selectedRequest.reason !== "Executor lab: draft only"
    )
      throw new Error("explicit_request_decision_required");
    exRecordRequestDecision(
      selectedRequest,
      {
        actor: "Facilitator build-plan approval",
        reason: "Approved initial Executor lab request",
      },
      null,
    );
  }
  if (typeof setupExecutorLayout === "function") setupExecutorLayout();
  return {
    status:
      "Executor configured; drafting disabled until request and sources approved",
    request: exRequest().request_id,
  };
}
function previewExecutorSelection() {
  var reply = exPublic(exSelection(exRequest()));
  console.log(JSON.stringify(reply));
  return reply;
}
function configureExecutorLab() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("EXECUTOR_SPREADSHEET_ID", getBoardBook().getId());
  props.setProperty("EXECUTOR_TASK_ID", "HM-0013");
  props.setProperty("EXECUTOR_REVIEWER", "Facilitator");
  return setupExecutor();
}
function exPublic(reply) {
  var out = {};
  [
    "code",
    "status",
    "next_step",
    "reason",
    "task_id",
    "document",
    "execution_id",
    "drafting_calls",
    "evidence",
    "checked",
    "sources",
  ].forEach(function (k) {
    if (reply[k] !== undefined) out[k] = reply[k];
  });
  return out;
}
function exOutcome(request, reply) {
  var result = exPublic(reply),
    sheet = ensureTab(exBook(), "Drafts", EX_DRAFT_HEADERS),
    values = [
      request.request_id,
      request.task_id,
      reply.status,
      reply.next_step,
      reply.document || "",
      request.reviewer,
      request.version,
    ],
    rows = dataRows(sheet, EX_DRAFT_HEADERS.length),
    matches = rows
      .map(function (r, i) {
        return { r: r, i: i };
      })
      .filter(function (x) {
        return x.r[0] === request.request_id;
      });
  if (matches.length > 1) throw new Error("duplicate_draft_display");
  if (reply.document === undefined && matches.length)
    values[4] = matches[0].r[4];
  var at = matches.length ? matches[0].i + 2 : sheet.getLastRow() + 1;
  if (
    !matches.length ||
    JSON.stringify(matches[0].r) !== JSON.stringify(values)
  ) {
    var range = sheet.getRange(at, 1, 1, values.length);
    if (range.getFormulas()[0].some(Boolean))
      throw new Error("draft_display_human_formula");
    range.setNumberFormat("@");
    range.setValues([values]);
  }
  var key = Utilities.getUuid();
  exPut("Executor Runtime", key, {
    id: key,
    at: new Date().toISOString(),
    request_id: request.request_id,
    result: result,
  });
  console.log(JSON.stringify(result));
  return result;
}

var EX_DECISION_FIELDS = [
  "request_id",
  "task_id",
  "draft_type",
  "version",
  "context_set_id",
  "project",
  "predecessor",
  "reason",
];
function exRecordRequestDecision(request, decision, parent) {
  var fields = {};
  EX_DECISION_FIELDS.forEach(function (k) {
    fields[k] = String(request[k] || "");
  });
  exPut("Executor Decisions", "request:" + request.request_id, {
    fields: fields,
    actor: decision.actor,
    reason: decision.reason,
    at: new Date().toISOString(),
    parent_execution_id: parent ? parent.execution_id : "",
    parent_key: parent ? parent.key : "",
  });
}
function exAssertRequestDecision(request) {
  var record = exRecords("Executor Decisions")["request:" + request.request_id];
  if (
    !record ||
    EX_DECISION_FIELDS.some(function (k) {
      return record.fields[k] !== String(request[k] || "");
    })
  )
    throw new Error("explicit_request_decision_required");
  if (Number(request.version) > 1) {
    var parent = exRecords("Executor State")[record.parent_key],
      journal = exRecords("Executor Journal")[record.parent_key];
    if (
      !parent ||
      parent.execution_id !== record.parent_execution_id ||
      parent.output_url !== request.predecessor ||
      !journal ||
      journal.phase !== "complete" ||
      journal.context_set_id === request.context_set_id
    )
      throw new Error("version_predecessor_not_verified");
  }
  return record;
}
