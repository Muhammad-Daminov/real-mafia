/**
 * Module-boundary enforcement for REAL MAFIA.
 *
 * Master TZ §37.5 requires a CI-enforced import-boundary lint that fails the
 * build if the `game-engine` domain module imports anything from `economy`,
 * `store`, `payments` or `referral`. This is the automated backstop for
 * invariant I-33 ("no purchasable, gifted, or referral-granted entity may
 * affect game state, validation, resolution, or the win evaluator") and is a
 * release-gate item (§45).
 *
 * `reachable: true` is deliberate: §24.1 forbids the domain layer from reaching
 * economy tables "directly or transitively, under any code path", so a rule
 * that only caught direct imports would not implement the spec.
 */

const ECONOMY_MODULES = '^src/(economy|store|payments|referral)';
const GAME_ENGINE = '^src/game-engine';

module.exports = {
  forbidden: [
    {
      name: 'game-engine-not-to-economy',
      comment:
        'I-33 (§24.1, §37.5): the game engine must never read economy, store, ' +
        'payment or referral state — directly or transitively. A feature that ' +
        'needs an exception here is redesigned, not excepted (§44 item 15).',
      severity: 'error',
      from: { path: GAME_ENGINE },
      to: { path: ECONOMY_MODULES, reachable: true },
    },
    {
      name: 'economy-not-to-game-engine',
      comment:
        'I-33 / I-39 (§7, §23.4): economy modules are a separate aggregate and ' +
        'must not depend on the gameplay domain. Correlation between the two ' +
        'happens through outbox-triggered follow-up commands, never an import.',
      severity: 'error',
      from: { path: ECONOMY_MODULES },
      to: { path: GAME_ENGINE, reachable: true },
    },
    {
      name: 'no-circular',
      comment:
        'Circular imports make the boundary rules above ambiguous and break ' +
        'Nest DI in subtle ways.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage|frontend)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Follow types as well as values: a type-only import of an economy entity
    // into the domain layer is still a boundary violation.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
