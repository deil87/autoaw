# Clone Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Fork" button to experiment cards and the monitor page that pre-fills the new experiment form with the source experiment's config.

**Architecture:** Client-side fork only — no new API endpoints. The new experiment page reads a `?from={id}` query param, fetches the source experiment via the existing `GET /experiments/{id}`, and passes its config as `initialValues` to `ExperimentForm`. `ExperimentForm` gains an optional `initialValues` prop.

**Tech Stack:** Next.js App Router (TypeScript), React, shadcn/ui

---

### Task 1: Add `initialValues` prop to `ExperimentForm`

**Files:**
- Modify: `frontend/components/experiment-form.tsx`

- [ ] **Step 1: Define the `initialValues` type and prop**

Open `frontend/components/experiment-form.tsx`. Change the function signature from:

```tsx
export function ExperimentForm() {
```

to:

```tsx
interface ExperimentFormProps {
  initialValues?: Partial<{
    name: string;
    task_description: string;
    dataset_id: string;
    rubric: string;
    objective_weights: ObjectiveWeights;
    population_size: number;
    budget_max_trials: number;
  }>;
}

export function ExperimentForm({ initialValues }: ExperimentFormProps = {}) {
```

- [ ] **Step 2: Seed state from `initialValues`**

Change the `useState` initialisers to read from `initialValues` when present. Replace the existing state declarations block (lines 23–33) with:

```tsx
  const [name, setName] = useState(initialValues?.name ?? "");
  const [taskDescription, setTaskDescription] = useState(initialValues?.task_description ?? "");
  const [datasetId, setDatasetId] = useState(initialValues?.dataset_id ?? "");
  const [datasetOptions, setDatasetOptions] = useState<string[]>([]);
  const [judgeModel, setJudgeModel] = useState("gpt-4o-mini");
  const [rubric, setRubric] = useState(
    initialValues?.rubric ?? "Rate the output 0 to 1 on accuracy, completeness, and clarity."
  );
  const [weights, setWeights] = useState<ObjectiveWeights>(
    initialValues?.objective_weights ?? DEFAULT_WEIGHTS
  );
  const [populationSize, setPopulationSize] = useState(initialValues?.population_size ?? 20);
  const [budgetTrials, setBudgetTrials] = useState(initialValues?.budget_max_trials ?? 200);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

- [ ] **Step 3: Fix the dataset `useEffect` to not override a pre-filled value**

The existing `useEffect` unconditionally sets `datasetId` to the first option when `!datasetId`. This is already correct — when `initialValues.dataset_id` is provided the state is non-empty, so the effect won't override it. No change needed. Verify this is the case:

```tsx
  useEffect(() => {
    api.datasets.list().then((list) => {
      const ids = list.map((d) => d.dataset_id);
      setDatasetOptions(ids);
      if (ids.length > 0 && !datasetId) setDatasetId(ids[0]);  // only sets if empty
    }).catch(() => {});
  }, []);
```

No changes required here.

- [ ] **Step 4: Verify the component renders in the browser**

Run the dev server and open http://localhost:3000/experiments/new — the form should appear and work exactly as before (no visible change).

```bash
cd frontend && npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/experiment-form.tsx
git commit -m "feat: add initialValues prop to ExperimentForm for forking"
```

---

### Task 2: Update the new experiment page to handle `?from=` param

**Files:**
- Modify: `frontend/app/experiments/new/page.tsx`

The page is a server component. We need to read the `searchParams`, fetch the source experiment if `from` is set, extract config, and pass it to the form.

- [ ] **Step 1: Rewrite the page to accept searchParams and fetch source config**

Replace the entire contents of `frontend/app/experiments/new/page.tsx` with:

```tsx
import { ExperimentForm } from "@/components/experiment-form";
import { api } from "@/lib/api";
import type { ExperimentConfig } from "@/lib/types";

interface PageProps {
  searchParams: { from?: string };
}

