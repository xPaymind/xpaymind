import type { BenchmarkAgent, AgentMetadata } from './base.js';

interface RegistryEntry {
  agent: BenchmarkAgent;
  registeredAt: Date;
}

export class AgentRegistry {
  private readonly agents = new Map<string, RegistryEntry>();

  register(agent: BenchmarkAgent): void {
    const { id, version } = agent.metadata;
    const key = `${id}@${version}`;
    if (this.agents.has(key)) {
      throw new Error(`Agent ${key} is already registered`);
    }
    this.agents.set(key, { agent, registeredAt: new Date() });
  }

  unregister(agentId: string, version: string): boolean {
    return this.agents.delete(`${agentId}@${version}`);
  }

  get(agentId: string, version: string): BenchmarkAgent | undefined {
    return this.agents.get(`${agentId}@${version}`)?.agent;
  }

  getLatest(agentId: string): BenchmarkAgent | undefined {
    let latest: { entry: RegistryEntry; version: string } | undefined;
    for (const [key, entry] of this.agents) {
      const [id, ver] = key.split('@') as [string, string];
      if (id === agentId) {
        if (!latest || ver > latest.version) latest = { entry, version: ver };
      }
    }
    return latest?.entry.agent;
  }

  list(): AgentMetadata[] {
    return [...this.agents.values()].map((e) => e.agent.metadata);
  }

  size(): number {
    return this.agents.size;
  }
}

export const globalAgentRegistry = new AgentRegistry();
