function exHash(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    typeof value === "string" ? value : JSON.stringify(value),
    Utilities.Charset.UTF_8,
  )
    .map(function (n) {
      return ("0" + ((n + 256) % 256).toString(16)).slice(-2);
    })
    .join("");
}
function exGoogle(method, url, body) {
  var options = {
    method: method,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (body !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body);
  }
  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw new Error("google_transport_uncertain");
  }
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error("google_http_" + status);
  return response.getContentText() ? JSON.parse(response.getContentText()) : {};
}
function exDocId(value) {
  var match =
    /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/.exec(
      String(value),
    );
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]+$/.test(String(value))) return String(value);
  throw new Error("invalid_google_doc_link");
}
function exDocumentText(doc) {
  if (
    !doc.tabs ||
    doc.tabs.length !== 1 ||
    (doc.tabs[0].childTabs || []).length
  )
    throw new Error("unsupported_document_tabs");
  var body = doc.tabs[0].documentTab && doc.tabs[0].documentTab.body;
  if (
    !body ||
    (body.content || []).some(function (e) {
      return e.table || e.tableOfContents;
    })
  )
    throw new Error("unsupported_document_layout");
  return (body.content || [])
    .map(function (e) {
      return ((e.paragraph && e.paragraph.elements) || [])
        .map(function (x) {
          return x.textRun ? x.textRun.content : "";
        })
        .join("");
    })
    .join("")
    .trim();
}
function exReadBoundSource(binding, request) {
  var id = exDocId(binding.file_id);
  if (binding.project !== request.project || !binding.folder_id)
    throw new Error("source_project_or_location_unbound");
  var file = exGoogle(
    "get",
    "https://www.googleapis.com/drive/v3/files/" +
      id +
      "?fields=id,name,mimeType,parents,trashed",
  );
  if (
    file.trashed ||
    file.mimeType !== "application/vnd.google-apps.document" ||
    !(file.parents || []).includes(binding.folder_id)
  )
    throw new Error("source_outside_approved_location");
  var doc = exGoogle(
      "get",
      "https://docs.googleapis.com/v1/documents/" +
        id +
        "?includeTabsContent=true",
    ),
    text = exDocumentText(doc);
  if (!text || text.length > EX_LIMITS.source_chars)
    throw new Error("source_context_limit");
  var source = {
    key: binding.source_key,
    id: id,
    url: "https://docs.google.com/document/d/" + id + "/edit",
    title: doc.title || file.name,
    role: binding.role,
    project: binding.project,
    folder_id: binding.folder_id,
    text: text,
    hash: exHash(text),
    revision: doc.revisionId || "",
    read_at: new Date().toISOString(),
  };
  if (binding.role === "transcript") {
    var record = week2Records(exBook(), "Source Registry")[id],
      intake = PropertiesService.getScriptProperties().getProperty(
        "W2_INPUT_META_" + id,
      );
    var parsed = week2ParseDocument(
      id,
      doc,
      intake ? JSON.parse(intake) : null,
    );
    if (!record || record.fingerprint !== week2Fingerprint(parsed))
      throw new Error("transcript_requires_ingestion_reconciliation");
  }
  return source;
}
function exContext(request) {
  return exObjects("Executor Context", EX_CONTEXT_HEADERS).filter(
    function (row) {
      return row.context_set_id === request.context_set_id;
    },
  );
}
function prepareExecutorContext() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = exRequest();
    if (request.enabled === "yes")
      throw new Error("disable_request_before_preparing");
    var used = Object.values(exRecords("Executor Journal")).some(function (j) {
      return j.context_set_id === request.context_set_id;
    });
    if (used) throw new Error("context_set_already_used");
    var bindings = exContext(request);
    if (bindings.length > EX_LIMITS.sources)
      throw new Error("source_count_limit");
    var prepared = bindings.map(function (row) {
      var updated = Object.assign({}, row);
      updated.project = updated.project || request.project;
      updated.folder_id =
        updated.folder_id ||
        (updated.role === "transcript"
          ? PropertiesService.getScriptProperties().getProperty(
              "INPUT_FOLDER_ID",
            ) || WEEK2_FOLDER
          : request.source_folder_id);
      var source = exReadBoundSource(updated, request);
      if (row.approved === "yes" && row.expected_hash !== source.hash)
        throw new Error("approved_source_changed");
      if (row.approved !== "yes") {
        updated.approved = "no";
        updated.expected_hash = source.hash;
        updated.approved_by = "";
        updated.approved_at = "";
      }
      updated.file_id = source.id;
      return { row: updated, source: source };
    });
    if (
      JSON.stringify(exRequest()) !== JSON.stringify(request) ||
      JSON.stringify(exContext(request)) !== JSON.stringify(bindings)
    )
      throw new Error("settings_changed_during_preparation");
    prepared.forEach(function (item) {
      exSaveObject(
        "Executor Context",
        EX_CONTEXT_HEADERS,
        item.row,
        item.row._row,
      );
    });
    return {
      status: "Sources prepared; approval unchanged",
      extractions: 0,
      drafting_calls: 0,
      sources: prepared.map(function (item) {
        return {
          key: item.source.key,
          title: item.source.title,
          url: item.source.url,
          hash: item.source.hash,
          approved: item.row.approved,
        };
      }),
    };
  } finally {
    lock.releaseLock();
  }
}
function exScopeFacts(source, request) {
  var facts = {};
  [
    "Project",
    "Audience",
    "Objective",
    "Permitted demonstration",
    "Constraints",
    "Duration",
    "Required sequence",
    "Agenda owner",
  ].forEach(function (label) {
    var line = source.text.split("\n").find(function (s) {
      return s.indexOf(label + ":") === 0;
    });
    if (!line) throw new Error("mandatory_scope_facts_missing");
    facts[label] = line;
  });
  if (
    facts.Project.slice(8).trim() !== request.project ||
    !facts["Agenda owner"].includes(request.allowed_owner)
  )
    throw new Error("scope_identity_mismatch");
  var duration = /(\d+)-minute/.exec(facts.Duration);
  if (!duration || +duration[1] !== 20)
    throw new Error("unsupported_scope_duration");
  return facts;
}
function exCompletionSearch(request) {
  if (
    !request.completion_folder_id ||
    !request.completion_checked_by ||
    !request.completion_checked_at
  )
    throw new Error("completion_check_not_configured");
  var list = exGoogle(
    "get",
    "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(
        "'" + request.completion_folder_id + "' in parents and trashed=false",
      ) +
      "&pageSize=25&fields=files(id,name,mimeType,appProperties),nextPageToken",
  );
  if (list.nextPageToken) throw new Error("completion_search_limit");
  var matches = (list.files || []).filter(function (f) {
    var p = f.appProperties || {};
    return (
      p.task_id === request.task_id &&
      p.project === request.project &&
      p.completion_accepted === "yes"
    );
  });
  return {
    folder_id: request.completion_folder_id,
    checked_by: request.completion_checked_by,
    checked_at: new Date().toISOString(),
    files_checked: (list.files || []).map(function (f) {
      return f.id;
    }),
    matches: matches.map(function (f) {
      return {
        id: f.id,
        name: f.name,
        url: "https://drive.google.com/file/d/" + f.id + "/view",
      };
    }),
    statement: matches.length
      ? "Accepted completion evidence found for this task in configured sources."
      : "No completion evidence found in these configured sources; unconnected work was not searched.",
  };
}
function exPreflight(request) {
  var selected = exSelection(request);
  if (selected.code !== "task_eligible") return selected;
  var bindings = exContext(request),
    scope = bindings.filter(function (b) {
      return b.role === "scope";
    });
  if (scope.length !== 1 || !scope[0].file_id)
    return exReply("missing_scope", {
      task_id: request.task_id,
      checked:
        "Task and completed prerequisites; required approved scope binding absent.",
    });
  if (bindings.length > EX_LIMITS.sources)
    return exReply("deferred", { reason: "source_count_limit" });
  if (
    bindings.some(function (b) {
      return (
        b.approved !== "yes" ||
        !b.expected_hash ||
        !b.approved_by ||
        !b.approved_at
      );
    })
  )
    return exReply("source_approval", { task_id: request.task_id });
  var required = String(
    request.required_transcript_ids || WEEK2_IDS.slice(0, 3).join(","),
  )
    .split(",")
    .filter(Boolean);
  if (
    required.some(function (id) {
      return !bindings.some(function (b) {
        return b.role === "transcript" && exDocId(b.file_id) === id;
      });
    })
  )
    return exReply("source_approval", {
      reason: "required_original_transcript_missing",
    });
  var seen = {},
    sources = bindings.map(function (binding) {
      if (
        !binding.source_key ||
        seen[binding.source_key] ||
        !["scope", "transcript", "completion"].includes(binding.role)
      )
        throw new Error("invalid_source_binding");
      seen[binding.source_key] = true;
      var source = exReadBoundSource(binding, request);
      if (source.hash !== binding.expected_hash)
        throw new Error("accepted_source_changed");
      return source;
    });
  if (
    sources.reduce(function (n, s) {
      return n + s.text.length;
    }, 0) > EX_LIMITS.context_chars
  )
    return exReply("deferred", { reason: "context_limit" });
  exVerifyStorage(request);
  var completion = exCompletionSearch(request),
    registered = sources.filter(function (s) {
      return (
        s.role === "completion" &&
        s.text.includes(request.task_id) &&
        s.text.toLowerCase().includes(request.project.toLowerCase())
      );
    });
  if (completion.matches.length || registered.length)
    return exReply("possibly_done", {
      evidence: completion.matches.concat(
        registered.map(function (s) {
          return { url: s.url, title: s.title };
        }),
      ),
    });
  var scopeSource = sources.find(function (s) {
      return s.role === "scope";
    }),
    facts = exScopeFacts(scopeSource, request);
  return Object.assign(selected, {
    sources: sources,
    facts: facts,
    bindings: bindings,
    completion: completion,
  });
}
function preflightExecutor() {
  var request = exRequest();
  try {
    return exOutcome(request, exPreflight(request));
  } catch (e) {
    return exOutcome(request, exSourceFailure(e));
  }
}
function setupExecutorStorage() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = exRequest(),
      files = exRecords("Executor Files"),
      result = {};
    ["output", "completion"].forEach(function (role) {
      var record = files[role];
      if (record && record.phase !== "created")
        throw new Error("folder_creation_needs_inspection");
      if (!record) {
        record = {
          key: role,
          phase: "create_pending",
          name: "NMSU Executor — " + role + " — " + Utilities.getUuid(),
        };
        exPut("Executor Files", role, record);
        try {
          var file = exGoogle(
            "post",
            "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink",
            {
              name: record.name,
              mimeType: "application/vnd.google-apps.folder",
              appProperties: { executor_store: role },
            },
          );
          if (!file.id) throw new Error("folder_id_unknown");
          record.id = file.id;
          record.phase = "created";
          exPut("Executor Files", role, record);
        } catch (e) {
          throw new Error("folder_creation_needs_inspection");
        }
      }
      var metadata = exGoogle(
        "get",
        "https://www.googleapis.com/drive/v3/files/" +
          record.id +
          "?fields=id,mimeType,ownedByMe,shared,trashed",
      );
      if (
        metadata.trashed ||
        metadata.mimeType !== "application/vnd.google-apps.folder" ||
        metadata.ownedByMe !== true ||
        metadata.shared === true
      )
        throw new Error("executor_folder_not_private_owned");
      result[role] = record.id;
    });
    var latest = exRequest();
    if (JSON.stringify(latest) !== JSON.stringify(request))
      throw new Error("request_changed_during_storage_setup");
    if (
      (request.output_folder_id &&
        request.output_folder_id !== result.output) ||
      (request.completion_folder_id &&
        request.completion_folder_id !== result.completion)
    )
      throw new Error("configured_folder_conflict");
    if (!request.output_folder_id || !request.completion_folder_id) {
      request.output_folder_id = result.output;
      request.completion_folder_id = result.completion;
      request.completion_checked_by =
        "Apps Script bounded completion-folder inspection";
      request.completion_checked_at = new Date().toISOString();
      request.completion_note =
        "Only the configured folder and explicitly registered completion sources are searched.";
      exSaveObject(
        "Executor Requests",
        EX_REQUEST_HEADERS,
        request,
        request._row,
      );
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}
function seedExecutorLabContext() {
  var request = exRequest();
  if (request.enabled === "yes")
    throw new Error("disable_request_before_preparing");
  var existing = exContext(request);
  if (existing.length)
    return { status: "Existing bindings preserved", count: existing.length };
  [
    {
      source_key: "scope",
      role: "scope",
      file_id:
        "https://docs.google.com/document/d/1PbOVkPs0yf-X0jAQEor3vdd2bouUhv9erMRGVZiuffk/edit",
      folder_id: request.source_folder_id,
    },
  ]
    .concat(
      WEEK2_IDS.slice(0, 3).map(function (id, i) {
        return {
          source_key: "meeting_" + String.fromCharCode(97 + i),
          role: "transcript",
          file_id: "https://docs.google.com/document/d/" + id + "/edit",
          folder_id:
            PropertiesService.getScriptProperties().getProperty(
              "INPUT_FOLDER_ID",
            ) || WEEK2_FOLDER,
        };
      }),
    )
    .forEach(function (row) {
      row.context_set_id = request.context_set_id;
      row.project = request.project;
      row.approved = "no";
      exSaveObject("Executor Context", EX_CONTEXT_HEADERS, row);
    });
  return { status: "Four original source links bound; none approved" };
}
function approveExecutorContext(decision) {
  if (
    !decision ||
    decision.confirmed !== true ||
    !decision.actor ||
    !decision.reason
  )
    throw new Error("explicit_source_approval_required");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = exRequest();
    if (request.enabled === "yes")
      throw new Error("disable_request_before_approval");
    if (
      Object.values(exRecords("Executor Journal")).some(function (j) {
        return j.context_set_id === request.context_set_id;
      })
    )
      throw new Error("context_set_already_used");
    var bindings = exContext(request),
      sources = bindings.map(function (b) {
        var s = exReadBoundSource(b, request);
        if (s.hash !== b.expected_hash)
          throw new Error("prepared_source_changed");
        return s;
      });
    if (bindings.length < 4 || bindings.length > EX_LIMITS.sources)
      throw new Error("inspect_source_binding_count");
    if (
      JSON.stringify(exRequest()) !== JSON.stringify(request) ||
      JSON.stringify(exContext(request)) !== JSON.stringify(bindings)
    )
      throw new Error("settings_changed_during_approval");
    bindings.forEach(function (b) {
      b.approved = "yes";
      b.approved_by = decision.actor + ": " + decision.reason;
      b.approved_at = new Date().toISOString();
      exSaveObject("Executor Context", EX_CONTEXT_HEADERS, b, b._row);
    });
    request.enabled = "yes";
    request.approved_by = decision.actor + ": " + decision.reason;
    request.approved_at = new Date().toISOString();
    exSaveObject(
      "Executor Requests",
      EX_REQUEST_HEADERS,
      request,
      request._row,
    );
    return {
      status:
        bindings.length + " source versions approved; one request enabled",
      sources: sources.map(function (s) {
        return { key: s.key, hash: s.hash };
      }),
    };
  } finally {
    lock.releaseLock();
  }
}

