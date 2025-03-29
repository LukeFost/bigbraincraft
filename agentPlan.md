# Agent Plan: Emergent Gameplay via Planner/Doer Architecture

This document outlines a two-agent architecture (Planner and Doer) designed to facilitate emergent gameplay and long-term learning within the Mineflayer environment, specifically leveraging the `useOpenAIAgentMemory = true` setting for rich contextual history.

## Goal

To create an autonomous agent system within Minecraft that demonstrates intelligent, adaptive behavior over extended periods. The system should:
1.  **Explore:** Dynamically navigate and interact with the Minecraft world.
2.  **Adapt:** Set its own intermediate goals based on environmental discoveries, internal state (inventory, health), and past experiences.
3.  **Execute:** Reliably attempt to achieve these goals through concrete actions.
4.  **Learn:** Improve strategies over time by analyzing the outcomes (successes and failures) recorded in its detailed action history.
5.  **Emerge:** Exhibit complex, unpredictable, and potentially novel gameplay patterns not explicitly programmed but arising naturally from the interaction between planning, execution, and environmental feedback.

## Core Architecture: Planner/Doer

This architecture divides the agent's responsibilities, separating high-level strategic thinking from low-level task execution.

1.  **Planner Agent:**
    *   **Role:** The "brain" of the operation. Responsible for high-level strategy, goal setting, and adaptation.
    *   **Responsibilities:**
        *   **Observe:** Actively query the environment using commands like `!stats`, `!inventory`, `!nearbyBlocks`, `!entities`. This gathers the necessary situational awareness.
        *   **Analyze:** Critically review the *entire* conversation history (`openaiAgentInputState`). This includes:
            *   Recent environmental changes (new biomes, structures found).
            *   Current resource levels and needs (e.g., low food, sufficient wood).
            *   The sequence of past actions taken by the Doer.
            *   The specific outcomes (success messages, error messages, resource changes) of those actions.
            *   Identifying patterns of failure (e.g., repeatedly dying in a certain area, failing to craft an item due to missing prerequisites).
            *   Tracking progress towards any implicitly or explicitly defined long-term objectives.
        *   **Plan:** Based on the analysis, decide the *single next high-level goal*. This involves:
            *   Prioritizing immediate needs (e.g., finding food if hunger is critical, seeking shelter at night).
            *   Identifying opportunities (e.g., mining discovered ore, trading with a found village).
            *   Adapting strategy based on failures (e.g., if mining failed due to no pickaxe, the next goal becomes crafting one).
            *   Potentially setting longer-term objectives (e.g., "Establish a sustainable farm", "Reach the Nether").
        *   **Delegate:** Translate the high-level goal into a *specific, concrete, and actionable task* for the Doer. This task must be unambiguous and executable (e.g., "Task: Gather 10 oak logs using `!collectBlocks`", "Task: Generate code using `!newAction` to build a 3x3 dirt shelter at current location", "Task: Navigate to coordinates X,Y,Z using `!goToPosition`").
        *   **Handoff:** Use a dedicated handoff tool (e.g., `execute_task`) to pass *only* this single, concrete task description to the Doer Agent. The Planner's turn concludes upon successful handoff.
    *   **Tools:** Primarily uses query commands (`!stats`, `!inventory`, etc.) and the `execute_task` handoff tool. It should avoid executing world-altering actions directly.
    *   **Memory & Learning:** The Planner's effectiveness hinges on the detailed `openaiAgentInputState`. The rich history allows it to learn implicitly by observing cause (task given) and effect (Doer's result). Effective prompt engineering is crucial to guide its analysis, ensuring it considers past failures and adapts its plans accordingly.

2.  **Doer Agent:**
    *   **Role:** The "hands" of the operation. Focused solely on executing the specific task received.
    *   **Responsibilities:**
        *   Receive a specific task description via handoff from the Planner within the full conversation context.
        *   Interpret the task and select the most appropriate command (`!collectBlocks`, `!craftRecipe`, etc.) or generate the necessary Javascript code via `!newAction`.
        *   Execute the chosen command or code.
        *   Report the outcome clearly and concisely back into the conversation history (e.g., "SYSTEM: Successfully collected 10 oak_log.", "SYSTEM: Error executing code: ReferenceError: variable 'pos' is not defined", "SYSTEM: Placed crafting table at X,Y,Z."). This feedback is critical for the Planner.
        *   **Crucially:** Does *not* engage in planning or decision-making beyond what is strictly necessary to execute the assigned task. It should not initiate new goals or actions independently.
    *   **Tools:** Primarily uses action commands (`!collectBlocks`, `!craftRecipe`, `!newAction`, etc.). It may use simple query commands (`!stats` for position) only if essential for executing the current task, but should avoid broad environmental analysis.
    *   **Memory:** Uses the `openaiAgentInputState` mainly for immediate context related to the task (e.g., coordinates provided in the task description). It does not perform strategic analysis of the history.

