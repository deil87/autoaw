# Datasets Feature Design

**Date:** 2026-05-11  
**Scope:** Sample dataset file + dataset management API endpoint + frontend UI + experiment form improvement

---

## Background

AutoAW experiments require a `dataset_id` that points to a JSON file on disk at `datasets/<id>.json`. The file contains input/expected-output pairs used to benchmark candidate workflows. The backend already has `POST /datasets` (upload) and `GET /datasets` (list IDs), but there is no sample file, no way to inspect records via API, and no frontend UI for dataset management.

---

## What We're Building

### 1. `datasets/ds1.json` — Dutch Tutor Benchmark

A JSON array of 10 records, each `{"input": string, "expected": string}`. Records cover the three core tasks of the Dutch tutor experiment:

- **Learner profiling** — given a mistake history, identify weak areas
- **Exercise generation** — given a learner profile, generate a targeted practice exercise
- **Difficulty validation** — given a generated exercise, verify it is appropriately challenging

The `expected` field describes the ideal output at the rubric level (what a perfect response looks like), not a literal answer, so the `llm_judge` evaluator can score against it.

### 2. `GET /datasets/{dataset_id}` — Backend Endpoint

Returns the parsed records array for a dataset:

```json
[{"input": "...", "expected": "..."}, ...]
```

Returns `404` if the file does not exist. This enables the frontend to show record counts and validates that a `dataset_id` exists before an experiment is started.

### 3. Frontend `/datasets` Page

Route: `/datasets`

Layout:
- Page heading "Datasets"
- Upload card: file picker (`.json` only) + "Upload" button → calls `POST /datasets` → shows success/error toast → refreshes list
- Datasets table: columns = Dataset ID, Records. Each row populated from `GET /datasets` + `GET /datasets/{id}` (record count).

### 4. Experiment Form — `dataset_id` Dropdown

The "Create Experiment" form currently has a free-text `dataset_id` input. Replace it with a `<Select>` that fetches `GET /datasets` on mount and lists available IDs. Falls back to a text input if the fetch fails or returns empty.

### 5. Nav Link

Add "Datasets" link to the top nav bar between "Experiments" and any future links.

---

## Data Contract

```typescript
// GET /datasets
type DatasetSummary = { dataset_id: string };

// GET /datasets/{dataset_id}
type DatasetRecord = { input: string; expected: string };
type DatasetDetail = DatasetRecord[];
```

Dataset files on disk: `datasets/<id>.json` — a JSON array of `DatasetRecord`.

---

## Error Handling

- Upload: validate JSON is an array before saving; return `422` with message on failure.
- `GET /datasets/{id}`: return `404` if file missing.
- Frontend upload: show inline error message on `422`; show generic error on network failure.
- Experiment form dropdown: if `/datasets` returns empty list, show helper text "Upload a dataset first."

---

## Testing

- **Backend:** unit tests for `GET /datasets/{dataset_id}` — happy path, missing file 404.
- **Frontend:** Vitest test for the upload form component (mocked fetch, success + error states).
- **Manual:** upload `ds1.json` via UI, create experiment selecting `ds1` from dropdown, start experiment — should no longer fail with "No such file".

---

## Out of Scope

- Editing or deleting datasets
- Previewing individual records in the UI
- Dataset versioning