function exSourceFailure(error) {
  return exReply(
    error.message === "executor_storage_configuration"
      ? "configuration"
      : /limit/.test(error.message)
        ? "deferred"
        : "source_approval",
    {
      reason: /^[a-z_0-9]+$/.test(error.message)
        ? error.message
        : "source_check_failed",
    },
  );
}

function inspectExecutorCompletion() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = exRequest(),
      report = exCompletionSearch(request);
    if (JSON.stringify(exRequest()) !== JSON.stringify(request))
      throw new Error("completion_settings_changed");
    exPut(
      "Executor Decisions",
      "completion-check:" + request.request_id,
      report,
    );
    console.log(JSON.stringify(report));
    return report;
  } finally {
    lock.releaseLock();
  }
}

function exVerifyStorage(request) {
  var stores = exRecords("Executor Files");
  ["output", "completion"].forEach(function (role) {
    var id = request[role + "_folder_id"],
      saved = stores[role];
    if (!saved || saved.phase !== "created" || saved.id !== id)
      throw new Error("executor_storage_configuration");
    var meta = exGoogle(
      "get",
      "https://www.googleapis.com/drive/v3/files/" +
        id +
        "?fields=id,mimeType,ownedByMe,shared,trashed",
    );
    if (
      meta.trashed ||
      meta.mimeType !== "application/vnd.google-apps.folder" ||
      meta.ownedByMe !== true ||
      meta.shared === true
    )
      throw new Error("executor_storage_configuration");
  });
}
