# Clone Experiment Design

**Date:** 2026-05-11  
**Status:** Approved

## Summary

Add the ability to fork an existing experiment into a new one with all config fields pre-filled. The user can review and edit before creating. No backend changes are required.

## UX Flow

1. User is on the experiment list (`/experiments`) or a detail/monitor page (`/experiments/{id}`).
2. They click a **"Fork"** button on an experiment card or detail view.
3. Browser navigates to `/experiments/new?from={sourceId}`.
4. The new experiment page detects the `?from=` query param, fetches `GET /experiments/{sourceId}`, and extracts `config_json`.
5. `ExperimentForm` renders pre-filled with the source config. The name field defaults to `"Copy of {original name}"`.
6. User edits as desired and submits — identical to creating from scratch.
7. On success, redirects to `/experiments/{newId}/monitor`.

## Architecture

No new API endpoints. No backend changes.

### Frontend Changes

| File | Change |
|---|---|
| `frontend/app/experiments/new/page.tsx` | Read `?from` search param; if present, fetch source experiment and pass its `config_json` as `initialValues` to `ExperimentForm` |
| `frontend/components/experiment-form.tsx` | Accept optional `initialValues: Partial<CreateExperimentRequest>` prop; seed all form fields from it on mount |
| `frontend/components/experiment-card.tsx` | Add "Fork" link/button → `/experiments/new?from={id}` |
| `frontend/components/experiment-details.tsx` | Add "Fork" button in the action/header area |

### Data Flow

```
ExperimentCard / ExperimentDetails
  → Link to /experiments/new?from={id}
      → NewExperimentPage reads searchParams.from
          → api.experiments.get(id) → config_json
              → ExperimentForm(initialValues=config_json)
                  → POST /experiments (unchanged)
                      → redirect /experiments/{newId}/monitor
```

## Error Handling

- If the source experiment fetch fails (404, network error), show an error message and fall back to an empty form.
- The `initialValues` prop is optional; `ExperimentForm` must remain fully functional without it.

## Testing

- Unit: `ExperimentForm` renders correctly when `initialValues` is provided.
- Unit: `ExperimentForm` renders correctly when `initialValues` is absent.
- Integration: Navigating to `/experiments/new?from={id}` pre-fills the form with the source config and allows submission.
