import type { EventBus } from '../events/index.js';
import type { Formula } from '../formula/index.js';
import type { MoleculeWalker } from '../molecule/index.js';
import type { BeadRow } from '../store/index.js';
import type { Pack, RoleConfig } from '../packs/index.js';
import type { RuntimeProvider, SessionHandle } from '../runtime/index.js';
import { renderTemplate } from './render.js';

/**
 * FormulaDispatcher runs formula steps and records enough provider-opaque
 * execution metadata on molecule-step beads to resume after restart.
 * Ready steps fan out in parallel up to `maxParallelSteps`; dependency ordering
 * still comes from MoleculeWalker, so formulas can opt into parallelism by
 * declaring independent steps.
 *
 * Example restart recovery:
 *
 *   await dispatcher.resume('hvsyn-mol-abc123')
 *
 * `resume()` re-attaches only to steps already marked `in_progress` with
 * `metadata.exec.task_id`; it does not redispatch open successor steps.
 */

export interface DispatchInput {
  readonly formula: Formula;
  readonly pack: Pack;
  readonly input: string;
  readonly motivatingBeadId?: string;
}

export interface DispatchResult {
  readonly moleculeId: string;
  readonly outputs: Readonly<Record<string, string>>;
}

export interface CancelResult {
  readonly moleculeId: string;
  readonly cancelledStepCount: number;
}

export interface FormulaDispatcherOptions {
  readonly provider: RuntimeProvider;
  readonly walker: MoleculeWalker;
  readonly eventBus: EventBus;
  readonly idPrefix?: string;
  readonly maxParallelSteps?: number;
}

export class FormulaDispatchError extends Error {
  constructor(
    message: string,
    readonly moleculeId: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = 'FormulaDispatchError';
  }
}

export class FormulaCancellationConflictError extends FormulaDispatchError {
  constructor(message: string, moleculeId: string) {
    super(message, moleculeId);
    this.name = 'FormulaCancellationConflictError';
  }
}

export class FormulaDispatcher {
  private readonly provider: RuntimeProvider;
  private readonly walker: MoleculeWalker;
  private readonly eventBus: EventBus;
  private readonly idPrefix: string;
  private readonly maxParallelSteps: number;

  constructor(opts: FormulaDispatcherOptions) {
    this.provider = opts.provider;
    this.walker = opts.walker;
    this.eventBus = opts.eventBus;
    this.idPrefix = opts.idPrefix ?? 'mol';
    this.maxParallelSteps = normalizeMaxParallelSteps(opts.maxParallelSteps);
  }

