import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryStore } from '../storage/in-memory-store.js';
import { WorkflowDefinition } from '../domain/workflow.types.js';
import { RulesetDefinition } from '../domain/rule.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkflowConfigFile {
  workflow: WorkflowDefinition;
  ruleset: RulesetDefinition;
}

export function loadDefaultWorkflows(store: InMemoryStore): void {
  const configDir = __dirname;
  const files = fs.readdirSync(configDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(configDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: WorkflowConfigFile = JSON.parse(raw);

      if (data.workflow && data.ruleset) {
        store.save(data.workflow);
        store.saveRuleset(data.ruleset);
      }
    } catch (err) {
      console.error(`Failed to load workflow configuration from ${file}:`, err);
    }
  }
}
