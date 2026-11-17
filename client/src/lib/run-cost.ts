/**
 * @file run-cost.ts
 * @description Whether Claude Code's own `total_cost_usd` can be shown for a run. Claude Code
 * prices every model it talks to with Anthropic's list prices; when it runs against a gateway
 * (ANTHROPIC_BASE_URL -> LiteLLM, Ollama) with a local or non-Anthropic model, that number is
 * invented (a free local qwen run showed $0.05-$0.20). Such runs show no cost instead of a wrong one.
 */

/** Model ids Claude Code can price correctly: Anthropic's own `claude-*` ids. */
const CLAUDE_MODEL = /^claude-/i;

/**
 * True when every model the run used is a Claude model, so the CLI's cost is meaningful. An empty
 * list (the run has not reported its models yet) keeps today's behaviour.
 *
 * @param models - Model ids from the init envelope and `result.modelUsage`.
 */
export function claudeCostApplies(models: Iterable<string | null | undefined>): boolean {
  for (const m of models) {
    if (m && !CLAUDE_MODEL.test(m)) return false;
  }
  return true;
}