export default async function NewExperimentPage({ searchParams }: PageProps) {
  let initialValues: Parameters<typeof ExperimentForm>[0]["initialValues"] = undefined;

  if (searchParams.from) {
    try {
      const source = await api.experiments.get(searchParams.from);
      let config: ExperimentConfig | null = null;
      if (source.config_json) {
        config = JSON.parse(source.config_json) as ExperimentConfig;
      }
      if (config) {
        const llmEvaluator = config.evaluators.find((e) => e.type === "llm_judge");
        initialValues = {
          name: `Copy of ${config.name}`,
          task_description: config.task_description,
          dataset_id: config.dataset_id,
          rubric: typeof llmEvaluator?.params?.rubric === "string"
            ? llmEvaluator.params.rubric
            : undefined,
          objective_weights: config.objective_weights,
          population_size: config.population_size,
          budget_max_trials: config.budget_max_trials,
        };
      }
    } catch {
      // source fetch failed — fall through to empty form
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {initialValues ? "Fork Experiment" : "New Experiment"}
      </h1>
      <ExperimentForm initialValues={initialValues} />
    </div>
  );
}
```

- [ ] **Step 2: Check that `api.experiments.get` is available server-side**

Open `frontend/lib/api.ts` and verify `api.experiments.get(id)` is a plain fetch call (not using browser-only APIs). If it uses `fetch` directly it works in server components. If there is any issue the build step will catch it.

- [ ] **Step 3: Test with a real experiment ID**

Start the dev server (`npm run dev` in `frontend/`). Navigate to `/experiments` and grab any experiment ID from the URL. Then open `/experiments/new?from={thatId}`. The form should be pre-filled and the page title should say "Fork Experiment".

- [ ] **Step 4: Test fallback when `?from=` is an invalid ID**

Navigate to `/experiments/new?from=exp_doesnotexist`. The page should fall back to an empty form with title "New Experiment" (error is swallowed silently).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/experiments/new/page.tsx
git commit -m "feat: pre-fill new experiment form when ?from= param is present"
```

---

### Task 3: Add "Fork" button to experiment cards

**Files:**
- Modify: `frontend/components/experiment-card.tsx`

- [ ] **Step 1: Add the Fork link**

Replace the `<CardFooter>` block in `frontend/components/experiment-card.tsx`:

```tsx
      <CardFooter className="gap-2">
        <Link href={`/experiments/${experiment.id}/monitor`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Monitor</Link>
        <Link href={`/experiments/${experiment.id}/leaderboard`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Leaderboard</Link>
      </CardFooter>
```

with:

```tsx
      <CardFooter className="gap-2">
        <Link href={`/experiments/${experiment.id}/monitor`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Monitor</Link>
        <Link href={`/experiments/${experiment.id}/leaderboard`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Leaderboard</Link>
        <Link href={`/experiments/new?from=${experiment.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Fork</Link>
      </CardFooter>
```

- [ ] **Step 2: Verify in the browser**

Open `/experiments`. Each card should now show a "Fork" link next to "Monitor" and "Leaderboard". Clicking it should navigate to `/experiments/new?from={id}` with the form pre-filled.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/experiment-card.tsx
git commit -m "feat: add Fork link to experiment card"
```

---

### Task 4: Add "Fork" button to the monitor page

**Files:**
- Modify: `frontend/app/experiments/[id]/monitor/monitor-client.tsx`

- [ ] **Step 1: Add the Fork link to the action bar**

In `monitor-client.tsx`, find the action button group (the `<div className="flex gap-2">` block around line 80). Add a Fork link:

```tsx
        <div className="flex gap-2">
          {experiment.status === "pending" && (
            <button onClick={handleStart} className={cn(buttonVariants())}>Start</button>
          )}
          <Link href={`/experiments/new?from=${id}`} className={cn(buttonVariants({ variant: "outline" }))}>Fork</Link>
          <Link href={`/experiments/${id}/leaderboard`} className={cn(buttonVariants({ variant: "outline" }))}>Leaderboard</Link>
        </div>
```

- [ ] **Step 2: Verify in the browser**

Open any experiment's monitor page. A "Fork" button should appear in the header action bar. Clicking it opens the pre-filled new experiment form.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/experiments/[id]/monitor/monitor-client.tsx
git commit -m "feat: add Fork button to experiment monitor page"
```

---

### Task 5: Verify end-to-end and check build

- [ ] **Step 1: Run the Next.js build to catch any type errors**

```bash
cd frontend && npm run build
```

Expected: Build completes with no errors. Any TypeScript errors will appear here.

- [ ] **Step 2: Manual end-to-end test**

1. Open `/experiments` — each card has "Fork" link.
2. Click "Fork" on any experiment — form is pre-filled, title says "Fork Experiment".
3. Name field shows "Copy of {original name}".
4. Submit the form — new experiment is created and you are redirected to its monitor page.
5. Open an experiment monitor page — "Fork" button is in the header.
6. Navigate to `/experiments/new` (no param) — empty form, title says "New Experiment". Existing create flow works as before.

- [ ] **Step 3: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "fix: address any build issues from clone experiment feature"
```

Only run this step if Step 1 or 2 found issues that needed fixing.
