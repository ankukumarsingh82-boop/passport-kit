/**
 * Tool boundary shared by every PassportKit agent.
 * Adapters translate a transport into runAgent(). They do not implement tools.
 */
export interface ToolContext {
  root: string;
  agentId: string;
  runId: string;
  notes: Map<string, string>;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: unknown, context: ToolContext): Promise<unknown>;
}