import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from '../agent/commands/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../../settings.js';

import { Gemini } from './gemini.js';
import { GPT } from './gpt.js';
import { Claude } from './claude.js';
import { Mistral } from './mistral.js';
import { ReplicateAPI } from './replicate.js';
import { Local } from './local.js';
import { Novita } from './novita.js';
import { GroqCloudAPI } from './groq.js';
import { HuggingFace } from './huggingface.js';
import { Qwen } from "./qwen.js";
import { Grok } from "./grok.js";
import { DeepSeek } from './deepseek.js';
import { OpenRouter } from './openrouter.js';

export class Prompter {
    constructor(agent, fp) {
        this.agent = agent;
        this.profile = JSON.parse(readFileSync(fp, 'utf8'));
        let default_profile = JSON.parse(readFileSync('./profiles/defaults/_default.json', 'utf8'));
        let base_fp = settings.base_profile;
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base


        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;

        // try to get "max_tokens" parameter, else null
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        let chat_model_profile = this._selectAPI(this.profile.model);
        this.chat_model = this._createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = this._selectAPI(this.profile.code_model);
            this.code_model = this._createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        let embedding = this.profile.embedding;
        if (embedding === undefined) {
            if (chat_model_profile.api !== 'ollama')
                embedding = {api: chat_model_profile.api};
            else
                embedding = {api: 'none'};
        }
        else if (typeof embedding === 'string' || embedding instanceof String)
            embedding = {api: embedding};

        console.log('Using embedding settings:', embedding);

        try {
            if (embedding.api === 'google')
                this.embedding_model = new Gemini(embedding.model, embedding.url);
            else if (embedding.api === 'openai')
                this.embedding_model = new GPT(embedding.model, embedding.url);
            else if (embedding.api === 'replicate')
                this.embedding_model = new ReplicateAPI(embedding.model, embedding.url);
            else if (embedding.api === 'ollama')
                this.embedding_model = new Local(embedding.model, embedding.url);
            else if (embedding.api === 'qwen')
                this.embedding_model = new Qwen(embedding.model, embedding.url);
            else if (embedding.api === 'mistral')
                this.embedding_model = new Mistral(embedding.model, embedding.url);
            else if (embedding.api === 'huggingface')
                this.embedding_model = new HuggingFace(embedding.model, embedding.url);
            else if (embedding.api === 'novita')
                this.embedding_model = new Novita(embedding.model, embedding.url);
            else {
                this.embedding_model = null;
                let embedding_name = embedding ? embedding.api : '[NOT SPECIFIED]'
                console.warn('Unsupported embedding: ' + embedding_name + '. Using word-overlap instead, expect reduced performance. Recommend using a supported embedding model. See Readme.');
            }
        }
        catch (err) {
            console.warn('Warning: Failed to initialize embedding model:', err.message);
            console.log('Continuing anyway, using word-overlap instead.');
            this.embedding_model = null;
        }
        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    _selectAPI(profile) {
        if (typeof profile === 'string' || profile instanceof String) {
            profile = {model: profile};
        }
        if (!profile.api) {
            if (profile.model.includes('gemini'))
                profile.api = 'google';
            else if (profile.model.includes('openrouter/'))
                profile.api = 'openrouter'; // must do before others bc shares model names
            else if (profile.model.includes('gpt') || profile.model.includes('o1')|| profile.model.includes('o3'))
                profile.api = 'openai';
            else if (profile.model.includes('claude'))
                profile.api = 'anthropic';
            else if (profile.model.includes('huggingface/'))
                profile.api = "huggingface";
            else if (profile.model.includes('replicate/'))
                profile.api = 'replicate';
            else if (profile.model.includes('mistralai/') || profile.model.includes("mistral/"))
                model_profile.api = 'mistral';
            else if (profile.model.includes("groq/") || profile.model.includes("groqcloud/"))
                profile.api = 'groq';
            else if (profile.model.includes('novita/'))
                profile.api = 'novita';
            else if (profile.model.includes('qwen'))
                profile.api = 'qwen';
            else if (profile.model.includes('grok'))
                profile.api = 'xai';
            else if (profile.model.includes('deepseek'))
                profile.api = 'deepseek';
	    else if (profile.model.includes('mistral'))
                profile.api = 'mistral';
            else if (profile.model.includes('llama3'))
                profile.api = 'ollama';
            else 
                throw new Error('Unknown model:', profile.model);
        }
        return profile;
    }

    _createModel(profile) {
        let model = null;
        if (profile.api === 'google')
            model = new Gemini(profile.model, profile.url, profile.params);
        else if (profile.api === 'openai')
            model = new GPT(profile.model, profile.url, profile.params);
        else if (profile.api === 'anthropic')
            model = new Claude(profile.model, profile.url, profile.params);
        else if (profile.api === 'replicate')
            model = new ReplicateAPI(profile.model.replace('replicate/', ''), profile.url, profile.params);
        else if (profile.api === 'ollama')
            model = new Local(profile.model, profile.url, profile.params);
        else if (profile.api === 'mistral')
            model = new Mistral(profile.model, profile.url, profile.params);
        else if (profile.api === 'groq')
            model = new GroqCloudAPI(profile.model.replace('groq/', '').replace('groqcloud/', ''), profile.url, profile.params);
        else if (profile.api === 'huggingface')
            model = new HuggingFace(profile.model, profile.url, profile.params);
        else if (profile.api === 'novita')
            model = new Novita(profile.model.replace('novita/', ''), profile.url, profile.params);
        else if (profile.api === 'qwen')
            model = new Qwen(profile.model, profile.url, profile.params);
        else if (profile.api === 'xai')
            model = new Grok(profile.model, profile.url, profile.params);
        else if (profile.api === 'deepseek')
            model = new DeepSeek(profile.model, profile.url, profile.params);
        else if (profile.api === 'openrouter')
            model = new OpenRouter(profile.model.replace('openrouter/', ''), profile.url, profile.params);
        else
            throw new Error('Unknown API:', profile.api);
        return model;
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, context, examples=null, to_summarize=[], last_goals=null) { // Renamed 'messages' to 'context' for clarity
        // --- Add logging here ---
        // console.log("--- replaceStrings called ---");
        // console.log("Original prompt template:\n", prompt);
        // console.log("Context received:", JSON.stringify(context, null, 2));
        // --- End logging ---

        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs());

        // --- CODE_TASK and CODE_DOCS Handling ---
        let code_task_content = ''; // Initialize outside the if block
        if (prompt.includes('$CODE_DOCS') || prompt.includes('$CODE_TASK')) {
             // Extract prompt from the *last* message containing !newAction
             // Ensure context is an array before using slice/find
             const messageList = Array.isArray(context) ? context : [];
             // --- Add logging here ---
             console.log("Searching for !newAction in messageList:", JSON.stringify(messageList, null, 2));
             // --- End logging ---
             const actionMsg = messageList.slice().reverse().find(msg =>
                 msg && msg.role !== 'system' && typeof msg.content === 'string' && msg.content.includes('!newAction(')
             );
             // --- Add logging here ---
             console.log("Found actionMsg:", actionMsg);
             // --- End logging ---
             // Safely extract content within parentheses, handling optional quotes
             code_task_content = actionMsg?.content?.match(/!newAction\("?([^"]*)"?\)/)?.[1] || '';
             // --- Add logging here ---
             console.log("Extracted code_task_content:", code_task_content); // <<< KEEP THIS LOG
             // --- End logging ---

             if (prompt.includes('$CODE_DOCS')) {
                 prompt = prompt.replaceAll(
                     '$CODE_DOCS',
                     await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
                 );
             }
             // Replace the new $CODE_TASK placeholder
             if (prompt.includes('$CODE_TASK')) {
                 const replacementValue = code_task_content || 'No specific task provided in !newAction command.';
                 // --- Add logging here ---
                 console.log(`Replacing $CODE_TASK with: "${replacementValue}"`); // <<< KEEP THIS LOG
                 // --- End logging ---
                 prompt = prompt.replaceAll('$CODE_TASK', replacementValue);
             }
        }
        // --- End CODE_TASK and CODE_DOCS Handling ---


        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(context)); // Pass context here too

