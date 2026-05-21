# Subtask Extraction Approaches

## How subtasks are extracted from a prompt — generic approach

When extracting subtasks from a prompt—especially in the context of building AI agents, LLM chains, or task orchestrators—the process generally follows a structured, multi-step pipeline. The goal is to take a single, complex, unstructured user request and break it down into a directed acyclic graph (DAG) or a sequential list of execution steps.

---

## The Generic Subtask Extraction Pipeline

```
  [ Raw User Prompt ]
          │
          ▼
┌───────────────────┐
│  1. Preprocessing │ ─── Intent classification & context injection
└───────────────────┘
          │
          ▼
┌───────────────────┐
│   2. Parsing &    │ ─── LLM-driven structural decomposition
│   Decomposition   │
└───────────────────┘
          │
          ▼
┌───────────────────┐
│ 3. Dependency &   │ ─── Mapping step prerequisites (DAG creation)
│  Graph Mapping    │
└───────────────────┘
          │
          ▼
┌───────────────────┐
│  4. Validation &  │ ─── Schema validation & constraint checking
│    Refinement     │
└───────────────────┘
          │
          ▼
  [ Executable Plan ]
```

---

## Stage 1: Intent Classification & Context Preprocessing

Before splitting a prompt into pieces, the system needs to understand what kind of task it is looking at.

- **Dynamic Routing:** The prompt is routed to a specific domain model or agent pool (e.g., a "coding" request vs. a "data analysis" request).
- **Context Hydration:** Relevant system state, user context, or historical memory is injected so the extractor understands implicit references (e.g., "Fix the bug in the last function" gets hydrated with the actual function code).

---

## Stage 2: Structural Decomposition (The LLM Layer)

Because natural language is messy, a fine-tuned LLM or a strict system prompt is used to parse the instruction into discrete actions. The LLM is typically instructed via **Few-Shot Prompting** and constrained using **Structured Outputs** (like JSON Schema or Instructor/Pydantic) to return an array of objects.

The LLM looks for specific linguistic markers:

- **Imperative verbs:** "Calculate," "fetch," "summarize," "plot."
- **Sequential connectors:** "Then," "after that," "finally."
- **Implicit prerequisites:** If a user says "Compare the sales data of X and Y," the LLM infers two implicit subtasks — Fetch data for X and Fetch data for Y — before the explicit Compare task can happen.

---

## Stage 3: Dependency Mapping & DAG Construction

Tasks are rarely entirely linear. The system organizes the extracted subtasks into a workflow graph, identifying which tasks can run in parallel and which must wait for upstream data.

- **Independent Tasks:** Can be executed concurrently to save latency (e.g., hitting two different APIs).
- **Dependent Tasks:** Require the output of a previous step as their input variable (e.g., `task_2_input = task_1_output`).

---

## Stage 4: Validation and Constraint Checking

The raw JSON/object list from the LLM is validated against the application's capabilities:

- **Tool Matching:** Does the system actually have a tool or function capable of executing subtask #3?
- **Safety/Feasibility:** Are there missing parameters? (e.g., if a subtask is "send email" but no recipient was provided, the orchestrator catches this to ask a clarifying question or fail gracefully).

---

## JSON Schema Representation Example

When an orchestrator extracts subtasks, it typically translates the raw text into a structured layout resembling this:

```json
{
  "original_prompt": "Fetch the Q1 revenue data from the database, calculate the MoM growth rate, and generate a plot showing the trend.",
  "execution_plan": [
    {
      "id": "task_01",
      "action": "fetch_db_records",
      "parameters": { "quarter": "Q1", "metric": "revenue" },
      "depends_on": []
    },
    {
      "id": "task_02",
      "action": "calculate_growth",
      "parameters": { "type": "Month-over-Month" },
      "depends_on": ["task_01"]
    },
    {
      "id": "task_03",
      "action": "generate_visualization",
      "parameters": { "chart_type": "line", "x_axis": "month", "y_axis": "growth_rate" },
      "depends_on": ["task_02"]
    }
  ]
}
```

---

## Plan Mutations — Graph Transformation Operators

The mapping between nodes in an execution plan is not fixed — it is a **gene** that can be mutated. Each mutation is a graph transformation with a defined input/output cardinality, applied to one or more nodes in the DAG before or during execution.

This is distinct from hydration (injecting context into existing nodes) and from validation (checking constraints). Mutations **restructure the graph itself**.

---

### Mutation 1: Expansion (1 → n)

**What it is:** A single, coarse-grained task is elaborated into multiple smaller, more precisely specified subtasks.

This is **not** context hydration. Hydration fills in implicit references inside a task (e.g., resolving "the last function" to actual code). Expansion **changes the granularity** of the task itself — it produces new child nodes in the DAG.

**When to apply:** When a task is underspecified, involves multiple implicit steps, or when tool-level execution requires atomic actions the original task is too broad to map to.

**Example:**
```
Before:  [ "Analyse the sales report" ]

After:   [ "Extract raw figures from report" ]
              │
         [ "Normalise currency across regions" ]
              │
         [ "Identify top-performing SKUs" ]
              │
         [ "Summarise findings into 3 bullet points" ]
```

---

### Mutation 2: Delegation Split (n tasks → k new agents, where 0 ≤ k ≤ n)