  async run(input: DispatchInput): Promise<DispatchResult> {
    const startedAt = Date.now();
    const view = await this.walker.dispatch({
      prefix: this.idPrefix,
      formulaName: input.formula.name,
      title: `[formula:${input.formula.name}] ${input.formula.description || input.input.slice(0, 80)}`,
      ...(input.motivatingBeadId ? { motivatingBeadId: input.motivatingBeadId } : {}),
      steps: input.formula.steps,
    });
    const moleculeId = view.rootId;
    const outputs: Record<string, string> = {};
    const rolesByName = new Map(input.pack.roles.map((role) => [role.name, role]));

    this.emit('dispatcher/formula.started', moleculeId, undefined, {
      formulaName: input.formula.name,
      moleculeId,
      stepCount: input.formula.steps.length,
    });

    try {
      while (!(await this.walker.isComplete(moleculeId))) {
        const ready = await this.walker.findReady(moleculeId);
        if (ready.length === 0) {
          throw new FormulaDispatchError(`FormulaDispatcher: molecule ${moleculeId} has no ready steps but is incomplete`, moleculeId);
        }
        const batch = ready.slice(0, this.maxParallelSteps);
        const settled = await Promise.allSettled(batch.map((step) => this.runStep({ input, step, moleculeId, outputs, rolesByName })));
        const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
    } catch (error) {
      this.emit('dispatcher/formula.failed', moleculeId, undefined, {
        moleculeId,
        error: stringifyError(error),
      });
      throw error;
    }

    this.emit('dispatcher/formula.completed', moleculeId, undefined, {
      moleculeId,
      durationMs: Date.now() - startedAt,
    });
    return { moleculeId, outputs };
  }

  async resume(moleculeId: string): Promise<DispatchResult> {
    const startedAt = Date.now();
    const view = await this.walker.load(moleculeId);
    if (!view) {
      throw new FormulaDispatchError(`FormulaDispatcher: molecule ${moleculeId} not found`, moleculeId);
    }

    const outputs = outputsFromClosedSteps(view.steps);
    this.emit('dispatcher/formula.resumed', moleculeId, undefined, {
      moleculeId,
      runningStepCount: view.steps.filter((step) => step.status === 'in_progress').length,
    });

    const running = await this.walker.findRunning(moleculeId);
    if (running.length === 0) {
      if (await this.walker.isComplete(moleculeId)) {
        this.emit('dispatcher/formula.completed', moleculeId, undefined, {
          moleculeId,
          durationMs: Date.now() - startedAt,
          resumed: true,
        });
        return { moleculeId, outputs };
      }
      throw new FormulaDispatchError(`FormulaDispatcher: molecule ${moleculeId} has no running steps to resume`, moleculeId);
    }

    try {
      for (const step of running) {
        await this.resumeStep({ step, moleculeId, outputs });
      }
    } catch (error) {
      this.emit('dispatcher/formula.failed', moleculeId, undefined, {
        moleculeId,
        error: stringifyError(error),
        resumed: true,
      });
      throw error;
    }

    if (await this.walker.isComplete(moleculeId)) {
      this.emit('dispatcher/formula.completed', moleculeId, undefined, {
        moleculeId,
        durationMs: Date.now() - startedAt,
        resumed: true,
      });
    } else {
      this.emit('dispatcher/formula.resume.paused', moleculeId, undefined, {
        moleculeId,
        reason: 'running steps completed; open successors require a fresh formula run context',
      });
    }

    return { moleculeId, outputs };
  }

  async cancel(moleculeId: string): Promise<CancelResult> {
    const view = await this.walker.load(moleculeId);
    if (!view) {
      throw new FormulaDispatchError(`FormulaDispatcher: molecule ${moleculeId} not found`, moleculeId);
    }
    const running = await this.walker.findRunning(moleculeId);
    if (running.length === 0) {
      throw new FormulaCancellationConflictError(`FormulaDispatcher: molecule ${moleculeId} has no running steps to cancel`, moleculeId);
    }

    let cancelledStepCount = 0;
    for (const step of running) {
      const stepName = readStepName(step);
      const role = readStepRole(step);
      const exec = readExec(step);
      const sessionId = readString(exec.session_id);
      const providerKind = readString(exec.provider_kind);
      const taskId = readString(exec.task_id) ?? undefined;
      if (sessionId && providerKind) {
        await this.provider.stop({ id: sessionId, providerKind });
      }
      await this.walker.failStep(step.id, 'cancelled');
      cancelledStepCount++;
      this.emit('dispatcher/step.cancelled', moleculeId, taskId, {
        stepName,
        role,
        stepId: step.id,
        ...(sessionId ? { sessionId } : {}),
      });
    }

    this.emit('dispatcher/formula.cancelled', moleculeId, undefined, {
      moleculeId,
      cancelledStepCount,
    });
    return { moleculeId, cancelledStepCount };
  }

  private async runStep(args: {
    readonly input: DispatchInput;
    readonly step: BeadRow;
    readonly moleculeId: string;
    readonly outputs: Record<string, string>;
    readonly rolesByName: ReadonlyMap<string, RoleConfig>;
  }): Promise<void> {
    const stepName = readStepName(args.step);
    const stepSpec = args.input.formula.steps.find((candidate) => candidate.name === stepName);
    if (!stepSpec) {
      throw new FormulaDispatchError(`FormulaDispatcher: no formula step for molecule bead ${args.step.id}`, args.moleculeId);
    }
    const roleConfig = args.rolesByName.get(stepSpec.role);
    if (!roleConfig) {
      throw new FormulaDispatchError(`FormulaDispatcher: pack ${args.input.pack.manifest.name} has no role "${stepSpec.role}"`, args.moleculeId);
    }
    if (!stepSpec.promptTemplate) {
      throw new FormulaDispatchError(`FormulaDispatcher: step "${stepName}" has no promptTemplate`, args.moleculeId);
    }

    this.emit('dispatcher/step.started', args.moleculeId, args.step.id, {
      stepName,
      role: stepSpec.role,
      stepId: args.step.id,
    });

    let handle: Awaited<ReturnType<RuntimeProvider['start']>> | null = null;
    let eventCount = 0;
    let output = '';
    try {
      await this.walker.startStep(args.step.id);
      const rendered = renderTemplate({
        packRoot: args.input.pack.root,
        template: stepSpec.promptTemplate,
        context: renderContext(args.input.input, args.outputs),
      });
      handle = await this.provider.start({
        role: stepSpec.role,
        label: `${args.input.formula.name}/${stepName}`,
        extra: {
          moleculeId: args.moleculeId,
          stepName,
          memfsEnabled: false,
          memoryBlocks: roleConfig.memoryBlocks ?? [],
          ...(roleConfig.memoryBlocksPolicy?.mode === 'replace' ? { memoryBlockSeedMode: 'replace' } : {}),
        },
      });
      const promptResult = await this.provider.prompt(handle, [{ type: 'text', text: rendered }]);
      if (promptResult.taskId) {
        await this.walker.recordStepTask(args.step.id, {
          taskId: promptResult.taskId,
          providerKind: handle.providerKind,
          sessionId: handle.id,
        });
        this.emit('dispatcher/step.task_recorded', args.moleculeId, promptResult.taskId, {
          stepName,
          role: stepSpec.role,
          stepId: args.step.id,
          sessionId: handle.id,
        });
      }
      for await (const event of this.provider.observe(handle)) {
        eventCount++;
        if (event.kind === 'message-delta') output += event.text;
        if (event.kind === 'error') throw new Error(event.message);
        if (event.kind === 'stopped') throw new Error('runtime stopped before turn completion');
        if (event.kind === 'turn-done') break;
      }
      args.outputs[stepName] = output;
      await this.walker.finishStep(args.step.id, { output, eventCount });
      this.emit('dispatcher/step.finished', args.moleculeId, args.step.id, {
        stepName,
        role: stepSpec.role,
        stepId: args.step.id,
        outputLength: output.length,
      });
    } catch (error) {
      await this.walker.failStep(args.step.id, stringifyError(error));
      this.emit('dispatcher/step.failed', args.moleculeId, args.step.id, {
        stepName,
        role: stepSpec.role,
        stepId: args.step.id,
        error: stringifyError(error),
      });
      throw new FormulaDispatchError(`FormulaDispatcher: step "${stepName}" failed`, args.moleculeId, { cause: error });
    } finally {
      if (handle) await this.provider.stop(handle);
    }
  }

  private async resumeStep(args: {
    readonly step: BeadRow;
    readonly moleculeId: string;
    readonly outputs: Record<string, string>;
  }): Promise<void> {
    const stepName = readStepName(args.step);
    const role = readStepRole(args.step);
    const exec = readExec(args.step);
    const taskId = readString(exec.task_id);
    if (!taskId) {
      const error = `FormulaDispatcher.resume: running step ${args.step.id} has no metadata.exec.task_id`;
      await this.walker.failStep(args.step.id, error);
      this.emit('dispatcher/step.failed', args.moleculeId, args.step.id, { stepName, role, stepId: args.step.id, error });
      throw new FormulaDispatchError(error, args.moleculeId);
    }

    let handle: SessionHandle | null = null;
    let eventCount = 0;
    let output = '';
    try {
      handle = await this.provider.start({
        role,
        label: `resume/${args.moleculeId}/${stepName}`,
        extra: {
          moleculeId: args.moleculeId,
          stepName,
          resumeTaskId: taskId,
          memfsEnabled: false,
        },
      });
      this.emit('dispatcher/step.reattached', args.moleculeId, taskId, {
        stepName,
        role,
        stepId: args.step.id,
        sessionId: handle.id,
      });
      for await (const event of this.provider.observe(handle)) {
        eventCount++;
        if (event.kind === 'message-delta') output += event.text;
        if (event.kind === 'error') throw new Error(event.message);
        if (event.kind === 'stopped') throw new Error('runtime stopped before turn completion');
        if (event.kind === 'turn-done') break;
      }
      args.outputs[stepName] = output;
      await this.walker.finishStep(args.step.id, { output, eventCount, resumed: true });
      this.emit('dispatcher/step.finished', args.moleculeId, args.step.id, {
        stepName,
        role,
        stepId: args.step.id,
        outputLength: output.length,
        resumed: true,
      });
    } catch (error) {
      await this.walker.failStep(args.step.id, stringifyError(error));
      this.emit('dispatcher/step.failed', args.moleculeId, args.step.id, {
        stepName,
        role,
        stepId: args.step.id,
        error: stringifyError(error),
        resumed: true,
      });
      throw new FormulaDispatchError(`FormulaDispatcher: resumed step "${stepName}" failed`, args.moleculeId, { cause: error });
    } finally {
      if (handle) await this.provider.stop(handle);
    }
  }

  private emit(kind: string, moleculeId: string, taskId: string | undefined, payload: Readonly<Record<string, unknown>>): void {
    this.eventBus.emit({
      layer: 'dispatcher',
      kind,
      molecule_id: moleculeId,
      ...(taskId ? { task_id: taskId } : {}),
      payload,
    });
  }
}

function renderContext(input: string, outputs: Readonly<Record<string, string>>): Readonly<Record<string, string | number | boolean>> {
  const context: Record<string, string> = { input };
  for (const [stepName, output] of Object.entries(outputs)) {
    context[`prior_${stepName}`] = output;
  }
  return context;
}

function readStepName(row: BeadRow): string {
  const exec = readExec(row);
  if (!('step' in exec) || typeof exec.step !== 'string') {
    throw new Error(`FormulaDispatcher: molecule step ${row.id} is missing metadata.exec.step`);
  }
  return exec.step;
}

function readStepRole(row: BeadRow): string {
  const match = /] (.+)$/.exec(row.title);
  if (!match?.[1]) {
    throw new Error(`FormulaDispatcher: molecule step ${row.id} is missing role in title`);
  }
  return match[1];
}

function outputsFromClosedSteps(steps: readonly BeadRow[]): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const step of steps) {
    if (step.status !== 'closed') continue;
    const stepName = readStepName(step);
    const payload = readExec(step).output_payload;
    if (payload && typeof payload === 'object' && 'output' in payload && typeof payload.output === 'string') {
      outputs[stepName] = payload.output;
    }
  }
  return outputs;
}

function readExec(row: BeadRow): Record<string, unknown> {
  const exec = row.metadata.exec;
  return exec && typeof exec === 'object' ? exec as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeMaxParallelSteps(value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  if (value < 1) {
    throw new Error('FormulaDispatcher: maxParallelSteps must be at least 1');
  }
  return Math.floor(value);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