        if (prompt.includes('$MEMORY')) {
            if (settings.useOpenAIAgentMemory) {
                // If using OpenAI Agent memory, the conversation history *is* the memory.
                // Remove the placeholder or replace with an empty/informative string.
                prompt = prompt.replaceAll('$MEMORY', ''); // Or potentially "Memory handled by agent context."
            } else {
                // Only include bot's summarized memory if NOT using OpenAI Agent memory
                prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
            }
        }

        if (prompt.includes('$TO_SUMMARIZE')) // This is for promptMemSaving, should still work
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(context)); // Pass context here too
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS') && last_goals) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`;
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`;
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        } else if (prompt.includes('$LAST_GOALS')) {
             prompt = prompt.replaceAll('$LAST_GOALS', ''); // Remove placeholder if no last_goals provided
        }

        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions && Object.keys(this.agent.npc.constructions).length > 0) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            } else {
                 prompt = prompt.replaceAll('$BLUEPRINTS', 'None'); // Indicate no blueprints if object is empty/null
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            // Filter out $MEMORY if it's expected to be missing
            remaining = remaining.filter(placeholder => !(settings.useOpenAIAgentMemory && placeholder === '$MEMORY'));
           // Filter out $CODE_TASK if it was handled but the placeholder wasn't in the prompt string
           remaining = remaining.filter(placeholder => !(placeholder === '$CODE_TASK' && code_task_content !== ''));
            if (remaining.length > 0) {
                console.warn('Unknown prompt placeholders:', remaining.join(', '));
            }
        }

        // --- Add logging here ---
        if (prompt.includes('TASK:')) { // Only log the final prompt if it's for coding
             console.log("Final prompt being returned for coding:\n", prompt); // <<< KEEP THIS LOG
        }
        // console.log("--- replaceStrings finished ---");
        // --- End logging ---
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(context) { // Changed 'messages' to 'context'
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;
        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }
            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, context, this.convo_examples); // Pass context
            let generation = await this.chat_model.sendRequest(context, prompt); // Pass context
            // in conversations >2 players LLMs tend to hallucinate and role-play as other bots
            // the FROM OTHER BOT tag should never be generated by the LLM
            if (generation.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }
            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(this.agent.name + ' received new message while generating, discarding old response.');
                return '';
            }
            return generation;
        }
        return '';
    }

    async promptCoding(context) { // Changed 'messages' to 'context'
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        await this.checkCooldown();
        let prompt = this.profile.coding;
        // Pass context to replaceStrings
        prompt = await this.replaceStrings(prompt, context, this.coding_examples);
        let resp = await this.code_model.sendRequest(context, prompt); // Pass context here too
        this.awaiting_coding = false;
        return resp;
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        return await this.chat_model.sendRequest([], prompt);
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let context; // Define context based on memory mode
        if (settings.useOpenAIAgentMemory) {
            context = JSON.parse(JSON.stringify(this.agent.openaiAgentInputState)); // Use agent state
            context.push({role: 'user', content: new_message});
        } else {
            context = this.agent.history.getHistory(); // Use standard history
            context.push({role: 'user', content: new_message});
        }
        prompt = await this.replaceStrings(prompt, null, null, context); // Pass context to replaceStrings for $TO_SUMMARIZE
        let res = await this.chat_model.sendRequest([], prompt);
        return res.trim().toLowerCase() === 'respond';
    }

    async promptGoalSetting(context, last_goals) { // Changed 'messages' to 'context'
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, context); // Pass context

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, context, null, null, last_goals); // Pass context
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }
}
