# Agentic Glue, Skills, and MCP — Implications for AutoAW
**Date:** 2026-05-22  
**Status:** Reference / Informing

---

## 1. The Industry Shift

The agentic AI landscape has undergone a decisive architectural shift since late 2024. The pattern commonly called "Agentic Glue with Skills" has empirically outperformed "multi-agent committee" architectures across most production workloads.

### 1.1 Multi-Agent Workflow (The Committee)

The classic pattern distributes reasoning across isolated LLM instances, each with its own persona, prompt, and narrow context window:

```
[User Intent] → [Manager Agent] → [Researcher Agent] → [Writer Agent] → [Validator Agent]
```

**Where it breaks down:**
- Every hand-off is a fresh LLM call; state is translated back into natural language
- Agents re-interpret (and subtly drift) each other's outputs — the telephone game effect
- Context fragmentation: no single agent holds the complete picture
- Coordination overhead dominates token spend for standard-complexity tasks
- Debugging requires tracing across N independent reasoning chains

### 1.2 Agentic Glue + Skills (The Conductor)

One highly capable "Core Conductor" model holds the full context window and acts as the orchestrating intelligence. Instead of handing off reasoning to other agents, it reaches into a library of modular, pre-packaged **Skills** for execution:

```
                   ┌──→ [Skill: Run Web Search]   (deterministic code / tool)
[User Intent] ───→ ├──→ [Skill: Execute SQL]       (deterministic code / tool)
  (Core LLM)       └──→ [Skill: Run PPL Log Audit] (pre-bundled docs + script)
```

A **Skill** is a standardized, self-contained package that includes:
- A precise markdown guide (`SKILL.md`) describing what it does and when to use it
- A formal API definition (input/output schema)
- The executable code (script, API call, or compiled binary) that carries out the action deterministically

The LLM never delegates *reasoning* — it delegates only *execution*.

### 1.3 Comparative Performance

| Dimension | Multi-Agent Workflows | Agentic Glue + Skills |
|---|---|---|
| Latency | High — multiple nested LLM-to-LLM hops per task | Low — single LLM orchestrates; skill execution is deterministic code |
| Context fidelity | Fragmented — state loses nuance across hand-offs | Unified — one context window; no telephone game |
| Debugging | Hard — semantic drift can originate anywhere in the hop chain | Standard software debugging — did the LLM call the skill correctly? Did the script run? |
| Standardization | Framework-specific (LangGraph, CrewAI state machines) | Open specs (MCP, Anthropic Skills format) |
| Cost | Proportional to number of agents × task length | Proportional to conductor reasoning; skill calls are cheap |

### 1.4 When Multi-Agent Is Still Correct

Multi-agent is not dead — its scope has narrowed to scenarios that mechanically require separation:

- **Hard security/permission boundaries:** Agent A has billing DB access; Agent B handles untrusted user input. An API boundary is a safety requirement, not a design preference.
- **Context window overflow:** Domain-specific sub-agents acting as local filters when tool/reference documentation genuinely cannot fit a single context.
- **Non-linear exploration:** Open-ended research where competing hypothesis generation across model instances is the point (e.g., the `debate` topology in AutoAW).

---

## 2. MCP — The Standardization Layer

The Model Context Protocol (MCP) is the open standard that decouples a skill's execution engine from the LLM orchestrator. It makes skills shareable, composable, and portable across any MCP-compatible client (Claude Code, VS Code, custom orchestration layers).

A **Skill** is the conceptual capability. **MCP** is the plug-and-play connection that lets an LLM discover and execute that skill without custom integration code.

### 2.1 What an MCP Server Exposes

Three constructs:

| Construct | Purpose |
|---|---|
| **Tools** | Actions the model can invoke (functions with defined input/output schemas) |
| **Resources** | Data the model can read (files, DB query results, API data) |
| **Prompts** | Pre-baked templates or SKILL.md guides the model can ingest |

