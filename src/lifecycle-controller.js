/**
 * Lifecycle controller —— v0.2 引入
 *
 * 把 init / enter / leave 三个生命周期触发器从 createPageScopeInstance 内联实现
 * 中抽出, 同时通过 scope.$init / scope.$enter / scope.$leave 暴露为公共方法.
 *
 * 设计动机:
 *   v0.1 假设宿主是 Vue Router + keep-alive 场景, 通过 onMounted / onActivated /
 *   onDeactivated / onBeforeUnmount 四个组件生命周期自动驱动 enter / leave / destroy.
 *   这套假设在 uni-app 小程序端不成立 —— 小程序 onPageShow / onPageHide 不会触发
 *   Vue 的 onActivated / onDeactivated. adapter 需要能显式控制 enter / leave 时机.
 *
 *   把触发器从闭包暴露到 scope.$method, 是最小代价的扩展. v0.1 的 Vue Router 用法
 *   仍由库内部自动绑定调用 scope.$enter, 行为 100% 不变.
 *
 * 幂等性约定:
 *   - $init: 同一 scope 多次调用, options.init 只执行一次. v0.1 内部也只调用一次,
 *           新增 _initialized 守卫不会改变 v0.1 行为.
 *   - $enter: _entered 状态机去重. 与 v0.1 完全一致.
 *   - $leave: 未 enter 状态下 no-op. 与 v0.1 完全一致.
 *
 * 与 effectScope 的关系:
 *   - init hook 仍然包进 effectScopeRef.run, init 里手写的 watch 仍由 scope.stop() 回收.
 *   - enter / leave hook 不再额外包 effectScope.run, 与 v0.1 一致.
 */

export function createLifecycleController(deps) {
  var scope = deps.scope;
  var options = deps.options;
  var effectScopeRef = deps.effectScopeRef;
  var pluginHooks = deps.pluginHooks;
  var clearAllIntervals = deps.clearAllIntervals;

  var initHook = typeof options.init === 'function' ? options.init : null;
  var enterHook = typeof options.enter === 'function' ? options.enter : null;
  var leaveHook = typeof options.leave === 'function' ? options.leave : null;

  var _initialized = false;
  var _entered = false;

  function runInit() {
    if (_initialized || scope.$disposed) return;
    _initialized = true;
    if (!initHook) return;
    effectScopeRef.run(function () {
      initHook.call(scope);
    });
  }

  function runEnter() {
    if (_entered || scope.$disposed) return;
    _entered = true;
    scope.$status.mounted = true;
    scope.$status.active = true;
    if (enterHook) enterHook.call(scope);
    scope.$emit('page:enter');
    pluginHooks.forEach(function (h) {
      if (h.enter) h.enter();
    });
  }

  function runLeave() {
    if (!_entered) return;
    clearAllIntervals();
    _entered = false;
    scope.$status.active = false;
    if (leaveHook) leaveHook.call(scope);
    scope.$emit('page:leave');
    pluginHooks.forEach(function (h) {
      if (h.leave) h.leave();
    });
  }

  return {
    runInit: runInit,
    runEnter: runEnter,
    runLeave: runLeave,
  };
}
