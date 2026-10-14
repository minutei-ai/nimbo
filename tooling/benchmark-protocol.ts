import { Schema } from "effect";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Int.check(Schema.isGreaterThan(0));
export const Budget = Schema.Struct({
  max_javascript_ticks: Positive,
  max_microtasks: Positive,
  max_timers: Positive,
  max_timer_tasks: Positive,
  max_expression_bytes: Positive,
  timeout: Schema.Struct({ secs: Positive, nanos: Count }),
  max_response_bytes: Positive,
  max_initial_dom_nodes: Positive,
  max_dom_nodes: Positive,
  max_stylesheet_bytes: Positive,
  max_requests: Positive,
  max_dom_operations: Positive,
  max_layout_nodes: Positive,
  max_dom_write_bytes: Positive,
  max_storage_bytes: Positive,
  javascript_memory_bytes: Positive,
});
export type Budget = typeof Budget.Type;
export const decodeBudget = Schema.decodeUnknownSync(Budget);

export const corpusProtocol = {
  warmups: 3,
  samples: 15,
  rounds: 3,
  concurrency: 1,
} as const;

export const corpusOrder = "alternating builds; reversed first build each iteration and round";