### 2.2 MCP Tool Definition Example

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "search_repository_code",
        "description": "Searches for specific code patterns across the local workspace. Use when you need to understand how an existing service is structured before writing new code.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "The code snippet, regex pattern, or keyword to search for."
            },
            "fileExtension": {
              "type": "string",
              "description": "Optional filter: 'py', 'ts', 'go', 'json', 'md'.",
              "enum": ["py", "ts", "go", "json", "md"]
            }
          },
          "required": ["query"]
        }
      }
    ]
  },
  "id": 1
}
```

### 2.3 The Execution Loop (MCP in Action)

**Step 1 — Discovery:** The core LLM initializes and queries the MCP server. It reads the JSON schema and adds the new capability to its available toolset.

**Step 2 — Reasoning:** The user's task is analysed. The LLM identifies the gap (e.g., it doesn't know the local codebase) and decides to invoke a skill.

**Step 3 — Invocation:** The LLM emits a `tools/call` request via MCP:

```json
{
  "method": "tools/call",
  "params": {
    "name": "search_repository_code",
    "arguments": {
      "query": "create_engine",
      "fileExtension": "py"
    }
  }
}
```

**Step 4 — Result injection:** The MCP server executes the deterministic script and returns results directly into the core model's context window. The model synthesises the answer. No second LLM was involved.

---

## 3. Mapping to AutoAW's Search Space

AutoAW's central thesis is that optimal workflow topology is task-specific and not knowable in advance — it must be discovered. The agentic glue vs. multi-agent committee axis is exactly one of the dimensions AutoAW should be searching over.

### 3.1 The `ai_orchestrated` Topology Is Already the Glue Pattern

AutoAW's existing `ai_orchestrated` topology type — one orchestrator that dynamically routes to other agent nodes — is the structural foundation of the agentic glue pattern. A gene with a single orchestrator and all other agents implemented as deterministic tool nodes *is* the agentic glue architecture.

The current gene schema supports this but doesn't make it explicit. The `tools` field on each agent is the embryonic form of skills:

```json
{
  "id": "agent_0",
  "role": "orchestrator",
  "tools": ["web_search", "code_exec", "sql_query"]
}
```

### 3.2 Skills as a First-Class Gene Attribute

The shift implies that `tools` should be treated with the same evolutionary weight as `topology`, `system_prompt`, and `model`. A single conductor with a rich toolset can outperform a three-agent committee — the GP loop should be able to discover this through selection pressure, not just through topology mutation.

**Implication for gene schema:** Evolving the *set and parameterization* of available skills/tools is as important as evolving the agent topology.

### 3.3 The Compaction Mutation Is the Formal Path to Glue

From `2026-05-21-subtask-extraction-approaches.md`, the Compaction mutation (n → m where m < n) is the graph-level operation that collapses multiple specialized agents into fewer, more general ones. Taken to its limit (n → 1), compaction produces the agentic glue pattern: one conductor with rich tools.

The GP loop can discover this transition organically via selection pressure — a compacted, tool-rich gene will have lower coordination overhead, lower cost, and lower latency, which directly improves fitness under typical `objective_weights`.

### 3.4 Delegation Split Is the Formal Path to Multi-Agent

Conversely, the Delegation Split mutation (k agents for n subtasks) is the path *toward* multi-agent. High values of k are appropriate when the fitness landscape rewards parallelism and specialization more than coordination simplicity — for example, the `debate` topology with truly adversarial agents (Type B tasks where competing hypothesis generation is the design intent, not an artifact).

### 3.5 MCP as the Tool Interface Standard

The `tools` array in the current gene schema is an opaque string list. Adopting MCP as the tool definition standard would:

1. Give the gene schema a formal, typed interface for each tool (input schema, description, execution target)
2. Allow the GP loop to mutate not just which tools are present, but how they're parameterized
3. Enable genes to reference shared MCP servers (skill libraries) rather than embedding tool logic

This is a v2 consideration — the current `tools: ["web_search"]` approach is sufficient for v1 discovery, but MCP alignment is the natural upgrade path.

---

## 4. Implications for AutoAW — Summary

| Insight | AutoAW Impact |
|---|---|
| Agentic glue outperforms committees on latency, cost, context fidelity | The GP fitness function already penalises cost and latency — the loop will naturally discover glue-like topologies when they dominate |
| `ai_orchestrated` is structurally equivalent to the glue pattern | This topology type should be well-represented in the initial seeded population |
| Skills/tools are as important as topology | Treat the `tools` list as a first-class mutable gene attribute alongside `system_prompt` |
| Compaction (n→1) is the evolutionary path to glue | The compaction mutation operator enables the GP loop to discover this transition — it should not be artificially constrained |
| Multi-agent justified for debate, security boundaries, context overflow | These use cases map to `debate`, `parallel_reduce`, and `hybrid` topologies — all valid regions of the search space |
| MCP is the standardization layer | Align gene schema's `tools` definition with MCP tool schema as a v2 upgrade |

The key architectural conclusion: **AutoAW should not pre-suppose which architecture wins — but it should be structured so that the fitness function can discover it.** The existing multi-objective fitness (quality, cost, speed) already provides the selection pressure needed to favour glue over committees when glue is genuinely faster and cheaper. The evolutionary operators (mutate_structure, compaction, delegation split) provide the genetic path to get there.
