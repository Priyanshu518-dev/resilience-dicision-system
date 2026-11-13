import { WorkflowDefinition } from '../domain/workflow.types.js';
import { WorkflowExecution } from '../domain/execution.types.js';
import { AuditLogEntry } from '../domain/audit.types.js';
import { RulesetDefinition } from '../domain/rule.types.js';
import { IdempotencyRecord } from '../resilience/idempotency.js';
import {
  IWorkflowRepository,
  IExecutionRepository,
  IAuditRepository,
  IIdempotencyRepository,
} from './repository.interface.js';

export class InMemoryStore
  implements IWorkflowRepository, IExecutionRepository, IAuditRepository, IIdempotencyRepository
{
  private static instance: InMemoryStore;

  // Workflows stored by `${id}@${version}`
  private workflows: Map<string, WorkflowDefinition> = new Map();
  // Rulesets stored by `rulesetId`
  private rulesets: Map<string, RulesetDefinition> = new Map();
  // Executions stored by `executionId`
  private executions: Map<string, WorkflowExecution> = new Map();
  // Audit entries stored by `executionId` -> list
  private auditLogs: Map<string, AuditLogEntry[]> = new Map();
  // Idempotency records stored by `idempotencyKey`
  private idempotencyRecords: Map<string, IdempotencyRecord> = new Map();

  public static getInstance(): InMemoryStore {
    if (!InMemoryStore.instance) {
      InMemoryStore.instance = new InMemoryStore();
    }
    return InMemoryStore.instance;
  }

  // --- Workflows ---
  public async save(workflow: WorkflowDefinition): Promise<void> {
    const key = `${workflow.id}@${workflow.version}`;
    this.workflows.set(key, JSON.parse(JSON.stringify(workflow)));
    // Also save under just id as latest if not present or newer
    this.workflows.set(workflow.id, JSON.parse(JSON.stringify(workflow)));
  }

  public async findById(id: string): Promise<WorkflowDefinition | undefined> {
    const item = this.workflows.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  public async findByIdAndVersion(id: string, version: string): Promise<WorkflowDefinition | undefined> {
    const item = this.workflows.get(`${id}@${version}`);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  public async findAll(): Promise<WorkflowDefinition[]> {
    // Return unique latest versions
    const uniqueMap = new Map<string, WorkflowDefinition>();
    for (const [key, wf] of this.workflows.entries()) {
      if (key.includes('@')) {
        uniqueMap.set(key, wf);
      }
    }
    return Array.from(uniqueMap.values()).map((w) => JSON.parse(JSON.stringify(w)));
  }

  // --- Rulesets ---
  public async saveRuleset(ruleset: RulesetDefinition): Promise<void> {
    this.rulesets.set(ruleset.id, JSON.parse(JSON.stringify(ruleset)));
  }

  public async getRuleset(rulesetId: string): Promise<RulesetDefinition | undefined> {
    const item = this.rulesets.get(rulesetId);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  // --- Executions ---
  public async saveExecution(execution: WorkflowExecution): Promise<void> {
    this.executions.set(execution.id, JSON.parse(JSON.stringify(execution)));
  }

  public async findExecutionById(id: string): Promise<WorkflowExecution | undefined> {
    const item = this.executions.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  // Backward compatibility alias for IExecutionRepository
  public async findById_Execution(id: string): Promise<WorkflowExecution | undefined> {
    return this.findExecutionById(id);
  }

  public async findAllExecutions(): Promise<WorkflowExecution[]> {
    return Array.from(this.executions.values())
      .map((e) => JSON.parse(JSON.stringify(e)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async findByState(state: string): Promise<WorkflowExecution[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.state === state)
      .map((e) => JSON.parse(JSON.stringify(e)));
  }

  public async findByWorkflowId(workflowId: string): Promise<WorkflowExecution[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.workflowId === workflowId)
      .map((e) => JSON.parse(JSON.stringify(e)));
  }

  // --- Audit Logs ---
  public async saveAuditEntry(entry: AuditLogEntry): Promise<void> {
    const list = this.auditLogs.get(entry.executionId) || [];
    list.push(JSON.parse(JSON.stringify(entry)));
    this.auditLogs.set(entry.executionId, list);
  }

  public async findAuditByExecutionId(executionId: string): Promise<AuditLogEntry[]> {
    const list = this.auditLogs.get(executionId) || [];
    return JSON.parse(JSON.stringify(list));
  }

  public async findAllAudits(limit = 100): Promise<AuditLogEntry[]> {
    const all: AuditLogEntry[] = [];
    for (const entries of this.auditLogs.values()) {
      all.push(...entries);
    }
    return all
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // --- Idempotency ---
  public async getRecord(key: string): Promise<IdempotencyRecord | undefined> {
    const item = this.idempotencyRecords.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  public async saveRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotencyRecords.set(record.key, JSON.parse(JSON.stringify(record)));
  }

  public clearAll(): void {
    this.workflows.clear();
    this.rulesets.clear();
    this.executions.clear();
    this.auditLogs.clear();
    this.idempotencyRecords.clear();
  }
}
