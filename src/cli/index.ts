import { Command } from 'commander';
import fs from 'node:fs';
import { InMemoryStore } from '../storage/in-memory-store.js';
import { loadDefaultWorkflows } from '../config/load-workflows.js';
import { WorkflowOrchestrator } from '../orchestrator/workflow-orchestrator.js';
import { ExternalServiceSimulator, ChaosMode } from '../resilience/external-service-simulator.js';

const program = new Command();
const store = InMemoryStore.getInstance();
loadDefaultWorkflows(store);

const orchestrator = new WorkflowOrchestrator();
const simulator = ExternalServiceSimulator.getInstance();

program
  .name('decision-cli')
  .description('Resilient Decision Platform - CLI Administration and Execution Utility')
  .version('1.0.0');

// List workflows
program
  .command('workflows')
  .description('List all registered workflows')
  .action(async () => {
    const list = await store.findAll();
    console.log(`\n📋 Loaded Workflows (${list.length}):`);
    console.log('='.repeat(70));
    for (const w of list) {
      console.log(`• [${w.id}] v${w.version} - ${w.name}`);
      console.log(`  Description: ${w.description}`);
      console.log(`  Initial Stage: ${w.initialStage} | Total Stages: ${w.stages.length}`);
      console.log('-'.repeat(70));
    }
  });

// Execute workflow
program
  .command('submit')
  .description('Submit an execution request for a workflow')
  .requiredOption('-w, --workflow <id>', 'Workflow identifier (e.g. loan-approval)')
  .option('-v, --version <version>', 'Workflow version')
  .option('-d, --data <jsonString>', 'JSON input payload')
  .option('-f, --file <filePath>', 'Path to JSON file containing payload')
  .option('-k, --idempotency-key <key>', 'Idempotency key')
  .option('-c, --chaos <mode>', 'Simulate chaos mode: HEALTHY, TRANSIENT_FAILURE, PERMANENT_FAILURE, TIMEOUT, RATE_LIMIT')
  .action(async (options) => {
    try {
      let input: any = {};
      if (options.file) {
        input = JSON.parse(fs.readFileSync(options.file, 'utf-8'));
      } else if (options.data) {
        input = JSON.parse(options.data);
      } else {
        // Default sample input for loan-approval
        input = {
          applicantName: 'Alice Morgan',
          requestedAmount: 25000,
          annualIncome: 95000,
          employmentStatus: 'EMPLOYED',
          creditScore: 740,
        };
        console.log('ℹ️  No input data provided. Using default sample payload.');
      }

      console.log(`\n🚀 Executing workflow '${options.workflow}'...`);
      if (options.idempotencyKey) {
        console.log(`🔑 Idempotency Key: ${options.idempotencyKey}`);
      }
      if (options.chaos) {
        console.log(`⚠️  Chaos Mode Override: ${options.chaos}`);
      }

      const execution = await orchestrator.executeWorkflow(options.workflow, input, {
        version: options.version,
        idempotencyKey: options.idempotencyKey,
        chaosOverride: options.chaos as ChaosMode,
      });

      console.log('\n================ Execution Outcome ================');
      console.log(`Execution ID : ${execution.id}`);
      console.log(`State        : ${execution.state}`);
      console.log(`Verdict      : ${execution.decision?.verdict || 'N/A'}`);
      console.log(`Summary      : ${execution.decision?.explanationSummary || 'In progress'}`);
      console.log(`Current Stage: ${execution.currentStageId}`);
      if (execution.decision?.ruleTraces?.length) {
        console.log(`\n📊 Rule Traces (${execution.ruleTraces.length}):`);
        for (const t of execution.ruleTraces) {
          const mark = t.passed ? '✅' : '❌';
          console.log(`  ${mark} [${t.ruleId}] ${t.ruleName}: ${t.explanation}`);
        }
      }
      console.log('===================================================\n');
    } catch (err: any) {
      console.error(`\n❌ Execution Error: ${err.message}`);
    }
  });

