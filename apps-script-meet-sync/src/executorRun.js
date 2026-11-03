function exLogicalKey(request) {
  exAssertRequestDecision(request);
  if (
    !request.request_id ||
    !request.task_id ||
    request.draft_type !== "pilot_demo_agenda" ||
    !/^[1-9][0-9]{0,3}$/.test(String(request.version)) ||
    !request.approved_by ||
    !request.approved_at
  )
    throw new Error("invalid_or_unapproved_request");
  var key = request.task_id + ":" + request.draft_type + ":v" + request.version;
  if (
    Object.values(exRecords("Executor Journal")).some(function (j) {
      return (
        j.key !== key &&
        j.key.split(":")[0] === request.task_id &&
        j.phase !== "complete"
      );
    })
  )
    throw new Error("unfinished_task_publication_requires_recovery");
  return key;
}
function exInputHash(request, input) {
  var clean = {};
  EX_REQUEST_HEADERS.forEach(function (k) {
    if (k !== "enabled") clean[k] = request[k] || "";
  });
  return exHash({
    request: clean,
    task: input.task,
    formulas: input.formulas,
    dependencies: input.dependencies,
    bindings: input.bindings
      .map(function (b) {
        var row = {};
        EX_CONTEXT_HEADERS.forEach(function (k) {
          row[k] = b[k] || "";
        });
        return row;
      })
      .sort(function (a, b) {
        return a.source_key.localeCompare(b.source_key);
      }),
    sources: input.sources
      .map(function (s) {
        return {
          key: s.key,
          id: s.id,
          hash: s.hash,
          role: s.role,
          project: s.project,
        };
      })
      .sort(function (a, b) {
        return a.key.localeCompare(b.key);
      }),
    completion_files: input.completion.matches
      .map(function (item) {
        return item.id;
      })
      .sort(),
    model:
      PropertiesService.getScriptProperties().getProperty("EXECUTOR_MODEL") ||
      "gpt-4.1",
  });
}
function exOutputMetadata(id, request, executionId) {
  var file = exGoogle(
    "get",
    "https://www.googleapis.com/drive/v3/files/" +
      id +
      "?fields=id,name,mimeType,parents,trashed,shared,appProperties",
  );
  if (
    file.trashed ||
    file.shared === true ||
    file.mimeType !== "application/vnd.google-apps.document" ||
    !(file.parents || []).includes(request.output_folder_id) ||
    !file.appProperties ||
    file.appProperties.execution_id !== executionId ||
    file.appProperties.task_id !== request.task_id
  )
    throw new Error("output_identity_or_location_changed");
  return file;
}
function exReadOutput(id) {
  return exGoogle(
    "get",
    "https://docs.googleapis.com/v1/documents/" +
      id +
      "?includeTabsContent=true",
  );
}
function exSameInputs(request, inputHash) {
  var latest = exRequest(),
    checked = exPreflight(latest);
  return (
    latest.enabled === "yes" &&
    checked.code === "task_eligible" &&
    exInputHash(latest, checked) === inputHash
  );
}
function exFinish(request, state, journal) {
  var actual = exReadOutput(journal.output_id);
  if (exHash(exDocumentText(actual)) !== exHash(journal.render.text.trim()))
    throw new Error("output_has_unexpected_human_edits");
  if (!exSameInputs(request, state.inputs_hash)) {
    journal.phase = "published_stale";
    exPut("Executor Journal", journal.key, journal);
    return exReply("stale", {
      task_id: request.task_id,
      document: journal.output_url,
      execution_id: state.execution_id,
    });
  }
  state.phase = "ready";
  state.output_id = journal.output_id;
  state.output_url = journal.output_url;
  state.published_revision = actual.revisionId;
  state.updated_at = new Date().toISOString();
  exPut("Executor State", state.key, state);
  journal.phase = "complete";
  journal.published_revision = actual.revisionId;
  exPut("Executor Journal", journal.key, journal);
  return exReply("ready", {
    task_id: request.task_id,
    document: state.output_url,
    execution_id: state.execution_id,
    evidence: state.provider_evidence,
  });
}
function exPublish(request, state, journal, start) {
  if (Date.now() - start > EX_LIMITS.runtime_ms)
    return exReply("deferred", {
      reason: "runtime_limit",
      execution_id: state.execution_id,
      document: journal.output_url || "",
    });
  if (journal.phase === "planned") {
    if (!exSameInputs(request, state.inputs_hash))
      return exReply("stale", {
        reason: "inputs_changed_before_publication",
        execution_id: state.execution_id,
      });
    journal.phase = "create_pending";
    exPut("Executor Journal", journal.key, journal);
    var file = exGoogle(
      "post",
      "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink",
      {
        name:
          request.project +
          " — demo agenda — " +
          request.task_id +
          " — v" +
          request.version,
        mimeType: "application/vnd.google-apps.document",
        parents: [request.output_folder_id],
        appProperties: {
          execution_id: state.execution_id,
          task_id: request.task_id,
          request_id: request.request_id,
          version: String(request.version),
        },
      },
    );
    if (!file.id) throw new Error("create_result_uncertain");
    journal.output_id = file.id;
    journal.output_url =
      file.webViewLink ||
      "https://docs.google.com/document/d/" + file.id + "/edit";
    journal.phase = "created";
    exPut("Executor Journal", journal.key, journal);
  }
  if (journal.phase === "created") {
    if (!exSameInputs(request, state.inputs_hash))
      return exReply("stale", {
        reason: "inputs_changed_before_content_write",
        document: journal.output_url,
        execution_id: state.execution_id,
      });
    exOutputMetadata(journal.output_id, request, state.execution_id);
    var doc = exReadOutput(journal.output_id);
    if (exDocumentText(doc) !== "" || !doc.revisionId)
      throw new Error("output_not_verified_empty");
    journal.expected_revision = doc.revisionId;
    journal.phase = "write_pending";
    exPut("Executor Journal", journal.key, journal);
    exGoogle(
      "post",
      "https://docs.googleapis.com/v1/documents/" +
        journal.output_id +
        ":batchUpdate",
      {
        writeControl: { requiredRevisionId: doc.revisionId },
        requests: journal.render.requests,
      },
    );
    journal.phase = "content_written";
    exPut("Executor Journal", journal.key, journal);
  }
  if (journal.phase === "content_written")
    return exFinish(request, state, journal);
  return exReply("reconcile", {
    document: journal.output_url || "",
    execution_id: state.execution_id,
    reason: "publication_phase_requires_inspection",
  });
}
function runExecutor() {
  var lock = LockService.getScriptLock(),
    locked = false,
    request;
  try {
    lock.waitLock(30000);
    locked = true;
    var start = Date.now();
    request = exRequest();
    var key = exLogicalKey(request),
      state = exRecords("Executor State")[key],
      journal = exRecords("Executor Journal")[key];
    if (journal && !["planned", "complete"].includes(journal.phase))
      return exOutcome(
        request,
        exReply("reconcile", {
          reason: "unfinished_publication",
          document: journal.output_url || "",
          execution_id: journal.execution_id,
        }),
      );
    var input;
    try {
      input = exPreflight(request);
    } catch (sourceError) {
      input = exSourceFailure(sourceError);
    }
    if (input.code !== "task_eligible") {
      if (input.code === "possibly_done" && state && state.output_url)
        return exOutcome(
          request,
          Object.assign({}, input, {
            document: state.output_url,
            execution_id: state.execution_id,
          }),
        );
      if (state && state.output_url)
        return exOutcome(
          request,
          exReply("stale", {
            reason: input.reason || input.code,
            document: state.output_url,
            execution_id: state.execution_id,
          }),
        );
      return exOutcome(request, input);
    }
    var fingerprint = exInputHash(request, input);
    if (state && state.inputs_hash !== fingerprint)
      return exOutcome(
        request,
        exReply("stale", {
          reason: "task_request_or_sources_changed",
          document: state.output_url || "",
          execution_id: state.execution_id,
        }),
      );
    if (state && state.phase === "ready") {
      exOutputMetadata(state.output_id, request, state.execution_id);
      return exOutcome(
        request,
        exReply("ready", {
          document: state.output_url,
          execution_id: state.execution_id,
          task_id: request.task_id,
          drafting_calls: 0,
          evidence: state.provider_evidence,
        }),
      );
    }
    if (request.enabled !== "yes")
      return exOutcome(
        request,
        exReply("disabled", { task_id: request.task_id }),
      );
    if (!request.output_folder_id || !request.completion_folder_id)
      throw new Error("executor_folders_missing");
    if (!state) {
      state = {
        key: key,
        execution_id: Utilities.getUuid(),
        request_id: request.request_id,
        inputs_hash: fingerprint,
        phase: "planned",
        completion_search: input.completion,
        created_at: new Date().toISOString(),
        attempts: [],
      };
      exPut("Executor State", key, state);
      input.sources.forEach(function (s) {
        exPut("Executor Evidence", state.execution_id + ":" + s.key, s);
      });
    }
    if (!journal) {
      if (
        state.attempts.length >= EX_LIMITS.attempts ||
        Date.now() - start > EX_LIMITS.runtime_ms
      )
        return exOutcome(
          request,
          exReply("deferred", {
            reason: "attempt_or_runtime_limit",
            execution_id: state.execution_id,
          }),
        );
      state.phase = "drafting";
      state.attempts.push({ at: new Date().toISOString(), outcome: "started" });
      exPut("Executor State", key, state);
      var drafted;
      try {
        drafted = exDraft(request, input);
        state.provider_evidence = drafted.evidence;
        state.proposal = drafted.proposal;
        var render = renderExecutorDraft(request, input, drafted.proposal);
        state.body_words = render.body_words;
        state.phase = "validated";
        state.attempts[state.attempts.length - 1] = {
          at: new Date().toISOString(),
          outcome: "validated",
          evidence: drafted.evidence,
        };
        exPut("Executor State", key, state);
        journal = {
          key: key,
          execution_id: state.execution_id,
          request_id: request.request_id,
          context_set_id: request.context_set_id,
          inputs_hash: fingerprint,
          phase: "planned",
          render: render,
          output_folder_id: request.output_folder_id,
        };
        exPut("Executor Journal", key, journal);
      } catch (e) {
        state.phase = "rejected";
        state.attempts[state.attempts.length - 1] = {
          at: new Date().toISOString(),
          outcome: "rejected",
          reason: /^[a-z_0-9]+$/.test(e.message)
            ? e.message
            : "draft_validation_failed",
          evidence: e.providerEvidence || null,
        };
        exPut("Executor State", key, state);
        return exOutcome(
          request,
          exReply("rejected", {
            reason: state.attempts[state.attempts.length - 1].reason,
            execution_id: state.execution_id,
            evidence: e.providerEvidence || null,
          }),
        );
      }
    }
    try {
      return exOutcome(request, exPublish(request, state, journal, start));
    } catch (e) {
      return exOutcome(
        request,
        exReply("reconcile", {
          reason: /^[a-z_0-9]+$/.test(e.message)
            ? e.message
            : "publication_uncertain",
          document: journal.output_url || "",
          execution_id: state.execution_id,
        }),
      );
    }
  } catch (e) {
    var reply = exReply(locked ? "reconcile" : "deferred", {
      reason: /^[a-z_0-9]+$/.test(e.message)
        ? e.message
        : "executor_check_failed",
    });
    if (request) return exOutcome(request, reply);
    console.log(JSON.stringify(reply));
    return reply;
  } finally {
    if (locked) lock.releaseLock();
  }
}
function inspectExecutorRecovery() {
  var request = exRequest(),
    key = exLogicalKey(request),
    state = exRecords("Executor State")[key],
    journal = exRecords("Executor Journal")[key];
  if (!journal)
    return { status: "No publication intent recorded", state: state || null };
  var result = { journal: journal, state: state };
  if (journal.output_id) {
    result.file = exOutputMetadata(
      journal.output_id,
      request,
      journal.execution_id,
    );
    result.document = exReadOutput(journal.output_id);
    result.actual_text = exDocumentText(result.document);
  } else {
    var list = exGoogle(
      "get",
      "https://www.googleapis.com/drive/v3/files?q=" +
        encodeURIComponent(
          "'" +
            journal.output_folder_id +
            "' in parents and trashed=false and appProperties has { key='execution_id' and value='" +
            journal.execution_id +
            "' }",
        ) +
        "&pageSize=10&fields=files(id,name,mimeType,parents,appProperties),nextPageToken",
    );
    result.matches = list.files || [];
    result.search_incomplete = !!list.nextPageToken;
    result.warning =
      "Zero matches does not prove a create never occurred. Do not create another Doc to bypass uncertainty.";
  }
  return result;
}
function recoverExecutor(decision) {
  if (
    !decision ||
    decision.confirmed !== true ||
    !decision.actor ||
    !decision.reason ||
    !["adopt", "write_verified_empty", "finish"].includes(decision.action)
  )
    throw new Error("explicit_recovery_decision_required");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var request = exRequest(),
      key = exLogicalKey(request),
      state = exRecords("Executor State")[key],
      journal = exRecords("Executor Journal")[key];
    if (!state || !journal) throw new Error("publication_intent_missing");
    if (journal.phase === "complete")
      return exReply("ready", {
        document: journal.output_url,
        execution_id: state.execution_id,
      });
    if (!exSameInputs(request, state.inputs_hash))
      return exOutcome(
        request,
        exReply("stale", {
          document: journal.output_url || "",
          execution_id: state.execution_id,
        }),
      );
    if (decision.action === "adopt") {
      var inspected = inspectExecutorRecovery();
      if (
        journal.output_id ||
        inspected.search_incomplete ||
        inspected.matches.length !== 1 ||
        inspected.matches[0].id !== decision.file_id
      )
        throw new Error("unique_output_not_verified");
      exOutputMetadata(decision.file_id, request, state.execution_id);
      journal.output_id = decision.file_id;
      journal.output_url =
        "https://docs.google.com/document/d/" + decision.file_id + "/edit";
      var actual = exDocumentText(exReadOutput(decision.file_id));
      if (actual === "") journal.phase = "created";
      else if (exHash(actual) === exHash(journal.render.text.trim()))
        journal.phase = "content_written";
      else throw new Error("unexpected_output_content");
    } else {
      if (!journal.output_id) throw new Error("output_id_unknown");
      exOutputMetadata(journal.output_id, request, state.execution_id);
      var doc = exReadOutput(journal.output_id),
        text = exDocumentText(doc);
      if (decision.action === "write_verified_empty") {
        if (text !== "" || doc.revisionId !== decision.expected_revision)
          throw new Error("output_not_verified_empty");
        journal.phase = "created";
      } else {
        if (exHash(text) !== exHash(journal.render.text.trim()))
          throw new Error("output_has_unexpected_human_edits");
        journal.phase = "content_written";
      }
    }
    journal.recovery_audit = (journal.recovery_audit || []).concat([
      { decision: decision, at: new Date().toISOString() },
    ]);
    exPut("Executor Journal", key, journal);
    return exOutcome(request, exPublish(request, state, journal, Date.now()));
  } finally {
    lock.releaseLock();
  }
}
function requestExecutorVersion(newRequestId, newContextSetId, decision) {
  if (
    !/^[A-Za-z0-9_-]{1,80}$/.test(newRequestId) ||
    !newContextSetId ||
    !decision ||
    decision.confirmed !== true ||
    !decision.actor ||
    !decision.reason
  )
    throw new Error("explicit_version_decision_required");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var current = exRequest(),
      key = exLogicalKey(current),
      state = exRecords("Executor State")[key],
      journal = exRecords("Executor Journal")[key];
    if (
      !PropertiesService.getScriptProperties().getProperty(
        "EXECUTOR_SELECTED_REQUEST_ID",
      )
    )
      PropertiesService.getScriptProperties().setProperty(
        "EXECUTOR_SELECTED_REQUEST_ID",
        current.request_id,
      );
    if (!state || !state.output_url || !journal || journal.phase !== "complete")
      throw new Error("published_predecessor_required");
    if (newContextSetId === current.context_set_id)
      throw new Error("new_context_set_required");
    var requests = exObjects("Executor Requests", EX_REQUEST_HEADERS),
      old = requests.find(function (r) {
        return r.request_id === newRequestId;
      });
    if (old) {
      if (
        old.context_set_id !== newContextSetId ||
        old.predecessor !== state.output_url ||
        old.reason !== decision.reason
      )
        throw new Error("version_request_conflict");
      return {
        status: "Existing new-version request preserved",
        request_id: old.request_id,
      };
    }
    if (
      exObjects("Executor Context", EX_CONTEXT_HEADERS).some(function (c) {
        return c.context_set_id === newContextSetId;
      })
    )
      throw new Error("new_context_set_must_be_unused");
    var next = Object.assign({}, current, {
      request_id: newRequestId,
      context_set_id: newContextSetId,
      enabled: "no",
      version: String(
        Math.max.apply(
          null,
          requests
            .filter(function (r) {
              return (
                r.task_id === current.task_id &&
                r.draft_type === current.draft_type
              );
            })
            .map(function (r) {
              return Number(r.version);
            }),
        ) + 1,
      ),
      predecessor: state.output_url,
      reason: decision.reason,
      approved_by: decision.actor,
      approved_at: new Date().toISOString(),
    });
    exRecordRequestDecision(next, decision, state);
    exSaveObject("Executor Requests", EX_REQUEST_HEADERS, next);
    return {
      status:
        "New version request created disabled; prepare a separate context set",
      request_id: newRequestId,
      predecessor: state.output_url,
    };
  } finally {
    lock.releaseLock();
  }
}