## Interaction Flow (Cycle)

The system operates in a continuous loop between the Planner and the Doer:

1.  **Planner Turn:**
    *   The main control loop invokes the Planner Agent, providing the complete, up-to-date `openaiAgentInputState`.
    *   Planner uses query tools (`!stats`, `!inventory`) to get current world state. These queries and their results are added to the state.
    *   Planner analyzes the history (including previous Doer results and current observations).
    *   Planner decides on the next high-level goal (e.g., "Need shelter before nightfall").
    *   Planner formulates a concrete task (e.g., "Generate code with `!newAction` to build a 5x5 dirt house with one door and open roof.").
    *   Planner calls the `execute_task` handoff tool with the task description. The tool call itself (including the task string) is recorded in the `openaiAgentInputState`.
2.  **Handoff:**
    *   The orchestration logic detects the `execute_task` handoff.
    *   Control shifts to the Doer Agent. The `openaiAgentInputState` passed to the Doer includes everything up to and including the Planner's handoff call.
3.  **Doer Turn:**
    *   Doer Agent is invoked with the full `openaiAgentInputState`. It sees its instructions and identifies the task description from the latest `execute_task` call.
    *   Doer executes the task (e.g., calls `!newAction("Build a 5x5 dirt house...")`).
    *   The command execution logic runs the corresponding skill or code generation process.
    *   The result (e.g., "SYSTEM: Code execution started...", followed later by "SYSTEM: Successfully placed 50 dirt blocks." or "SYSTEM: Error: skills.placeBlock failed - no dirt in inventory.") is added to the `openaiAgentInputState`.
    *   The Doer's execution completes, and the `Runner.run` call finishes, returning the `RunResult`.
4.  **Loop & Feedback:**
    *   The main control loop receives the `RunResult`.
    *   It extracts the *entire updated* `openaiAgentInputState` using `result.to_input_list()`. This state now contains the Planner's reasoning (implicit in the task choice), the task itself, the Doer's attempt, and the outcome.
    *   The active agent is set back to the Planner Agent.
    *   The cycle repeats from Step 1, feeding the complete outcome of the previous cycle back to the Planner for its next round of analysis and planning.

## Leveraging `useOpenAIAgentMemory = true`

Using the direct OpenAI message history format is fundamental to this architecture's learning and adaptation capabilities:

*   **Rich Context for Planner:** The Planner has access to the *verbatim* sequence of events – observations, its own past plans (tasks), the Doer's attempts, tool outputs, system messages (like death messages), and error reports. This avoids information loss inherent in summarization and allows for precise analysis of *why* things succeeded or failed.
*   **Failure Analysis:** The Planner can directly correlate a failed task outcome (e.g., "SYSTEM: Error: No wood available for crafting") with the preceding task ("Task: Craft wooden pickaxe") and the inventory state at that time, leading to more accurate replanning (e.g., "Task: Gather 5 oak logs").
*   **Implicit Learning:** By observing sequences like [Plan -> Task -> Doer Action -> Error -> Re-Plan -> New Task -> Doer Action -> Success], the Planner's underlying LLM can implicitly learn effective strategies and prerequisites for tasks without explicit training. Repeated failures associated with certain conditions (e.g., mining at night) can lead to behavioral changes.
*   **Long-Term Goal Tracking:** Complex, multi-step goals (like building a large structure or reaching the Nether) are naturally tracked through the persistent history of attempts, resource gathering, and intermediate outcomes, allowing the Planner to resume or adapt the goal over many cycles.

## Emergence and Long-Term Play