// Inspect execution
program
  .command('inspect <id>')
  .description('Inspect execution status, decision, and history')
  .action(async (id: string) => {
    const execution = await store.findExecutionById(id);
    if (!execution) {
      console.error(`❌ Execution '${id}' not found.`);
      return;
    }

    console.log(`\n🔍 Execution Inspection: ${execution.id}`);
    console.log('='.repeat(70));
    console.log(`Workflow : ${execution.workflowId} (v${execution.workflowVersion})`);
    console.log(`State    : ${execution.state}`);
    console.log(`Created  : ${execution.createdAt}`);
    console.log(`Updated  : ${execution.updatedAt}`);
    console.log(`Verdict  : ${execution.decision?.verdict || 'PENDING'}`);
    console.log(`Summary  : ${execution.decision?.explanationSummary || 'None'}`);

    console.log(`\n📜 State Transition History:`);
    for (const h of execution.stateHistory) {
      console.log(`  [${h.timestamp}] ${h.fromState} ➡️ ${h.toState} (${h.actor}): ${h.reason}`);
    }

    if (execution.manualReview) {
      console.log(`\n👤 Manual Review Status:`);
      console.log(`  Requested: ${execution.manualReview.requestedAt}`);
      console.log(`  Verdict  : ${execution.manualReview.verdict || 'PENDING ACTION'}`);
      if (execution.manualReview.reviewedAt) {
        console.log(`  Reviewer : ${execution.manualReview.reviewerId} at ${execution.manualReview.reviewedAt}`);
        console.log(`  Notes    : ${execution.manualReview.notes}`);
      }
    }
  });

// Audit trail
program
  .command('audit <id>')
  .description('View complete chronological audit trail')
  .action(async (id: string) => {
    const logs = await store.findAuditByExecutionId(id);
    if (!logs || logs.length === 0) {
      console.log(`No audit records found for execution '${id}'`);
      return;
    }

    console.log(`\n🛡️  Audit Trail for Execution: ${id} (${logs.length} events)`);
    console.log('='.repeat(80));
    for (const l of logs) {
      console.log(`[${l.timestamp}] [${l.eventType.padEnd(26)}] (${l.actor})`);
      console.log(`  ${l.summary}`);
    }
    console.log('='.repeat(80));
  });

// Manual Review
program
  .command('review <id>')
  .description('Submit human reviewer verdict on pending review')
  .requiredOption('--verdict <APPROVED|REJECTED>', 'Decision verdict')
  .requiredOption('--reviewer <id>', 'Reviewer ID')
  .requiredOption('--notes <notes>', 'Review comments')
  .action(async (id, opts) => {
    try {
      const updated = await orchestrator.applyManualReview(
        id,
        opts.reviewer,
        opts.verdict as any,
        opts.notes
      );
      console.log(`\n✅ Review successfully submitted! Execution is now: ${updated.state}`);
    } catch (err: any) {
      console.error(`❌ Review failed: ${err.message}`);
    }
  });

// Chaos config
program
  .command('chaos')
  .description('Inspect or configure simulated external dependency chaos')
  .option('-m, --mode <mode>', 'Chaos mode: HEALTHY, TRANSIENT_FAILURE, PERMANENT_FAILURE, TIMEOUT, RATE_LIMIT')
  .option('-r, --reset', 'Reset to healthy')
  .action((opts) => {
    if (opts.reset) {
      simulator.resetChaos();
      console.log('✅ Chaos reset to HEALTHY.');
      return;
    }
    if (opts.mode) {
      const updated = simulator.setChaosConfig({ mode: opts.mode as ChaosMode });
      console.log(`⚠️  Chaos mode set to: ${updated.mode}`);
      return;
    }
    console.log('\n⚙️  Current Chaos Simulation Settings:');
    console.log(JSON.stringify(simulator.getConfig(), null, 2));
  });

// Run command if called
program.parse(process.argv);
