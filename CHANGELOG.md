# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0-alpha.1] - 2026-05-28

This alpha release is driven by uni-app miniapp adapter
requirements from the Activity Config Miniapp project. The goal is to make
vue-page-scope runtime-agnostic so its lifecycle can be controlled by
adapters, not just Vue component lifecycle hooks.

### Added

- Public lifecycle API: `scope.$init()`, `scope.$enter()`, `scope.$leave()`
  - Extracted from internal Vue lifecycle bindings into a standalone
    `lifecycle-controller` module
  - Allows external adapters to control scope lifecycle explicitly
- Lifecycle mode option: `options.lifecycle?: 'auto' | 'manual'` (default `'auto'`)
  - New `ScopeLifecycleMode` type export
  - `'auto'`: library registers Vue lifecycle hooks (onMounted / onActivated /
    onDeactivated / onBeforeUnmount) and auto-runs `$init`. Identical to v0.1.
  - `'manual'`: library registers no Vue lifecycle hooks and does not auto-run
    `$init`. The scope is usable on creation (plugins installed), but
    `$init` / `$enter` / `$leave` / `$destroy` are all driven explicitly by an
    adapter. Mode names stay runtime-agnostic (no host-specific semantics).
- Formalized lifecycle state machine with explicit idempotency rules:
  `created → inited → entered ⇄ left → destroyed`
  - `$init`: runs once; repeated calls emit a dev warning and are ignored
  - `$enter`: invalid after `destroyed`; ignored when already `entered`
  - `$leave`: only fires from `entered`; ignored in any other state
  - `$destroy`: runs once; if currently `entered`, auto-runs `$leave` (firing
    the leave hook / `page:leave` / plugin leave hooks) before stopping the
    effectScope
- Context channel: `options.context?: T | Ref<T> | (() => T)` + `scope.$getContext()`
  - New `ScopeContextSource<C>` and `ResolveContext<X>` type exports; a new
    trailing `C` generic threads the resolved context type through
    `PageScope` / `PageScopeBase` / `DefinePageScopeOptions` / `definePageScope`
  - `$getContext()` resolves the source lazily on every call (no caching), so
    `Ref` / getter forms always reflect the latest value
  - Returns `undefined` when `context` is unset or after the scope is destroyed
    (with a dev warning in the destroyed case)
  - When called inside a reactive context (watch / computed), it collects the
    reactive dependencies read by the getter — by design; use `untrack()` to opt out
  - A throwing getter is **not** swallowed; the error propagates so real bugs
    surface immediately rather than degrading to a downstream null access

### Fixed

- `definePageScope` no longer returns a disposed scope; `$destroy` self-evicts
  from the registry
  - Two-layer defense against the disposed-reuse hazard (registry caches by id,
    but a destroyed scope used to linger):
    1. `definePageScope(id)`: on a cache hit, if `cached.$disposed` is true,
       delete the stale entry and rebuild a fresh scope; an active cached scope
       is returned as before.
    2. `$destroy`: after marking `$disposed = true`, self-evict from the
       registry guarded by `cached === scope` — only the instance removes its
       own entry, so destroying an old scope never deletes a same-id entry that
       a newer instance has already taken over.
  - The `if (controller.isEntered()) runLeave()` branch is unchanged; eviction
    is appended at the tail of the destroy chain (leave → stop → disposed →
    evict), kept separate from the `isEntered` logic.

### Changed

- Internal: `createPageScopeInstance` now delegates lifecycle to
  `createLifecycleController` factory. Behavior is identical for
  existing v0.1 users.
- Internal: in `useScope`, the auto `$init` call and all four Vue lifecycle
  hook registrations are now gated behind a single
  `if (options.lifecycle !== 'manual')` switch. `provide()` stays outside the
  switch so `injectPageScope()` works in both modes.

### Backwards Compatibility

- 100% backwards compatible with v0.1
- All v0.1 user code continues to work unchanged
- New API is additive only
- Omitting `lifecycle` defaults to `'auto'`, behaving exactly as v0.1
- `options.context` 与 v0.1 injected 路径互不干扰:
  前者通过 `scope.$getContext()` 访问,
  后者继续通过 `scope.<key>` 顶层访问。
  两者可并存,无覆盖关系。

## [0.1.1] - 2026

Initial public release. See git history for details.
