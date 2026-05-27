# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] - v0.2-alpha-uniapp-spike

This is an in-progress alpha release driven by uni-app miniapp adapter
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

## [0.1.1] - 2026

Initial public release. See git history for details.
