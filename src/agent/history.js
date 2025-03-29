import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
// ... other imports ...
import settings from '../../settings.js'; // Ensure settings is imported

export class History {
    constructor(agent) {
        this.agent = agent; // Store agent reference
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        this.memory = await this.agent.prompter.promptMemSaving(turns);

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            await this.summarizeMemories(chunk);
            await this.appendFullHistory(chunk);
        }
    }

    async save() {
        try {
            let data = {
                // Always save these regardless of mode
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                last_sender: this.agent.last_sender
                // Potentially add memory_bank and npc data saving here if needed later
            };

            if (settings.useOpenAIAgentMemory) {
                // Save OpenAI Agent state
                data.openaiAgentInputState = this.agent.openaiAgentInputState;
                // Optionally clear or don't save bot memory fields
                data.memory = '';
                data.turns = [];
                console.log('Saving OpenAI Agent state to:', this.memory_fp);
            } else {
                // Save standard bot memory state
                data.memory = this.memory;
                data.turns = this.turns;
                // Optionally clear or don't save agent state field
                data.openaiAgentInputState = [];
                console.log('Saving standard bot memory to:', this.memory_fp);
            }

            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));

        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                // Initialize states based on toggle even if file doesn't exist
                if (settings.useOpenAIAgentMemory) {
                    this.agent.openaiAgentInputState = [];
                    this.memory = '';
                    this.turns = [];
                } else {
                    this.agent.openaiAgentInputState = [];
                    this.memory = '';
                    this.turns = [];
                }
                return null;
            }

            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));

            if (settings.useOpenAIAgentMemory) {
                // Load OpenAI Agent state
                this.agent.openaiAgentInputState = data.openaiAgentInputState || [];
                this.memory = ''; // Ensure bot memory is clear
                this.turns = [];  // Ensure bot turns are clear
                console.log('Loaded OpenAI Agent state.');
            } else {
                // Load standard bot memory state
                this.memory = data.memory || '';
                this.turns = data.turns || [];
                this.agent.openaiAgentInputState = []; // Ensure agent state is clear
                console.log('Loaded standard bot memory:', this.memory);
            }

            // Return the full data object so agent.js can load self_prompter etc.
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
             // Initialize states based on toggle on error
            if (settings.useOpenAIAgentMemory) {
                this.agent.openaiAgentInputState = [];
                this.memory = '';
                this.turns = [];
            } else {
                this.agent.openaiAgentInputState = [];
                this.memory = '';
                this.turns = [];
            }
            throw error;
        }
    }

    clear() {
        // Clear both states regardless of current mode
        this.turns = [];
        this.memory = '';
        if (this.agent) { // Check if agent exists (might be called early)
             this.agent.openaiAgentInputState = [];
        }
        console.log("Cleared all memory states.");
    }
}
