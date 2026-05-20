/**
 * Agent Studio — DEFINE Block
 *
 * The DEFINE block is the first step in the Agent Studio workflow.
 * It captures the agent's identity: a name, a type, and a description.
 *
 * Agent Types
 * ───────────
 *   payment    — handles x402 micropayments for API resources
 *   treasury   — manages on-chain treasury operations and multi-sig flows
 *   compliance — performs KYC / AML checks via gated compliance APIs
 *   lending    — evaluates creditworthiness and interacts with lending protocols
 *   custom     — freeform agent with user-defined capabilities
 *
 * Each field ships with a label, a hint (shown below the field in the Studio UI),
 * and a validation rule so developers get instant feedback as they type.
 *
 * Styling notes (mono-style UI)
 * ─────────────────────────────
 *   - All text inputs use a monospace font family (JetBrains Mono / Fira Code fallback)
 *   - Focus state: 1 px solid #a3e635 (lime) outline, no box-shadow
 *   - Labels: uppercase, letter-spacing 0.08em, font-size 0.75rem, color #9ca3af
 *   - Hints: font-size 0.7rem, color #6b7280, margin-top 4 px
 *   - Error state: border-color #f87171, hint text turns #f87171
 */

// ---------------------------------------------------------------------------
// Agent Type
// ---------------------------------------------------------------------------

export const AGENT_TYPES = ['payment', 'treasury', 'compliance', 'lending', 'custom'] as const;
export type AgentType = typeof AGENT_TYPES[number];

export const AGENT_TYPE_META: Record<AgentType, { label: string; description: string; defaultCapabilities: string[] }> = {
  payment: {
    label: 'Payment',
    description: 'Handles x402 micropayments for gated API resources autonomously.',
    defaultCapabilities: ['x402', 'cost-optimisation'],
  },
  treasury: {
    label: 'Treasury',
    description: 'Manages on-chain treasury flows, multi-sig approvals, and fund sweeps.',
    defaultCapabilities: ['x402', 'concurrent', 'cost-optimisation'],
  },
  compliance: {
    label: 'Compliance',
    description: 'Queries KYC / AML APIs and generates regulatory-grade audit trails.',
    defaultCapabilities: ['x402', 'error-recovery', 'open-banking'],
  },
  lending: {
    label: 'Lending',
    description: 'Evaluates creditworthiness signals and interfaces with micro-lending protocols.',
    defaultCapabilities: ['x402', 'negotiation', 'neobanking'],
  },
  custom: {
    label: 'Custom',
    description: 'Freeform agent — declare your own capabilities and payment strategy.',
    defaultCapabilities: ['x402'],
  },
};

// ---------------------------------------------------------------------------
// Field schemas (labels + hints + validation rules)
// ---------------------------------------------------------------------------

export interface FieldSchema {
  /** Field identifier (maps to DefineBlockInput key). */
  field: keyof DefineBlockInput;
  /** Uppercase label rendered above the input. */
  label: string;
  /** Hint text rendered below the input in muted colour. */
  hint: string;
  /** Placeholder shown inside an empty input. */
  placeholder: string;
  /** Whether the field is required. */
  required: boolean;
  /** Validation function — returns an error message or null. */
  validate(value: unknown): string | null;
}

export const DEFINE_FIELD_SCHEMAS: FieldSchema[] = [
  {
    field: 'name',
    label: 'AGENT NAME',
    hint: 'Unique display name shown on the leaderboard. 3–48 characters, letters, numbers, spaces and hyphens only.',
    placeholder: 'e.g. AlphaPayAgent-v1',
    required: true,
    validate(value) {
      if (typeof value !== 'string' || value.trim().length < 3) return 'Name must be at least 3 characters.';
      if (value.trim().length > 48) return 'Name must be 48 characters or fewer.';
      if (!/^[a-zA-Z0-9 \-_]+$/.test(value.trim())) return 'Only letters, numbers, spaces, hyphens, and underscores are allowed.';
      return null;
    },
  },
  {
    field: 'agentType',
    label: 'AGENT TYPE',
    hint: 'Select the banking function this agent is designed for. Determines the default capability set and recommended benchmark suite.',
    placeholder: 'Select a type…',
    required: true,
    validate(value) {
      if (!AGENT_TYPES.includes(value as AgentType)) return `Type must be one of: ${AGENT_TYPES.join(', ')}.`;
      return null;
    },
  },
  {
    field: 'description',
    label: 'DESCRIPTION',
    hint: 'Optional. Describe your agent\'s approach, model, or special handling logic. Shown on your agent\'s public profile page.',
    placeholder: 'e.g. GPT-4o agent with pre-signed transaction batching and adaptive gas strategy…',
    required: false,
    validate(value) {
      if (value && typeof value === 'string' && value.length > 500) return 'Description must be 500 characters or fewer.';
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface DefineBlockInput {
  /** Agent display name — rendered on leaderboard and profile page. */
  name: string;
  /** Selected agent type — drives default capabilities. */
  agentType: AgentType;
  /** Optional free-text description (max 500 chars). */
  description?: string;
}

export interface DefineBlockOutput {
  /** URL-safe slug derived from name (used as agentId). */
  slug: string;
  /** Trimmed agent name. */
  name: string;
  /** Selected agent type. */
  agentType: AgentType;
  /** Agent type metadata (label, description, default capabilities). */
  typeMeta: typeof AGENT_TYPE_META[AgentType];
  /** Trimmed description, or empty string if not provided. */
  description: string;
  /** ISO timestamp of definition. */
  definedAt: string;
  /** Any validation errors keyed by field name. Empty on success. */
  errors: Partial<Record<keyof DefineBlockInput, string>>;
  /** Whether all required fields passed validation. */
  valid: boolean;
}

// ---------------------------------------------------------------------------
// defineAgent() — main DEFINE block function
// ---------------------------------------------------------------------------

/**
 * Execute the Agent Studio DEFINE block.
 *
 * Validates all fields, derives the agent slug, and attaches type metadata.
 * Returns a DefineBlockOutput regardless of validity — check `.valid` and
 * `.errors` to branch on failure.
 *
 * @param input  Values collected from the DEFINE form.
 * @returns      Validated output ready to pass to the CONFIGURE block.
 *
 * @example
 * const output = defineAgent({
 *   name: 'AlphaPayAgent-v1',
 *   agentType: 'payment',
 *   description: 'Adaptive gas strategy with pre-signed batching.',
 * });
 *
 * if (!output.valid) {
 *   console.error(output.errors);
 * } else {
 *   console.log(output.slug);        // 'alphapaygent-v1'
 *   console.log(output.typeMeta);    // { label: 'Payment', ... }
 * }
 */
export function defineAgent(input: DefineBlockInput): DefineBlockOutput {
  const errors: Partial<Record<keyof DefineBlockInput, string>> = {};

  for (const schema of DEFINE_FIELD_SCHEMAS) {
    const value = input[schema.field];
    const error = schema.validate(value);
    if (error) errors[schema.field] = error;
  }

  const valid = Object.keys(errors).length === 0;
  const name = (input.name ?? '').trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const agentType: AgentType = AGENT_TYPES.includes(input.agentType) ? input.agentType : 'custom';

  return {
    slug,
    name,
    agentType,
    typeMeta: AGENT_TYPE_META[agentType],
    description: (input.description ?? '').trim(),
    definedAt: new Date().toISOString(),
    errors,
    valid,
  };
}
