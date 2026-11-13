import { WorkflowDefinition } from '../domain/workflow.types.js';
import { WorkflowExecution } from '../domain/execution.types.js';
import { AuditLogEntry } from '../domain/audit.types.js';
import { IdempotencyRecord } from '../resilience/idempotency.js';

export interface IWorkflowRepository {
  save(workflow: WorkflowDefinition): Promise<void>;
  findById(id: string): Promise<WorkflowDefinition | undefined>;
  findByIdAndVersion(id: string, version: string): Promise<WorkflowDefinition | undefined>;
  findAll(): Promise<WorkflowDefinition[]>;
}

export interface IExecutionRepository {
  save(execution: WorkflowExecution): Promise<void>;
  findById(id: string): Promise<WorkflowExecution | undefined>;
  findAll(): Promise<WorkflowExecution[]>;
  findByState(state: string): Promise<WorkflowExecution[]>;
  findByWorkflowId(workflowId: string): Promise<WorkflowExecution[]>;
}

export interface IAuditRepository {
  save(entry: AuditLogEntry): Promise<void>;
  findByExecutionId(executionId: string): Promise<AuditLogEntry[]>;
  findAll(limit?: number): Promise<AuditLogEntry[]>;
}

export interface IIdempotencyRepository {
  getRecord(key: string): Promise<IdempotencyRecord | undefined>;
  saveRecord(record: IdempotencyRecord): Promise<void>;
}