**What it is:** Given n current subtasks, spawn **k new agents** to handle them. The number of agents k is the mutable attribute — it is independent of the task count.

This is **not the same as Expansion**. Expansion changes the number of subtasks at the task-graph level. Delegation Split operates at the **execution layer**: it decides how many agents are instantiated to cover an existing set of subtasks. The task topology does not change; only the agent assignment does.

**The k parameter:**

| k | Meaning |
|---|---|
| `k = 0` | No new agents spawned — existing agents absorb all subtasks |
| `k = 1` | One new agent handles all n subtasks (serial, single-executor) |
| `0 < k < n` | Partial delegation — subtasks are grouped, each group gets one agent |
| `k = n` | Full delegation — one dedicated agent per subtask (maximum parallelism) |

**When to apply:** When parallelism, specialisation, or isolation between subtasks is valuable. The value of k is itself a tunable gene — larger k trades coordination overhead for throughput and specialisation; smaller k reduces agent spin-up cost at the expense of serial bottlenecks.

**Example (n=3 subtasks, k=2 agents):**
```
[ fetch_q1_data ]  ─┐
[ fetch_q2_data ]  ─┤ → agent_A  (data fetching, handles 2 subtasks)
                    │
[ calculate_growth ]─→ agent_B  (analytics, handles 1 subtask)
```

**Example (k=n=3, full split):**
```
[ fetch_q1_data ]   → sql_agent
[ calculate_growth ]→ math_agent
[ generate_chart ]  → viz_agent
```

The general form is a **many-to-many assignment** between the n subtasks and k agents, where the assignment itself is also a mutable attribute.

---

### Mutation 3: Critique Node Injection (1 → 2)

**What it is:** A **critic node** is inserted immediately after a target agent node. The critic receives both the original task definition and the agent's output, and produces a structured comment — either a pass, a list of issues, or a corrected output.

This is a **1→2 mutation**: one node becomes a pair `(executor, critic)`.

**When to apply:** On high-stakes nodes (final outputs, irreversible actions, ambiguous tasks) or when the system detects low-confidence outputs from the upstream agent.

**Example:**
```
Before:  [ generate_report_agent ]

After:   [ generate_report_agent ]
                   │
            { output + task_def }
                   │
         [ critique_agent ]  ← flags hallucinations, checks completeness
                   │
         [ corrected output OR rejection signal ]
```

The critique node can be chained (critic of the critic) or used as a gate (execution halts if critique score < threshold).

---

### Mutation 4: Compaction / Generalisation (n → 1, or n → m where m < n)

**What it is:** Multiple fine-grained subtasks are merged into a single higher-level task. This is the **inverse of expansion**. The merged task has a broader, more general action description and a union of all parameters from its constituent nodes.

**When to apply:** When adjacent subtasks share the same agent type, operate on the same data, or when the overhead of dispatching n separate tasks exceeds the benefit of granularity (token cost, latency, coordination overhead).

**Example:**
```
Before:  [ fetch_q1_data ] → [ fetch_q2_data ] → [ fetch_q3_data ]

After:   [ fetch_quarterly_data(quarters=["Q1","Q2","Q3"]) ]
```

Compaction can also merge a target node and its critic into a single self-correcting agent node when critique overhead needs to be reduced.

---

## Final Mutation Taxonomy

| # | Mutation | Layer | Cardinality | Mutable Attribute | Description |
|---|---|---|---|---|---|
| 1 | **Expansion** | Task graph | 1 → n | n (subtask count) | Elaborate one coarse task into n smaller, precisely specified subtasks |
| 2 | **Delegation Split** | Execution | n tasks → k agents | k (agent count, 0 ≤ k ≤ n) | Spawn k agents to cover n subtasks; k controls parallelism and specialisation |
| 3 | **Critique Injection** | Execution | 1 → 2 | Target node | Insert a critic node after any executor to review and annotate its output |
| 4 | **Compaction** | Task graph | n → m (m < n) | m (merged task count) | Merge adjacent or equivalent subtasks into fewer, more general tasks |

**Key distinction — task graph vs. execution layer:**
- Mutations 1 and 4 reshape the DAG itself (number and structure of tasks).
- Mutations 2 and 3 reshape how tasks are executed (agent assignment, quality control) without changing the DAG topology.

These mutations can be **composed and applied repeatedly**. A typical optimisation pass: expand underspecified nodes → assign agents via delegation split → inject critiques on high-stakes outputs → compact redundant leaf nodes.

---

## Common Extraction Strategies

Depending on the architecture, frameworks handle this decomposition using a few distinct design patterns:

| Strategy | Description | Trade-offs |
|---|---|---|
| **Plan-and-Solve (Static)** | The LLM generates the entire list of subtasks upfront, and the system executes them one by one. | Fast and token-efficient but brittle if an early step returns unexpected results. |
| **ReAct / Step-by-Step (Dynamic)** | The agent determines only the very next subtask, executes it, observes the outcome, then determines the next step dynamically. | Adaptive to intermediate results but higher latency and token cost. |
| **Self-Reflective Extraction** | The system generates a plan, passes it to a "critic" LLM layer to check for logical gaps or out-of-order dependencies, and modifies the subtask list before execution begins. | Higher quality plans but adds an extra LLM round-trip before any execution. |
