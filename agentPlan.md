# Agent Plan: Emergent Gameplay via Planner/Doer Architecture

This document outlines a two-agent architecture (Planner and Doer) designed to facilitate emergent gameplay and long-term learning within the Mineflayer environment, specifically leveraging the `useOpenAIAgentMemory = true` setting.

## Goal

To create an autonomous agent system that can:
1.  Explore the Minecraft world dynamically.
2.  Set its own intermediate goals based on discoveries and needs.
3.  Attempt to achieve these goals through action execution.
4.  Learn from successes and failures over time by analyzing its action history.
5.  Exhibit unpredictable, emergent behavior arising from its interactions with the environment and its adaptive planning.

## Core Architecture: Planner/Doer

This architecture separates the cognitive load into two specialized agents:

1.  **Planner Agent:**
    *   **Role:** High-level strategist and decision-maker.
    *   **Responsibilities:**
        *   **Observe:** Regularly query the environment (`!stats`, `!inventory`, `!nearbyBlocks`, `!entities`).
        *   **Analyze:** Review the *entire* conversation history (`openaiAgentInputState`), focusing on recent events, discoveries, inventory status, past actions, and especially past failures/errors.
        *   **Plan:** Decide the *single next high-level goal* or direction based on the analysis. This plan should be adaptive (e.g., prioritize mining if iron is found, prioritize farming if low on food, prioritize safety if recently died).
        *   **Delegate:** Formulate a *specific, concrete, actionable task* derived from the plan.
        *   **Handoff:** Use a dedicated handoff tool (e.g., `execute_task`) to pass this single task to the Doer Agent.
    *   **Tools:** Primarily uses query commands (`!stats`, `!inventory`, etc.) and the handoff tool.
    *   **Memory:** Relies heavily on the detailed `openaiAgentInputState` provided by the `useOpenAIAgentMemory = true` setting to make informed, context-aware decisions and learn from past outcomes.

2.  **Doer Agent:**
    *   **Role:** Task execution specialist.
    *   **Responsibilities:**
        *   Receive a specific task description via handoff from the Planner.
        *   Execute the task using the most appropriate Mineflayer commands (`!collectBlocks`, `!goToPosition`, etc.) or by generating Javascript code via `!newAction`.
        *   Report the outcome (success, failure, errors, key results) back into the conversation history (e.g., via `!log` or as the return message of the action).
        *   **Crucially:** Does *not* plan subsequent actions. Its scope is limited to the single task received.
    *   **Tools:** Primarily uses action commands (`!collectBlocks`, `!craftRecipe`, etc.) and `!newAction`. May use query commands *if necessary* for task execution (e.g., `!stats` to get current position before placing blocks relative to self).
    *   **Memory:** Uses the `openaiAgentInputState` primarily for context directly relevant to executing the *current* task (e.g., knowing the location mentioned in the task description).

## Interaction Flow (Cycle)

1.  **Planner Turn:**
    *   The main control loop runs the Planner Agent.
    *   Planner observes the world state and analyzes the full `openaiAgentInputState`.
    *   Planner decides on the next goal (e.g., "Need wood").
    *   Planner formulates a concrete task (e.g., "Gather 10 oak logs").
    *   Planner calls the `execute_task` handoff tool, passing the task description.
2.  **Handoff:**
    *   The `Runner` detects the handoff.
    *   Control is passed to the Doer Agent. The `openaiAgentInputState` now includes the Planner's observations and the `execute_task` tool call/output.
3.  **Doer Turn:**
    *   The Doer Agent receives control and sees its instructions + the task description ("Gather 10 oak logs").
    *   Doer executes the task (e.g., calls `!collectBlocks("oak_log", 10)`).
    *   The action completes (or fails). The result/error is added to `openaiAgentInputState`.
    *   The `Runner.run` call initiated in step 1 completes, returning the `RunResult`.
4.  **Loop:**
    *   The main control loop receives the `RunResult`.
    *   It prepares the *entire updated* `openaiAgentInputState` (`result.to_input_list()`) as the input for the next cycle.
    *   It sets the active agent back to the Planner Agent.
    *   The cycle repeats from step 1.

## Leveraging `useOpenAIAgentMemory = true`

This setting is key to the architecture's success:

*   **Rich Context for Planner:** The Planner doesn't rely on a potentially lossy summary. It sees the *exact* sequence of observations, decisions, actions, tool outputs, and errors, allowing for more nuanced analysis and adaptation. It can directly see "Attempt 1 to craft pickaxe failed because no sticks" and plan accordingly.
*   **Context for Doer:** The Doer receives the task within the full history, providing implicit context if needed (e.g., if the task is "Go back to the cave entrance", the location of the entrance should be somewhere earlier in the history).
*   **Implicit Learning:** Failure and success patterns become apparent to the Planner's LLM over multiple cycles by analyzing the history, enabling it to refine strategies without explicit training loops.

## Emergence and Long-Term Play

*   **Emergence:** Unpredictable behavior arises from the Planner's reaction to unforeseen environmental factors (finding a ravine, encountering a hostile mob pack, spawning in a rare biome) and its adaptation to the Doer's successes or failures. The goals are not fixed but evolve based on the agent's experiences recorded in the history.
*   **Long-Term Play:** The cycle allows for continuous operation. The detailed history enables recovery from setbacks (like death) by allowing the Planner to analyze the cause and plan differently. The agent can pursue multi-step, self-generated goals over extended periods.

## Implementation Notes

*   Requires two agent profiles (Planner, Doer) with distinct instructions.
*   Requires careful definition of the handoff tool (`execute_task`) and its input schema (`TaskInput`).
*   The main control loop (like `run_emergent_agent` in the Python example) orchestrates the cycling between Planner and Doer.
*   Robust error handling in the main loop is important to allow the Planner to react to unexpected failures in the Doer's execution.