*   **Emergence:** True autonomy and unpredictable strategies emerge from the Planner's continuous cycle of observing, analyzing, planning, and reacting to the Doer's feedback within the dynamic Minecraft world. Discovering a ravine might lead the Planner to prioritize exploration and mining over surface gathering. Repeated mob attacks might lead it to prioritize building defenses or crafting weapons. These are not pre-programmed responses but adaptive decisions based on the history and current state.
*   **Long-Term Play:** The architecture supports indefinite operation. The Planner can learn from deaths by analyzing the death message and surrounding context in the history, potentially avoiding dangerous areas or preparing better next time. It can pursue self-generated, complex goals (e.g., "Establish a base with automated farms") by breaking them down into sequential tasks for the Doer, adapting the plan based on the success or failure of each step over potentially hundreds of cycles.

## Error Handling and Recovery

*   **Doer Errors:** Failures during Doer execution (command errors, code exceptions, inability to find resources) are captured and reported as system messages in the `openaiAgentInputState`.
*   **Planner Reaction:** The Planner's prompt must explicitly instruct it to check for error messages from the previous Doer turn and adapt its next plan accordingly. Strategies include:
    *   **Retry:** If the error seems transient (e.g., pathfinding failure).
    *   **Decomposition:** Break the failed task into smaller, prerequisite steps (e.g., "Craft pickaxe" fails -> "Gather cobblestone", "Gather sticks").
    *   **Alternative Method:** Try a different command or approach (e.g., `!collectBlocks` fails -> `!newAction` to manually navigate and mine).
    *   **Goal Re-evaluation:** Abandon the current task/goal if it proves consistently problematic and select a different objective based on the current situation.
*   **Process Crashes:** If the agent process itself crashes, the `agent_process.js` restart mechanism should ideally reload the last saved `memory.json`. The Planner, upon restarting, would see the abrupt end of the previous history and potentially a system message indicating a restart, allowing it to re-assess the situation.

## Potential Challenges and Considerations

*   **Prompt Engineering:** Designing robust prompts for the Planner is paramount. It needs clear instructions on how to analyze the history, prioritize goals (survival vs. exploration vs. specific tasks), learn from failures, and formulate clear, executable tasks for the Doer. This will likely require significant iteration.
*   **State Consistency:** Ensuring the `openaiAgentInputState` accurately reflects the agent's state and the world is vital. Delays or errors in updating the state can lead to flawed planning.
*   **Cost and Latency:** The Planner agent, analyzing the full history each cycle, might require a powerful (and potentially expensive/slow) LLM. Optimizations might involve:
    *   Condensing the history passed to the Planner periodically (though this risks losing detail).
    *   Using a smaller/faster model for the Doer agent.
    *   Implementing heuristics for the Planner to skip analysis if the previous action was simple and successful.
*   **Doer Reliability:** The Doer must reliably execute commands and generate functional code. Errors here need clear reporting. Linting (`coder.js`) helps catch code errors before execution.
*   **Repetitive Loops:** The Planner might get stuck attempting the same failed task. The prompt should encourage trying different approaches or abandoning futile goals after repeated failures. Adding a "failure counter" for specific tasks within the Planner's internal reasoning (or explicitly in the state) could help.
*   **Context Window Limits:** As the `openaiAgentInputState` grows, it may eventually exceed the LLM's context window limit. Strategies to manage this include:
    *   Implementing a summarization mechanism (contrary to the core benefit, but may be necessary).
    *   Using models with very large context windows.
    *   Developing more sophisticated memory retrieval techniques beyond just passing the full linear history.

## Implementation Notes

*   **Agent Profiles:** Define separate profiles (`planner_profile.json`, `doer_profile.json`) with distinct instructions tailored to their roles. Consider model choice based on role complexity (e.g., GPT-4o for Planner, GPT-4o Mini for Doer).
*   **Handoff Tool:** Ensure the `execute_task` handoff tool is correctly defined using the OpenAI Agents SDK primitives (or equivalent logic) and that the `TaskInput` schema is appropriate.
*   **Orchestration Loop:** The main control loop (Python `run_emergent_agent` example or Node.js equivalent) is the heart of the cycle, managing the state (`openaiAgentInputState`) and alternating calls between the Planner and Doer.
*   **Error Feedback:** Ensure `executeCommand` and the `ActionManager` robustly catch errors and format them clearly as system messages within the `openaiAgentInputState` for the Planner to analyze.
*   **Future Enhancements:** Consider adding more specialized agents (e.g., a dedicated "Builder Agent", "Miner Agent") that the Planner can hand off to, or integrating a vector database for more complex long-term memory retrieval.
