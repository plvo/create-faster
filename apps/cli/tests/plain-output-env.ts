// picocolors lets NO_COLOR beat FORCE_COLOR and CI, but Bun's own console lets
// FORCE_COLOR beat NO_COLOR (an empty FORCE_COLOR still forces), so both are set.
export const PLAIN_OUTPUT_ENV = { NO_COLOR: '1', FORCE_COLOR: '0' };
