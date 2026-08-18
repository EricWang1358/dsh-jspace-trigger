/**
 * Type declarations for the dsh-jspace-trigger bundle plugin entry.
 * The runtime is dependency-free ESM; these declarations document the Cordis
 * plugin shape for TypeScript consumers and editor tooling.
 */

export type JSpacePass = 'fast' | 'full' | 'loop'
export type RuleAction = 'trigger' | 'ignore' | 'none'
export type InjectMode = 'near-field' | 'none'
export type MatchMode = 'any' | 'all' | 'score'

export interface RuleSpec {
  id?: string
  action?: RuleAction
  pass?: JSpacePass
  modules?: string[]
  matchMode?: MatchMode
  minScore?: number
  patterns?: Array<string | RegExp>
  excludePatterns?: Array<string | RegExp>
}

export interface PluginConfig {
  enabled?: boolean
  injectMode?: InjectMode
  analytics?: {
    enabled?: boolean
    maxRecords?: number
  }
  trigger?: {
    minScore?: number
    loopChars?: number
    fullChars?: number
    rules?: RuleSpec[]
  }
  skillRoots?: string[]
  repoUrl?: string
  branch?: string
}

export interface TriggerDecision {
  action: RuleAction
  pass: JSpacePass | null
  modules: string[]
  matched: string[]
  reason: string
  hitCount: number
  matchedPatterns: string[]
  matchMode: MatchMode | null
  threshold: number | null
  validPatterns: number
}

export declare const name: string
export declare const inject: string[]
export declare function apply(ctx: unknown, config?: PluginConfig): void
